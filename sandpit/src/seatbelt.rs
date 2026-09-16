//! macOS Seatbelt (sandbox-exec) integration and binary detection.
//!
//! Every launch receives an inherited kernel policy before agent startup.
//! A trusted bootstrap can restore supplemental DYLD hooks after sandbox-exec.
//! File rules are generated here; a parent-owned broker supplies the network
//! boundary. Command argument inspection remains supplemental.
//!
//! ## TCC (Transparency, Consent, and Control) awareness
//!
//! On macOS 13+ (and strictly enforced on macOS 26 / Tahoe), certain
//! directories are protected by TCC: ~/Documents, ~/Desktop, ~/Downloads,
//! removable volumes, and network volumes. Access to these directories
//! requires a valid **attribution chain** — TCC traces the responsible app
//! through every process in the spawn tree and validates code signatures.
//!
//! When sandpit injects an adhoc-signed dylib via DYLD_INSERT_LIBRARIES,
//! TCC cannot build a valid attribution chain — the injected library breaks
//! code signature validation. This causes the **kernel** to deny file access
//! to the TCC-protected directory for the entire process tree, including
//! new terminal windows sharing the same responsible-app session.
//!
//! When the working directory (or the project being worked on) is inside a
//! TCC-protected path, sandpit falls back to seatbelt + shims instead of
//! DYLD interpose. This preserves kernel-enforced file blocking while
//! avoiding the TCC attribution chain breakage.
//!
//! Long-term fix: sign the dylib with a Developer ID certificate and
//! notarize it, which would let TCC build a valid attribution chain even
//! with the library injected.

use crate::config;
use anyhow::{Context, Result};
use std::path::{Path, PathBuf};
use std::process::Command;

// ── Detection ────────────────────────────────────────────────────────

/// The resolved enforcement decision for a particular run.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ActiveMode {
    Dyld,
    Seatbelt,
    Off,
}

/// Check whether sandbox-exec is available on this system.
pub fn is_available() -> bool {
    Path::new("/usr/bin/sandbox-exec").exists()
}

/// Detect whether a binary supports DYLD_INSERT_LIBRARIES.
///
/// Returns false for:
///   - Apple platform binaries (Platform identifier in codesign output)
///   - Hardened runtime without disable-library-validation entitlement
///   - Binaries in SIP-protected paths (/usr/bin, /bin, /sbin, /usr/sbin)
pub fn supports_dyld(binary: &str) -> bool {
    let resolved = which::which(binary)
        .ok()
        .and_then(|p| std::fs::canonicalize(&p).ok())
        .unwrap_or_else(|| PathBuf::from(binary));

    let path_str = resolved.to_string_lossy();

    // SIP-protected paths
    if path_str.starts_with("/usr/bin/")
        || path_str.starts_with("/bin/")
        || path_str.starts_with("/sbin/")
        || path_str.starts_with("/usr/sbin/")
        || path_str.starts_with("/usr/lib/")
    {
        tracing::debug!(binary = %path_str, "SIP path — DYLD not supported");
        return false;
    }

    // Check codesign
    let output = match Command::new("codesign")
        .args(["-d", "-vv", &path_str])
        .output()
    {
        Ok(o) => o,
        Err(_) => return true, // can't check — assume DYLD works
    };

    let stderr = String::from_utf8_lossy(&output.stderr);

    // Apple platform binary
    if stderr.contains("Platform identifier") {
        tracing::debug!(binary = %path_str, "platform binary — DYLD not supported");
        return false;
    }

    // Hardened runtime without disable-library-validation
    if stderr.contains("runtime") {
        let has_disable = Command::new("codesign")
            .args(["-d", "--entitlements", "-", &path_str])
            .output()
            .ok()
            .map(|o| {
                let out = String::from_utf8_lossy(&o.stdout);
                let err = String::from_utf8_lossy(&o.stderr);
                out.contains("disable-library-validation")
                    || err.contains("disable-library-validation")
            })
            .unwrap_or(false);

        if !has_disable {
            tracing::debug!(binary = %path_str, "hardened runtime — DYLD not supported");
            return false;
        }
    }

    true
}

/// Detect the best enforcement mode for a binary.
pub fn detect_mode(binary: &str) -> ActiveMode {
    if supports_dyld(binary) {
        ActiveMode::Dyld
    } else if is_available() {
        ActiveMode::Seatbelt
    } else {
        ActiveMode::Off
    }
}

/// Given the binary's native mode and an optional TCC location, resolve
/// the effective enforcement mode. Centralises the TCC fallback decision
/// so `run_sandbox` and `check_binary` can't drift.
pub fn resolve_effective_mode(binary_mode: ActiveMode, tcc: &Option<TccLocation>) -> ActiveMode {
    if binary_mode == ActiveMode::Dyld && tcc.is_some() {
        // DYLD interpose would break the TCC attribution chain — fall back.
        if is_available() {
            ActiveMode::Seatbelt
        } else {
            ActiveMode::Off
        }
    } else {
        binary_mode
    }
}

// ── TCC detection ────────────────────────────────────────────────────

/// Well-known TCC-protected directory prefixes (macOS 13+).
///
/// These require a valid attribution chain for any process to access them.
/// An adhoc-signed DYLD_INSERT_LIBRARIES dylib breaks the chain on macOS 26+.
const TCC_PROTECTED_DIRS: &[&str] = &["Desktop", "Documents", "Downloads"];

/// Where a TCC-protected directory was found.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TccLocation {
    /// Well-known home subdirectory: ~/Documents, ~/Desktop, ~/Downloads.
    /// The inner string is just the directory name (e.g. "Documents").
    Home(String),
    /// Any other TCC-managed path detected via `com.apple.macl` xattr
    /// (e.g. removable or network volumes). The inner value is the full
    /// path of the protected ancestor directory.
    Other(PathBuf),
}

impl std::fmt::Display for TccLocation {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            TccLocation::Home(name) => write!(f, "~/{name}"),
            TccLocation::Other(path) => write!(f, "{}", path.display()),
        }
    }
}

/// Check whether a path is inside a TCC-protected directory.
///
/// Returns `Some(TccLocation)` if the path is under a TCC-protected
/// location, `None` otherwise.
///
/// Detection strategy: check the `com.apple.macl` extended attribute on
/// candidate parent directories. This attribute is set by macOS on
/// TCC-managed directories. We also check the well-known ~/Documents,
/// ~/Desktop, ~/Downloads paths as a fast-path.
pub fn tcc_protected_dir(path: &Path) -> Option<TccLocation> {
    let resolved = std::fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
    let path_str = resolved.to_string_lossy();

    let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".into());

    // Fast path: check well-known TCC directories under $HOME
    for dir_name in TCC_PROTECTED_DIRS {
        let prefix = format!("{home}/{dir_name}");
        if path_str.starts_with(&prefix)
            && (path_str.len() == prefix.len()
                || path_str.as_bytes().get(prefix.len()) == Some(&b'/'))
        {
            return Some(TccLocation::Home(dir_name.to_string()));
        }
    }

    // Slow path: walk up to check for com.apple.macl xattr (covers
    // removable volumes, network volumes, or any other TCC-managed location).
    let mut check = resolved.as_path();
    loop {
        if has_macl_xattr(check) {
            return Some(TccLocation::Other(check.to_path_buf()));
        }
        match check.parent() {
            Some(parent) if parent != check => check = parent,
            _ => break,
        }
    }

    None
}

/// Check if a path has the com.apple.macl extended attribute.
/// This xattr is set by macOS on TCC-managed directories.
fn has_macl_xattr(path: &Path) -> bool {
    use std::ffi::CString;
    use std::os::unix::ffi::OsStrExt;

    let c_path = match CString::new(path.as_os_str().as_bytes()) {
        Ok(p) => p,
        Err(_) => return false,
    };
    let attr_name = match CString::new("com.apple.macl") {
        Ok(n) => n,
        Err(_) => return false,
    };

    // getxattr returns the size of the attribute value, or -1 on error.
    // We just need to know if it exists, so pass a null buffer with size 0
    // and check for a non-negative return (XATTR_NOFOLLOW to avoid symlinks).
    let ret = unsafe {
        libc::getxattr(
            c_path.as_ptr(),
            attr_name.as_ptr(),
            std::ptr::null_mut(),
            0,
            0,                    // position
            libc::XATTR_NOFOLLOW, // options
        )
    };
    ret >= 0
}

// ── Seatbelt profile generation ──────────────────────────────────────

mod aliases;

/// Freeze existing and dangling symlink targets under deny roots, and reject
/// pre-existing hard links outside the effective policy roots.
/// New hard links and denied-path replacements are forbidden by the profile.
pub fn validate_file_aliases(cfg: &config::Config, mutable_session_dir: Option<&Path>) -> Result<config::Config> {
    validate_file_aliases_with_state(cfg, mutable_session_dir, &config::session_root().join("session-state"))
}

fn validate_file_aliases_with_state(
    cfg: &config::Config,
    mutable_session_dir: Option<&Path>,
    session_state: &Path,
) -> Result<config::Config> {
    use std::os::unix::fs::MetadataExt;
    let mut result = cfg.clone();
    for (roots, targets, follow_links, write_only) in [
        (
            &cfg.files.block_read,
            &mut result.files.block_read,
            true,
            false,
        ),
        (
            &cfg.files.block_write,
            &mut result.files.block_write,
            true,
            true,
        ),
        (
            &cfg.files.allow_write,
            &mut result.files.allow_write,
            false,
            false,
        ),
    ] {
        // Stream directory entries: large flat trees need one iterator, rather
        // than a queued path and a visited-set entry for every ordinary file.
        // Iterator storage grows with depth; only directories, symlinks and
        // multiply linked files need retained identity/alias bookkeeping.
        type Paths<'a> = Box<dyn Iterator<Item = std::io::Result<PathBuf>> + 'a>;
        // Only the reserved session-state deny has an overlay exception.
        // Keep that provenance through traversal; explicit denies still apply.
        let mut pending: Vec<(Paths<'_>, bool)> = roots.iter().rev().map(|root| {
            let path = PathBuf::from(root);
            let exempt_overlay = write_only
                && config::resolve_policy_path(&path) == session_state;
            (Box::new(std::iter::once(Ok(path))) as Paths<'_>, exempt_overlay)
        }).collect();
        let mut seen_directories = std::collections::HashSet::new();
        let mut seen_symlinks = std::collections::HashSet::new();
        let mut links: std::collections::HashMap<
            (u64, u64),
            (u64, std::collections::HashSet<PathBuf>),
        > = std::collections::HashMap::new();
        while let Some((paths, exempt_overlay)) = pending.last_mut() {
            let exempt_overlay = *exempt_overlay;
            let Some(path) = paths.next() else {
                pending.pop();
                continue;
            };
            let path = path?;
            if exempt_overlay && mutable_session_dir.is_some_and(|mutable| path.starts_with(mutable)) {
                continue;
            }
            let metadata = match std::fs::symlink_metadata(&path) {
                Ok(metadata) => metadata,
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
                Err(error) => {
                    return Err(error)
                        .with_context(|| format!("cannot validate {}", path.display()));
                }
            };
            if !metadata.is_dir() && metadata.nlink() > 1 {
                let entry = links
                    .entry((metadata.dev(), metadata.ino()))
                    .or_insert_with(|| (metadata.nlink(), std::collections::HashSet::new()));
                // Count directory entries, not their symlink destinations.
                // Canonicalizing only the parent retains dangling symlink names.
                let parent = path.parent().context("hard-link path has no parent")?;
                let name = path.file_name().context("hard-link path has no name")?;
                entry.1.insert(std::fs::canonicalize(parent)?.join(name));
            }
            if metadata.file_type().is_symlink() {
                if follow_links && seen_symlinks.insert((path.clone(), exempt_overlay)) {
                    let destination = aliases::resolve_symlink(&path)?;
                    if destination.to_str().is_none() {
                        anyhow::bail!("cannot represent non-UTF-8 symlink target in kernel policy");
                    }
                    if destination != path {
                        targets.push(destination.display().to_string());
                        pending.push((Box::new(std::iter::once(Ok(destination))), exempt_overlay));
                    }
                }
            } else if metadata.is_dir() {
                // Canonical directory identities also deduplicate overlapping
                // roots and stop symlink cycles without retaining regular files.
                if !seen_directories.insert((metadata.dev(), metadata.ino(), exempt_overlay)) {
                    continue;
                }
                let entries = match std::fs::read_dir(&path) {
                    Ok(entries) => entries,
                    Err(error) if error.kind() == std::io::ErrorKind::PermissionDenied => {
                        use std::os::unix::ffi::OsStrExt;
                        let name = std::ffi::CString::new(path.as_os_str().as_bytes())?;
                        // macOS keeps root-managed write-protected service
                        // directories (e.g. CUPS and Salt credentials) unlistable to
                        // ordinary users. Keep the kernel deny but do not
                        // require listing these OS-owned, non-writable trees.
                        if write_only
                            && metadata.uid() < 500
                            && metadata.mode() & 0o022 == 0
                            && path.starts_with("/private/etc")
                            && unsafe { libc::access(name.as_ptr(), libc::W_OK) } != 0
                        {
                            tracing::debug!(path=%path.display(), "kernel deny retained for unlistable OS-owned system subtree");
                            continue;
                        }
                        return Err(error).with_context(|| {
                            format!("cannot inspect directory {}", path.display())
                        });
                    }
                    Err(error) => return Err(error.into()),
                };
                pending.push((Box::new(entries.map(|entry| entry.map(|entry| entry.path()))), exempt_overlay));
            }
        }
        for (_, (count, paths)) in links {
            if paths.len() < count as usize {
                anyhow::bail!(
                    "file policy contains a hard-linked file with aliases outside its roots: {}; remove external aliases before launch",
                    paths.iter().next().unwrap().display()
                );
            }
        }
    }
    Ok(result)
}

/// Generate a seatbelt .sb profile from config. File blocks only.
pub fn generate_profile(cfg: &config::Config, mutable_session_dir: Option<&Path>) -> String {
    let mut lines = Vec::new();

    lines.push(";; Auto-generated by sandpit. Do not edit.".into());
    lines.push("(version 1)".into());
    lines.push("(allow default)".into());
    // An inherited terminal also belongs to the unsandboxed parent shell.
    // TIOCSTI can queue commands for that shell to execute after the child exits.
    lines.push(format!(
        "(deny file-ioctl (ioctl-command {}))",
        libc::TIOCSTI
    ));
    // cfprefsd can otherwise access a denied plist on the child's behalf
    // using preference permissions instead of the file permissions below.
    lines.push("(deny user-preference-read)".into());
    lines.push("(deny user-preference-write)".into());
    lines.push("(deny file-link)".into());
    lines.push("(deny appleevent-send)".into());
    lines.push("(deny process-info* (require-not (target same-sandbox)))".into());
    lines.push("(deny mach-priv-task-port (require-not (target same-sandbox)))".into());
    lines.push("(deny signal (require-not (target same-sandbox)))".into());
    lines.push("(deny mach-lookup (require-not (require-any (global-name \"com.apple.logd\") (global-name \"com.apple.system.logger\") (global-name \"com.apple.cfprefsd.agent\") (global-name \"com.apple.cfprefsd.daemon\") (global-name \"com.apple.dnssd.service\") (global-name \"com.apple.mDNSResponder\") (global-name \"com.apple.trustd.agent\") (global-name \"com.apple.trustd\") (global-name \"com.apple.securityd\") (global-name \"com.apple.securityd.xpc\") (global-name \"com.apple.SecurityServer\") (global-name \"com.apple.system.opendirectoryd.libinfo\") (global-name \"com.apple.bsd.dirhelper\"))))".into());
    lines.push("(deny mach-lookup (global-name \"com.apple.coreservices.launchservicesd\") (global-name \"com.apple.coreservices.appleevents\"))".into());
    lines.push(String::new());

    let has_file_blocks = !cfg.files.block_read.is_empty() || !cfg.files.block_write.is_empty();
    let has_allow_write = !cfg.files.allow_write.is_empty();

    let read_deny_count = cfg.files.block_read.len();
    let write_deny_count = cfg.files.block_write.len();

    // Seatbelt matches resolved vnode paths, not the spelling used by the
    // caller. Freeze the route to a denied path: a missing ancestor must not
    // become a symlink to an unprotected target, and existing ancestors must
    // not be removed/renamed out from under the policy.
    let mut guarded_paths = std::collections::BTreeSet::new();
    for path in cfg.files.block_read.iter().chain(&cfg.files.block_write) {
        for variant in path_variants(path) {
            for ancestor in Path::new(&variant).ancestors() {
                if let (Some(parent), Some(name)) = (ancestor.parent(), ancestor.file_name()) {
                    // Resolve the parent only: unlink/rename acts on a final
                    // symlink entry, not on that symlink's target.
                    let entry = config::resolve_policy_path(parent).join(name);
                    guarded_paths.insert(entry.to_string_lossy().into_owned());
                }
            }
        }
    }
    for path in guarded_paths {
        lines.push(format!(
            "(deny file-write-create file-write-unlink (literal \"{}\"))",
            escape_sb(&path)
        ));
    }

    if has_file_blocks || has_allow_write {
        lines.push(";; File system restrictions (kernel-enforced)".into());

        for path in &cfg.files.block_read {
            for variant in path_variants(path) {
                lines.push(format!(
                    "(deny file-read* (subpath \"{}\"))",
                    escape_sb(&variant)
                ));
            }
        }

        for path in &cfg.files.block_write {
            for expanded in path_variants(path) {
                if Path::new(&expanded) == config::session_root().join("session-state") {
                    let mutable = mutable_session_dir
                        .map(|path| path.display().to_string())
                        .unwrap_or_else(|| "/.sandpit-no-mutable-session".into());
                    lines.push(format!("(deny file-write* (require-all (subpath \"{}\") (require-not (subpath \"{}\"))))", escape_sb(&expanded), escape_sb(&mutable)));
                } else {
                    lines.push(format!(
                        "(deny file-write* (subpath \"{}\"))",
                        escape_sb(&expanded)
                    ));
                }
            }
        }

        if has_allow_write {
            let mut permitted: Vec<String> = cfg
                .files
                .allow_write
                .iter()
                .map(|path| {
                    format!(
                        "(subpath \"{}\")",
                        escape_sb(
                            &config::resolve_policy_path(Path::new(path))
                                .display()
                                .to_string()
                        )
                    )
                })
                .collect();
            if let Some(path) = mutable_session_dir {
                permitted.push(format!(
                    "(subpath \"{}\")",
                    escape_sb(&path.display().to_string())
                ));
            }
            lines.push(format!(
                "(deny file-write* (require-not (require-any {})))",
                permitted.join(" ")
            ));
        }

        lines.push(String::new());
    }

    tracing::debug!(
        profile_type = "seatbelt",
        read_deny_rules = read_deny_count,
        write_deny_rules = write_deny_count,
        "seatbelt profile generated"
    );

    lines.join("\n")
}

/// Only the parent broker and explicitly pinned TCP destinations can be
/// reached. In particular, arbitrary loopback proxies and Unix services are
/// not an escape route after DYLD is stripped.
pub fn network_profile(port: u16, sockets: &[PathBuf], local_ports: &[u16]) -> String {
    let mut exceptions = vec![format!("(remote ip \"localhost:{port}\")")];
    for port in local_ports.iter().filter(|port| **port > 0) {
        exceptions.push(format!("(remote ip \"localhost:{port}\")"));
    }
    for socket in sockets {
        exceptions.push(format!(
            "(remote unix-socket (subpath \"{}\"))",
            escape_sb(&socket.display().to_string())
        ));
    }
    // These daemons can open sockets for the child without going through our
    // broker: DNS accepts a custom resolver and trustd fetches certificate URLs.
    // Deny their Mach services whenever the kernel network boundary is active.
    format!(
        r#"
(deny network-outbound (require-not (require-any {})))
(deny network-bind)
(deny network-inbound)
(deny mach-lookup
  (global-name "com.apple.dnssd.service")
  (global-name "com.apple.mDNSResponder")
  (global-name "com.apple.trustd.agent")
  (global-name "com.apple.trustd"))
"#,
        exceptions.join(" ")
    )
}

/// Wrap a command with sandbox-exec.
pub fn wrap_command(profile_path: &Path, program: &str, args: &[String]) -> (String, Vec<String>) {
    tracing::debug!(
        profile = %profile_path.display(),
        program = %program,
        "seatbelt enforcement active"
    );
    let mut sb_args = vec![
        "-f".to_string(),
        profile_path.to_string_lossy().to_string(),
        program.to_string(),
    ];
    sb_args.extend_from_slice(args);
    ("/usr/bin/sandbox-exec".to_string(), sb_args)
}

// ── Helpers ──────────────────────────────────────────────────────────

fn resolve_real_path(path: &str) -> String {
    match std::fs::canonicalize(path) {
        Ok(real) => real.to_string_lossy().to_string(),
        Err(_) => path.to_string(),
    }
}

fn path_variants(path: &str) -> Vec<String> {
    let lexical = config::expand_path(path);
    let resolved = resolve_real_path(&lexical);
    if resolved == lexical {
        vec![lexical]
    } else {
        vec![lexical, resolved]
    }
}

fn escape_sb(s: &str) -> String {
    s.replace('\\', "\\\\").replace('"', "\\\"")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::*;

    fn test_config() -> Config {
        Config {
            network: NetworkConfig {
                allow_loopback_ports: vec![],
                deny_all: false,
                ssh: vec![],
                block: vec!["evil.com".into(), "pastebin.com".into()],
                allow: vec![],
                corporate_allow: vec![],
            },
            exec: ExecConfig {
                block: vec!["curl --data".into(), "rm -rf /".into()],
                allow: vec![],
            },
            files: FilesConfig {
                allow_write: vec![],
                block_write: vec!["/etc".into()],
                block_read: vec!["~/.ssh".into()],
            },
            adversary: AdversaryConfig::default(),
            logs: LogsConfig::default(),
        }
    }

    #[test]
    fn alias_validation_checks_fifo_and_symlink_hardlinks() {
        use std::os::unix::ffi::OsStrExt;
        for symlink in [false, true] {
            let fixture = tempfile::tempdir().unwrap();
            let root = fixture.path().canonicalize().unwrap();
            let protected = root.join("protected");
            std::fs::create_dir(&protected).unwrap();
            let first = protected.join("first");
            if symlink {
                std::os::unix::fs::symlink("missing", &first).unwrap();
            } else {
                let name = std::ffi::CString::new(first.as_os_str().as_bytes()).unwrap();
                assert_eq!(unsafe { libc::mkfifo(name.as_ptr(), 0o600) }, 0);
            }
            std::fs::hard_link(&first, protected.join("second")).unwrap();
            for scope in ["read", "write", "allow"] {
                let mut cfg = test_config();
                cfg.files.block_read.clear();
                cfg.files.block_write.clear();
                cfg.files.allow_write.clear();
                match scope {
                    "read" => cfg.files.block_read.push(protected.display().to_string()),
                    "write" => cfg.files.block_write.push(protected.display().to_string()),
                    _ => cfg.files.allow_write.push(protected.display().to_string()),
                }
                validate_file_aliases(&cfg, None).unwrap();
                let external = root.join("outside");
                std::fs::hard_link(&first, &external).unwrap();
                let error = validate_file_aliases(&cfg, None).unwrap_err();
                assert!(error.to_string().contains("aliases outside its roots"));
                std::fs::remove_file(external).unwrap();
            }
        }
    }

    #[test]
    fn alias_validation_exempts_overlay_only_from_reserved_write_deny() {
        let root = tempfile::tempdir().unwrap();
        let root = root.path().canonicalize().unwrap();
        let state = root.join("session-state");
        let mutable = state.join("current");
        let other = state.join("other");
        let data = root.join("data");
        let protected = root.join("protected");
        for path in [&mutable, &other, &data, &protected] {
            std::fs::create_dir_all(path).unwrap();
        }
        std::os::unix::fs::symlink(&data, mutable.join("data")).unwrap();
        std::os::unix::fs::symlink(&protected, other.join("data")).unwrap();
        let mut cfg = test_config();
        cfg.files.block_read.clear();
        cfg.files.block_write = vec![state.display().to_string()];
        let validated = validate_file_aliases_with_state(&cfg, Some(&mutable), &state).unwrap();
        assert!(!validated.files.block_write.contains(&data.display().to_string()));
        assert!(validated.files.block_write.contains(&protected.display().to_string()));

        // An overlapping explicit deny must still expand even if its ancestor
        // was already scanned with the mutable exception.
        cfg.files.block_write.push(mutable.display().to_string());
        let validated = validate_file_aliases_with_state(&cfg, Some(&mutable), &state).unwrap();
        assert!(validated.files.block_write.contains(&data.display().to_string()));
        cfg.files.block_write = vec![state.display().to_string()];
        cfg.files.block_read = vec![state.display().to_string()];
        let validated = validate_file_aliases_with_state(&cfg, Some(&mutable), &state).unwrap();
        assert!(validated.files.block_read.contains(&data.display().to_string()));
    }

    #[test]
    #[ignore = "creates 100001 files to exercise production-sized policy roots"]
    fn alias_validation_accepts_large_policy_root() {
        let root = tempfile::tempdir().unwrap();
        for index in 0..100_001 {
            std::fs::File::create(root.path().join(index.to_string())).unwrap();
        }
        let mut cfg = test_config();
        cfg.files.block_read.clear();
        cfg.files.block_write.clear();
        cfg.files.allow_write = vec![root.path().display().to_string()];
        validate_file_aliases(&cfg, None).unwrap();

        // A large valid tree must still reject an alias outside the policy.
        let external = tempfile::tempdir().unwrap();
        std::fs::hard_link(root.path().join("100000"), external.path().join("alias")).unwrap();
        let error = validate_file_aliases(&cfg, None).unwrap_err();
        assert!(error.to_string().contains("aliases outside its roots"));
    }

    #[test]
    fn alias_validation_handles_cycles_overlapping_roots_and_hardlinks() {
        let root = tempfile::tempdir().unwrap();
        let nested = root.path().join("nested");
        std::fs::create_dir(&nested).unwrap();
        std::fs::write(root.path().join("first"), "synthetic").unwrap();
        std::fs::hard_link(root.path().join("first"), nested.join("second")).unwrap();
        std::os::unix::fs::symlink(root.path(), nested.join("cycle")).unwrap();
        let mut cfg = test_config();
        cfg.files.block_write.clear();
        cfg.files.block_read = vec![
            root.path().display().to_string(),
            nested.display().to_string(),
        ];
        validate_file_aliases(&cfg, None).unwrap();

        let external = tempfile::tempdir().unwrap();
        std::fs::hard_link(root.path().join("first"), external.path().join("third")).unwrap();
        let error = validate_file_aliases(&cfg, None).unwrap_err();
        assert!(error.to_string().contains("aliases outside its roots"));
    }

    #[test]
    fn profile_contains_file_deny() {
        let cfg = test_config();
        let profile = generate_profile(&cfg, None);
        assert!(
            profile.contains("(deny file-write* (subpath \"/etc\"))")
                || profile.contains("(deny file-write* (subpath \"/private/etc\"))")
        );
        assert!(profile.contains("(deny file-read*"));
    }

    #[test]
    fn session_deny_exempts_only_current_mutable_overlay() {
        let mut cfg = test_config();
        let session_state = config::system_home_dir().join(".sandpit/session-state");
        let mutable = session_state.join("run-test");
        cfg.files
            .block_write
            .push(session_state.display().to_string());
        let profile = generate_profile(&cfg, Some(&mutable));
        assert!(profile.contains("(require-not (subpath \""));
        assert!(!profile.contains("process-path"));
        assert!(profile.contains(mutable.to_string_lossy().as_ref()));
    }

    #[test]
    fn profile_protects_symlink_alias_and_target() {
        let root = tempfile::tempdir().unwrap();
        let target = root.path().join("target.jsonl");
        let alias = root.path().join("alias.jsonl");
        std::fs::write(&target, "").unwrap();
        std::os::unix::fs::symlink(&target, &alias).unwrap();
        let mut cfg = Config::default();
        cfg.files.block_write = vec![alias.to_string_lossy().into()];

        let profile = generate_profile(&cfg, None);
        assert!(profile.contains(&format!("(subpath \"{}\")", alias.display())));
        assert!(profile.contains(&format!(
            "(subpath \"{}\")",
            std::fs::canonicalize(target).unwrap().display()
        )));
    }

    #[test]
    fn profile_has_no_network_deny() {
        let cfg = test_config();
        let profile = generate_profile(&cfg, None);
        assert!(!profile.contains("deny network"));
    }

    #[test]
    fn profile_empty_without_rules() {
        let cfg = Config::default();
        let profile = generate_profile(&cfg, None);
        assert!(!profile.contains("deny file-read"));
        assert!(!profile.contains("deny file-write"));
        assert!(profile.contains("deny file-link"));
    }

    #[test]
    fn profile_guards_missing_ancestors_and_existing_parents() {
        let root = tempfile::tempdir().unwrap();
        let protected = root.path().join("protected");
        std::fs::create_dir(&protected).unwrap();
        std::fs::write(protected.join("secret"), "synthetic").unwrap();
        std::os::unix::fs::symlink(&protected, root.path().join("alias")).unwrap();
        let mut cfg = Config::default();
        cfg.files
            .block_read
            .push(protected.join("secret").display().to_string());
        cfg.files
            .block_read
            .push(root.path().join("alias/secret").display().to_string());
        cfg.files.block_write.extend([
            protected.display().to_string(),
            root.path().join("future/secret").display().to_string(),
        ]);
        let profile = generate_profile(&cfg, None);
        let output = Command::new("/usr/bin/sandbox-exec")
            .args([
                "-p",
                &profile,
                "/usr/bin/python3",
                "-c",
                r#"
import errno, os, pathlib, sys
root = pathlib.Path(sys.argv[1])
(root / 'safe').write_text('normal work')
operations = [
    lambda: os.symlink(root / 'protected', root / 'future'),
    lambda: os.rename(root / 'protected', root / 'moved'),
    lambda: os.unlink(root / 'alias'),
    lambda: (root / 'protected' / 'secret').read_text(),
    lambda: (root / 'protected' / 'secret').write_text('changed'),
]
for operation in operations:
    try:
        operation()
    except OSError as error:
        assert error.errno in (errno.EPERM, errno.EACCES), error
    else:
        raise AssertionError('protected operation succeeded')
print('guarded')
"#,
            ])
            .arg(root.path())
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        assert_eq!(String::from_utf8_lossy(&output.stdout).trim(), "guarded");
        assert_eq!(
            std::fs::read_to_string(protected.join("secret")).unwrap(),
            "synthetic"
        );
        assert!(!root.path().join("future").exists());
        assert_eq!(
            std::fs::read_to_string(root.path().join("safe")).unwrap(),
            "normal work"
        );
    }

    #[test]
    fn detect_sip_path() {
        assert!(!supports_dyld("/usr/bin/curl"));
        assert!(!supports_dyld("/bin/bash"));
    }

    #[test]
    fn detect_homebrew_path() {
        if Path::new("/opt/homebrew/bin/node").exists() {
            assert!(supports_dyld("/opt/homebrew/bin/node"));
        }
    }

    #[test]
    fn detect_mode_picks_dyld_for_node() {
        if Path::new("/opt/homebrew/bin/node").exists() {
            assert_eq!(detect_mode("/opt/homebrew/bin/node"), ActiveMode::Dyld);
        }
    }

    #[test]
    fn detect_mode_picks_seatbelt_for_sip() {
        if is_available() {
            assert_eq!(detect_mode("/usr/bin/curl"), ActiveMode::Seatbelt);
        }
    }

    #[test]
    fn tcc_detects_documents() {
        let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".into());
        let docs = PathBuf::from(&home).join("Documents");
        if docs.exists() {
            assert_eq!(
                tcc_protected_dir(&docs),
                Some(TccLocation::Home("Documents".into())),
                "~/Documents should be TCC-protected"
            );
        }
    }

    #[test]
    fn tcc_detects_nested_documents_path() {
        let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".into());
        let nested = PathBuf::from(&home).join("Documents/code/some-project");
        // Don't require the nested path to exist — just check the prefix logic
        assert_eq!(
            tcc_protected_dir(&nested),
            Some(TccLocation::Home("Documents".into())),
            "path under ~/Documents should be TCC-protected"
        );
    }

    #[test]
    fn tcc_ignores_safe_paths() {
        let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".into());
        assert_eq!(
            tcc_protected_dir(&PathBuf::from(&home).join("Development")),
            None,
            "~/Development should NOT be TCC-protected"
        );
        assert_eq!(
            tcc_protected_dir(&PathBuf::from("/tmp")),
            None,
            "/tmp should NOT be TCC-protected"
        );
    }

    #[test]
    fn tcc_location_display() {
        assert_eq!(
            TccLocation::Home("Documents".into()).to_string(),
            "~/Documents"
        );
        assert_eq!(
            TccLocation::Other(PathBuf::from("/Volumes/MyUSB")).to_string(),
            "/Volumes/MyUSB"
        );
    }
}
