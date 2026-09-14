//! Strict canonical object revisions; not NIP-33 author-addressed state.
use nostr::{Event, EventBuilder, Kind, Tag};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::kind::*;

/// Immutable identity and room relationships repeated by every revision.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Home {
    /// Stable UUID for projects/tasks only. Git bindings reuse their target identity.
    pub object: Option<Uuid>,
    /// Conversation channel; also the audience of this declaration.
    pub channel: Uuid,
    /// Ordinary top-level message ID for thread-backed objects.
    pub root: Option<String>,
    /// Required canonical project ID for tasks.
    pub project: Option<Uuid>,
    /// Optional parent task in the same project.
    pub parent: Option<Uuid>,
    /// Standard NIP-34 repository coordinate for repository/branch bindings.
    pub git: Option<String>,
    /// Full refs/heads/... name for branch registrations.
    pub branch: Option<String>,
}

/// Signed full snapshot. Writers must name the current event ID, not a timestamp.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Revision {
    /// Immutable room and identity.
    pub home: Home,
    /// Previous accepted revision; absent only for creation.
    pub previous: Option<String>,
    /// Terminal tombstone. The home remains reserved.
    pub deleted: bool,
    /// Project/task state. Git home bindings must carry null, never duplicate code state.
    pub state: serde_json::Value,
}

fn is_id(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

/// Explicit version marker for the room relationship contract.
pub const CONTRACT: &str = "buzz-rooms-1";

impl Home {
    /// Index key, not a second public identity for Git objects.
    pub fn identity(&self) -> String {
        if let Some(id) = self.object {
            id.to_string()
        } else if let Some(branch) = &self.branch {
            // JSON tuple encoding prevents delimiter collisions in external repo d tags.
            serde_json::json!([self.git, branch]).to_string()
        } else {
            self.git.clone().unwrap_or_default()
        }
    }
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Payload {
    previous: Option<String>,
    deleted: bool,
    state: serde_json::Value,
}

/// Build a versioned declaration. Relationships live in signed tags, not content.
pub fn build(kind: u32, revision: &Revision) -> Result<EventBuilder, String> {
    let h = &revision.home;
    let mut values = vec![
        vec!["v".into(), CONTRACT.into()],
        vec!["h".into(), h.channel.to_string()],
    ];
    for (name, value) in [
        ("object", h.object.map(|v| v.to_string())),
        ("root", h.root.clone()),
        ("project", h.project.map(|v| v.to_string())),
        ("parent", h.parent.map(|v| v.to_string())),
        ("a", h.git.clone()),
        ("ref", h.branch.clone()),
    ] {
        if let Some(value) = value {
            values.push(vec![name.into(), value]);
        }
    }
    let tags = values
        .into_iter()
        .map(|v| Tag::parse(v).map_err(|e| e.to_string()))
        .collect::<Result<Vec<_>, _>>()?;
    let content = serde_json::to_string(&Payload {
        previous: revision.previous.clone(),
        deleted: revision.deleted,
        state: revision.state.clone(),
    })
    .map_err(|e| e.to_string())?;
    Ok(EventBuilder::new(Kind::Custom(kind as u16), content).tags(tags))
}

/// Parse the versioned relationship tags before authorization/storage.
pub fn parse(event: &Event) -> Result<Revision, String> {
    let kind = event.kind.as_u16() as u32;
    if !is_work_object(kind) {
        return Err("not a canonical work-object kind".into());
    }
    let mut tags = std::collections::HashMap::new();
    for tag in event.tags.iter() {
        let parts = tag.as_slice();
        let [name, value] = parts else {
            return Err("expected two-element relationship tags".into());
        };
        if !["v", "h", "object", "root", "project", "parent", "a", "ref"].contains(&name.as_str())
            || tags.insert(name.as_str(), value.as_str()).is_some()
        {
            return Err("unknown or duplicate relationship tag".into());
        }
    }
    if tags.get("v") != Some(&CONTRACT) {
        return Err("missing or unsupported room contract".into());
    }
    let uuid = |name| -> Result<Option<Uuid>, String> {
        tags.get(name)
            .map(|s| {
                let id = Uuid::parse_str(s).map_err(|_| format!("invalid {name} UUID"))?;
                if id.is_nil() || id.to_string() != **s {
                    return Err(format!("noncanonical {name} UUID"));
                }
                Ok(id)
            })
            .transpose()
    };
    let home = Home {
        object: uuid("object")?,
        channel: uuid("h")?.ok_or("missing h tag")?,
        root: tags.get("root").map(|s| s.to_string()),
        project: uuid("project")?,
        parent: uuid("parent")?,
        git: tags.get("a").map(|s| s.to_string()),
        branch: tags.get("ref").map(|s| s.to_string()),
    };
    let payload: Payload = serde_json::from_str(&event.content).map_err(|e| e.to_string())?;
    let revision = Revision {
        home,
        previous: payload.previous,
        deleted: payload.deleted,
        state: payload.state,
    };
    let h = &revision.home;
    if revision.previous.as_deref().is_some_and(|p| !is_id(p))
        || h.root.as_deref().is_some_and(|p| !is_id(p))
        || (revision.deleted && revision.previous.is_none())
    {
        return Err("invalid revision/root ID or creation tombstone".into());
    }
    let thread = matches!(kind, KIND_WORK_TASK | KIND_BRANCH_HOME);
    if thread != h.root.is_some()
        || (kind == KIND_WORK_TASK) != h.project.is_some()
        || (h.parent.is_some() && kind != KIND_WORK_TASK)
        || matches!(kind, KIND_REPOSITORY_HOME | KIND_BRANCH_HOME) != h.git.is_some()
        || matches!(kind, KIND_WORK_PROJECT | KIND_WORK_TASK) != h.object.is_some()
        || (h.git.is_some() && !revision.state.is_null())
        || (kind == KIND_BRANCH_HOME) != h.branch.is_some()
        || [h.project, h.parent]
            .into_iter()
            .flatten()
            .any(|id| id.is_nil() || Some(id) == h.object)
    {
        return Err("invalid relationships for object type".into());
    }
    if let Some(git) = &h.git {
        let parts: Vec<_> = git.splitn(3, ':').collect();
        if parts.len() != 3
            || parts[0] != "30617"
            || !is_id(parts[1])
            || parts[2].is_empty()
            || parts[2].len() > 255
        {
            return Err("invalid Git repository coordinate".into());
        }
    }
    if let Some(branch) = &h.branch {
        if !branch.starts_with("refs/heads/")
            || branch.len() <= 11
            || branch.len() > 255
            || branch.contains("..")
            || branch.contains("@{")
            || branch.contains("//")
            || branch.ends_with('/')
            || branch.ends_with('.')
            || branch
                .bytes()
                .any(|b| b <= 32 || b == 127 || b"~^:?*[\\".contains(&b))
            || branch
                .split('/')
                .any(|s| s.starts_with('.') || s.ends_with(".lock"))
        {
            return Err("invalid branch ref".into());
        }
    }
    Ok(revision)
}

#[cfg(test)]
mod tests {
    use super::*;
    use nostr::{Keys, Tag};

    fn snapshot(kind: u32) -> Revision {
        Revision {
            home: Home {
                object: matches!(kind, KIND_WORK_PROJECT | KIND_WORK_TASK).then(Uuid::new_v4),
                channel: Uuid::new_v4(),
                root: matches!(kind, KIND_WORK_TASK | KIND_BRANCH_HOME).then(|| "a".repeat(64)),
                project: (kind == KIND_WORK_TASK).then(Uuid::new_v4),
                parent: None,
                git: matches!(kind, KIND_REPOSITORY_HOME | KIND_BRANCH_HOME)
                    .then(|| format!("30617:{}:repo", "b".repeat(64))),
                branch: (kind == KIND_BRANCH_HOME).then(|| "refs/heads/main".into()),
            },
            previous: None,
            deleted: false,
            state: if matches!(kind, KIND_WORK_PROJECT | KIND_WORK_TASK) {
                serde_json::json!({"title":"hello"})
            } else {
                serde_json::Value::Null
            },
        }
    }
    fn event(kind: u32, r: &Revision, extra: Option<Tag>) -> Event {
        build(kind, r)
            .unwrap()
            .tags(extra)
            .sign_with_keys(&Keys::generate())
            .unwrap()
    }
    #[test]
    fn strict_envelopes_for_all_types() {
        for kind in [
            KIND_WORK_PROJECT,
            KIND_REPOSITORY_HOME,
            KIND_WORK_TASK,
            KIND_BRANCH_HOME,
        ] {
            let r = snapshot(kind);
            assert!(parse(&event(kind, &r, None)).is_ok());
            assert!(parse(&event(
                kind,
                &r,
                Some(Tag::parse(["h", &Uuid::new_v4().to_string()]).unwrap())
            ))
            .is_err());
            let mut invalid = r.clone();
            invalid.home.object = Some(Uuid::nil());
            assert!(parse(&event(kind, &invalid, None)).is_err());
            let mut invalid = r.clone();
            invalid.previous = Some("A".repeat(64));
            assert!(parse(&event(kind, &invalid, None)).is_err());
            let mut invalid = r.clone();
            invalid.deleted = true;
            assert!(parse(&event(kind, &invalid, None)).is_err());
            let mut invalid = r.clone();
            invalid.home.root = r.home.root.is_none().then(|| "a".repeat(64));
            assert!(parse(&event(kind, &invalid, None)).is_err());
            let mut invalid = r.clone();
            invalid.home.project = r.home.project.is_none().then(Uuid::new_v4);
            assert!(parse(&event(kind, &invalid, None)).is_err());
        }
    }
    #[test]
    fn off_scheme_tags_and_duplicate_git_state_are_rejected() {
        let r = snapshot(KIND_WORK_TASK);
        let valid = event(KIND_WORK_TASK, &r, None);
        for name in ["v", "h", "object", "root", "project"] {
            let tags: Vec<_> = valid
                .tags
                .iter()
                .filter(|t| t.as_slice()[0] != name)
                .cloned()
                .collect();
            let missing = EventBuilder::new(valid.kind, &valid.content)
                .tags(tags)
                .sign_with_keys(&Keys::generate())
                .unwrap();
            assert!(parse(&missing).is_err(), "missing {name}");
        }
        for extra in [
            vec!["v", "buzz-rooms-2"],
            vec!["root", "bad"],
            vec!["e", "bad"],
            vec!["parent"],
            vec!["h", "bad", "extra"],
        ] {
            assert!(parse(&event(KIND_WORK_TASK, &r, Some(Tag::parse(extra).unwrap()))).is_err());
        }
        let mut repo = snapshot(KIND_REPOSITORY_HOME);
        repo.state = serde_json::json!({"refs/heads/main":"duplicate-code-state"});
        assert!(parse(&event(KIND_REPOSITORY_HOME, &repo, None)).is_err());
        repo.state = serde_json::Value::Null;
        repo.home.object = Some(Uuid::new_v4());
        assert!(parse(&event(KIND_REPOSITORY_HOME, &repo, None)).is_err());
        repo.home.object = None;
        repo.home.git = Some(format!("30617:{}:external:repo", "b".repeat(64)));
        assert!(parse(&event(KIND_REPOSITORY_HOME, &repo, None)).is_ok());
        let mut branch = snapshot(KIND_BRANCH_HOME);
        branch.home.git = repo.home.git.clone();
        assert_ne!(repo.home.identity(), branch.home.identity());
        assert!(!is_work_object(45013), "documents are deferred");
    }

    #[test]
    fn branch_names_and_task_relationships_are_strict() {
        let mut r = snapshot(KIND_BRANCH_HOME);
        for name in [
            "main",
            "refs/heads/",
            "refs/heads/a..b",
            "refs/heads/.hidden",
            "refs/heads/a.lock",
            "refs/heads/a b",
            "refs/heads/a@{b",
            "refs/heads/a//b",
        ] {
            r.home.branch = Some(name.into());
            assert!(parse(&event(KIND_BRANCH_HOME, &r, None)).is_err(), "{name}");
        }
        let mut task = snapshot(KIND_WORK_TASK);
        task.home.parent = task.home.object;
        assert!(parse(&event(KIND_WORK_TASK, &task, None)).is_err());
    }
}
