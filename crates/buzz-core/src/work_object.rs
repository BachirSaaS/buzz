//! Strict canonical object revisions; not NIP-33 author-addressed state.
use nostr::Event;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::kind::*;

/// Immutable identity and room relationships repeated by every revision.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Home {
    /// Stable UUID, scoped to the community, shared across object types.
    pub object: Uuid,
    /// Conversation channel; also the audience of this declaration.
    pub channel: Uuid,
    /// Ordinary top-level message ID for thread-backed objects.
    pub root: Option<String>,
    /// Required canonical project ID for tasks.
    pub project: Option<Uuid>,
    /// Optional parent task in the same project.
    pub parent: Option<Uuid>,
    /// Canonical repository ID for branch registrations.
    pub repository: Option<Uuid>,
    /// Legacy Git transport coordinate for repository adoption.
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
    /// Object state; document Markdown, task status/assignees, etc.
    pub state: serde_json::Value,
}

fn is_id(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

/// Parse and validate the complete routing envelope before authorization/storage.
pub fn parse(event: &Event) -> Result<Revision, String> {
    let kind = event.kind.as_u16() as u32;
    if !is_work_object(kind) {
        return Err("not a canonical work-object kind".into());
    }
    let revision: Revision = serde_json::from_str(&event.content).map_err(|e| e.to_string())?;
    let h = &revision.home;
    if h.object.is_nil() || h.channel.is_nil() {
        return Err("nil object/channel identity".into());
    }
    let tags: Vec<_> = event.tags.iter().map(|t| t.as_slice()).collect();
    // Keep all routing unambiguous. References belong in state, not overloaded e/h tags.
    if tags.len() != 2
        || !tags.iter().any(|t| *t == ["h", &h.channel.to_string()])
        || !tags.iter().any(|t| *t == ["object", &h.object.to_string()])
    {
        return Err("expected exactly h and object tags matching the snapshot".into());
    }
    if revision.previous.as_deref().is_some_and(|p| !is_id(p))
        || h.root.as_deref().is_some_and(|p| !is_id(p))
        || (revision.deleted && revision.previous.is_none())
    {
        return Err("invalid revision/root ID or creation tombstone".into());
    }
    let thread = matches!(kind, KIND_WORK_TASK | KIND_WORK_DOCUMENT | KIND_WORK_BRANCH);
    if thread != h.root.is_some()
        || (kind == KIND_WORK_TASK) != h.project.is_some()
        || (h.parent.is_some() && kind != KIND_WORK_TASK)
        || (kind == KIND_WORK_REPOSITORY) != h.git.is_some()
        || (kind == KIND_WORK_BRANCH) != h.repository.is_some()
        || (kind == KIND_WORK_BRANCH) != h.branch.is_some()
        || [h.project, h.parent, h.repository]
            .into_iter()
            .flatten()
            .any(|id| id.is_nil() || id == h.object)
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
    use nostr::{EventBuilder, Keys, Kind, Tag};

    fn snapshot(kind: u32) -> Revision {
        Revision {
            home: Home {
                object: Uuid::new_v4(),
                channel: Uuid::new_v4(),
                root: matches!(kind, KIND_WORK_TASK | KIND_WORK_DOCUMENT | KIND_WORK_BRANCH)
                    .then(|| "a".repeat(64)),
                project: (kind == KIND_WORK_TASK).then(Uuid::new_v4),
                parent: None,
                repository: (kind == KIND_WORK_BRANCH).then(Uuid::new_v4),
                git: (kind == KIND_WORK_REPOSITORY)
                    .then(|| format!("30617:{}:repo", "b".repeat(64))),
                branch: (kind == KIND_WORK_BRANCH).then(|| "refs/heads/main".into()),
            },
            previous: None,
            deleted: false,
            state: serde_json::json!({"title":"hello"}),
        }
    }
    fn event(kind: u32, r: &Revision, extra: Option<Tag>) -> Event {
        let mut tags = vec![
            Tag::parse(["h", &r.home.channel.to_string()]).unwrap(),
            Tag::parse(["object", &r.home.object.to_string()]).unwrap(),
        ];
        tags.extend(extra);
        EventBuilder::new(Kind::Custom(kind as u16), serde_json::to_string(r).unwrap())
            .tags(tags)
            .sign_with_keys(&Keys::generate())
            .unwrap()
    }
    #[test]
    fn strict_envelopes_for_all_types() {
        for kind in [
            KIND_WORK_PROJECT,
            KIND_WORK_REPOSITORY,
            KIND_WORK_TASK,
            KIND_WORK_DOCUMENT,
            KIND_WORK_BRANCH,
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
            invalid.home.object = Uuid::nil();
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
    fn branch_names_and_task_relationships_are_strict() {
        let mut r = snapshot(KIND_WORK_BRANCH);
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
            assert!(parse(&event(KIND_WORK_BRANCH, &r, None)).is_err(), "{name}");
        }
        let mut task = snapshot(KIND_WORK_TASK);
        task.home.parent = Some(task.home.object);
        assert!(parse(&event(KIND_WORK_TASK, &task, None)).is_err());
    }
}
