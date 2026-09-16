use anyhow::{bail, Context, Result};
use std::collections::VecDeque;
use std::ffi::OsString;
use std::path::{Component, Path, PathBuf};

#[derive(Debug)]
enum Part {
    Root,
    Parent,
    Name(OsString),
}

fn parts(path: &Path) -> Result<VecDeque<Part>> {
    path.components()
        .filter_map(|component| match component {
            Component::RootDir => Some(Ok(Part::Root)),
            Component::ParentDir => Some(Ok(Part::Parent)),
            Component::Normal(name) => Some(Ok(Part::Name(name.to_owned()))),
            Component::CurDir => None,
            Component::Prefix(_) => Some(Err(anyhow::anyhow!("unsupported path prefix"))),
        })
        .collect()
}

/// Resolve links even when their final destination does not exist yet.
///
/// Canonicalizing the nearest existing ancestor is insufficient: a dangling
/// symlink itself is not an existing ancestor according to `canonicalize`.
/// Walk components with `symlink_metadata` instead, expanding each link before
/// considering the next component. Only ENOENT permits an unresolved suffix;
/// inaccessible paths and ambiguous missing/.. paths fail closed.
pub(super) fn resolve_symlink(path: &Path) -> Result<PathBuf> {
    let absolute = if path.is_absolute() {
        path.to_owned()
    } else {
        std::env::current_dir()
            .context("resolve relative symlink path")?
            .join(path)
    };
    let mut pending = parts(&absolute)?;
    let mut resolved = PathBuf::new();
    let mut missing = false;
    let mut directory = true;
    let mut links = 0;
    while let Some(part) = pending.pop_front() {
        match part {
            Part::Root => {
                resolved = PathBuf::from("/");
                missing = false;
                directory = true;
            }
            Part::Parent => {
                if missing {
                    bail!(
                        "cannot safely resolve '..' after a missing component in {}",
                        path.display()
                    );
                }
                if !directory {
                    bail!(
                        "non-directory component in symlink target {}",
                        resolved.display()
                    );
                }
                resolved.pop();
            }
            Part::Name(name) => {
                if !directory {
                    bail!(
                        "non-directory component in symlink target {}",
                        resolved.display()
                    );
                }
                let candidate = resolved.join(name);
                match std::fs::symlink_metadata(&candidate) {
                    Ok(metadata) if metadata.file_type().is_symlink() => {
                        links += 1;
                        if links > 40 {
                            bail!(
                                "symlink cycle or excessive chain resolving {}",
                                path.display()
                            );
                        }
                        let target = std::fs::read_link(&candidate)
                            .with_context(|| format!("read symlink {}", candidate.display()))?;
                        let mut expansion = parts(&target)?;
                        expansion.append(&mut pending);
                        pending = expansion;
                    }
                    Ok(metadata) => {
                        directory = metadata.is_dir();
                        resolved = candidate;
                    }
                    Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                        missing = true;
                        resolved = candidate;
                    }
                    Err(error) => {
                        return Err(error).with_context(|| {
                            format!("inspect symlink target {}", candidate.display())
                        });
                    }
                }
            }
        }
    }
    Ok(resolved)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::symlink;

    #[test]
    fn resolves_dangling_absolute_and_relative_links() {
        let fixture = tempfile::tempdir().unwrap();
        let root = fixture.path().canonicalize().unwrap();
        symlink(root.join("missing/child"), root.join("absolute")).unwrap();
        symlink("missing/child", root.join("relative")).unwrap();
        for name in ["absolute", "relative"] {
            assert_eq!(
                resolve_symlink(&root.join(name)).unwrap(),
                root.join("missing/child")
            );
        }
    }

    #[test]
    fn expands_chains_and_intermediate_dangling_links() {
        let fixture = tempfile::tempdir().unwrap();
        let root = fixture.path().canonicalize().unwrap();
        symlink("missing", root.join("intermediate")).unwrap();
        symlink("intermediate/child", root.join("chain")).unwrap();
        symlink("chain", root.join("alias")).unwrap();
        assert_eq!(
            resolve_symlink(&root.join("alias")).unwrap(),
            root.join("missing/child")
        );
    }

    #[test]
    fn resolves_existing_parent_components_and_platform_aliases() {
        let fixture = tempfile::tempdir_in("/tmp").unwrap();
        let root = fixture.path().canonicalize().unwrap();
        std::fs::create_dir(root.join("directory")).unwrap();
        symlink("directory/../missing", fixture.path().join("alias")).unwrap();
        assert_eq!(
            resolve_symlink(&fixture.path().join("alias")).unwrap(),
            root.join("missing")
        );
    }

    #[test]
    fn rejects_cycles_and_ambiguous_missing_parents() {
        let fixture = tempfile::tempdir().unwrap();
        let root = fixture.path();
        symlink("second", root.join("first")).unwrap();
        symlink("first", root.join("second")).unwrap();
        assert!(resolve_symlink(&root.join("first")).is_err());
        symlink("missing/../secret", root.join("ambiguous")).unwrap();
        assert!(resolve_symlink(&root.join("ambiguous")).is_err());
    }

    #[test]
    fn rejects_non_directory_target_components() {
        let fixture = tempfile::tempdir().unwrap();
        let root = fixture.path();
        std::fs::write(root.join("file"), "fixture").unwrap();
        symlink("file/../secret", root.join("alias")).unwrap();
        assert!(resolve_symlink(&root.join("alias")).is_err());
    }

    #[test]
    fn propagates_permission_errors_instead_of_treating_them_as_missing() {
        use std::os::unix::fs::PermissionsExt;
        // Root bypasses ordinary directory permissions.
        if unsafe { libc::geteuid() } == 0 {
            return;
        }
        let fixture = tempfile::tempdir().unwrap();
        let directory = fixture.path().join("inaccessible");
        std::fs::create_dir(&directory).unwrap();
        symlink("inaccessible/missing", fixture.path().join("alias")).unwrap();
        std::fs::set_permissions(&directory, std::fs::Permissions::from_mode(0o000)).unwrap();
        let result = resolve_symlink(&fixture.path().join("alias"));
        std::fs::set_permissions(&directory, std::fs::Permissions::from_mode(0o700)).unwrap();
        let error = result.unwrap_err();
        assert_eq!(
            error.downcast_ref::<std::io::Error>().unwrap().kind(),
            std::io::ErrorKind::PermissionDenied
        );
    }
}
