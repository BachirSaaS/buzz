//! Transactional canonical home index. Claims are never inferred from references.
use buzz_core::{kind::*, work_object::Revision, CommunityId};
use nostr::Event;
use sqlx::{Acquire, Postgres, Row, Transaction};
use uuid::Uuid;

use crate::{Db, DbError, Result};
use buzz_core::StoredEvent;

fn invalid(reason: &str) -> DbError {
    DbError::InvalidData(format!("canonical object: {reason}"))
}

async fn membership(
    tx: &mut Transaction<'_, Postgres>,
    community: CommunityId,
    channel: Uuid,
    actor: &[u8],
    admin: bool,
) -> Result<()> {
    // Lock against removal/role changes and channel archive/delete for this commit.
    let row = sqlx::query("SELECT m.role::text AS role FROM channel_members m JOIN channels c ON c.community_id=m.community_id AND c.id=m.channel_id WHERE m.community_id=$1 AND m.channel_id=$2 AND m.pubkey=$3 AND m.removed_at IS NULL AND c.archived_at IS NULL AND c.deleted_at IS NULL AND c.ttl_seconds IS NULL FOR SHARE OF m,c")
        .bind(community.as_uuid()).bind(channel).bind(actor).fetch_optional(&mut **tx).await?;
    let row = row.ok_or_else(|| invalid("active durable channel membership required"))?;
    let role: String = row.try_get("role")?;
    if role == "guest" || (admin && role != "owner" && role != "admin") {
        return Err(invalid("channel role cannot claim or update this object"));
    }
    Ok(())
}

async fn related(
    tx: &mut Transaction<'_, Postgres>,
    community: CommunityId,
    id: Uuid,
    kind: u32,
) -> Result<(Uuid, Revision)> {
    let row = sqlx::query("SELECT channel_id, home FROM work_objects WHERE community_id=$1 AND object_id=$2 AND kind=$3 AND NOT deleted")
        .bind(community.as_uuid()).bind(id).bind(kind as i32).fetch_optional(&mut **tx).await?
        .ok_or_else(|| invalid("missing or retired related object"))?;
    let home = serde_json::from_value(row.try_get("home")?).map_err(|e| invalid(&e.to_string()))?;
    Ok((
        row.try_get("channel_id")?,
        Revision {
            home,
            previous: None,
            deleted: false,
            state: serde_json::Value::Null,
        },
    ))
}

impl Db {
    /// Accept a signed snapshot and its exclusive home in one transaction.
    /// The caller must verify signature, authenticated author, scopes and moderation.
    /// Object authority, durable channel membership and CAS are rechecked here.
    pub async fn accept_work_object(
        &self,
        community: CommunityId,
        event: &Event,
    ) -> Result<(StoredEvent, bool)> {
        let revision = buzz_core::work_object::parse(event).map_err(|e| invalid(&e))?;
        let h = &revision.home;
        let kind = event.kind.as_u16() as u32;
        let actor = event.pubkey.to_bytes();
        let mut conn = crate::observability::acquire_writer(
            &self.pool,
            crate::observability::WriterOperation::EventWrite,
        )
        .await?;
        let mut tx = conn.begin().await?;
        // Draft deliberately serializes object declarations within one community.
        // Ordinary messages and Git ref writes do not acquire this lock. Unique
        // indexes remain the structural backstop. Split locks only with race tests.
        sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1, 45010))")
            .bind(community.as_uuid().to_string())
            .execute(&mut *tx)
            .await?;
        membership(
            &mut tx,
            community,
            h.channel,
            &actor,
            matches!(kind, KIND_WORK_PROJECT | KIND_WORK_REPOSITORY),
        )
        .await?;
        let existing = sqlx::query("SELECT kind, home, head, deleted FROM work_objects WHERE community_id=$1 AND object_id=$2 FOR UPDATE")
            .bind(community.as_uuid()).bind(h.object).fetch_optional(&mut *tx).await?;
        let home_json = serde_json::to_value(h).map_err(|e| invalid(&e.to_string()))?;
        if let Some(row) = existing {
            let head: Vec<u8> = row.try_get("head")?;
            if head == event.id.as_bytes() {
                tx.commit().await?;
                return Ok((StoredEvent::new(event.clone(), Some(h.channel)), false));
            }
            if row.try_get::<i32, _>("kind")? != kind as i32
                || row.try_get::<serde_json::Value, _>("home")? != home_json
            {
                return Err(invalid("type, identity and home are immutable"));
            }
            if row.try_get::<bool, _>("deleted")?
                || revision.previous.as_deref() != Some(hex::encode(head).as_str())
            {
                return Err(invalid("stale revision or terminal tombstone"));
            }
        } else if revision.previous.is_some() {
            return Err(invalid("creation cannot name a previous revision"));
        }
        if let Some(root) = &h.root {
            let root = hex::decode(root).map_err(|_| invalid("invalid root"))?;
            let valid: bool = sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM events e JOIN thread_metadata t ON t.community_id=e.community_id AND t.event_id=e.id AND t.event_created_at=e.created_at WHERE e.community_id=$1 AND e.id=$2 AND e.channel_id=$3 AND e.deleted_at IS NULL AND e.kind IN (9,40002,45001) AND t.depth=0 AND t.parent_event_id IS NULL)")
                .bind(community.as_uuid()).bind(&root).bind(h.channel).fetch_one(&mut *tx).await?;
            if !valid {
                return Err(invalid(
                    "home must be an ordinary live thread root in the channel",
                ));
            }
        }
        if let Some(project) = h.project {
            let (channel, _) = related(&mut tx, community, project, KIND_WORK_PROJECT).await?;
            if channel != h.channel {
                return Err(invalid("task must live in its project channel"));
            }
        }
        if let Some(parent) = h.parent {
            let (_, parent) = related(&mut tx, community, parent, KIND_WORK_TASK).await?;
            if parent.home.project != h.project {
                return Err(invalid("subtask must share its parent project"));
            }
        }
        if let Some(repository) = h.repository {
            let (channel, _) =
                related(&mut tx, community, repository, KIND_WORK_REPOSITORY).await?;
            membership(&mut tx, community, channel, &actor, true).await?;
            // Branches may share task roots or standalone roots, not document roots.
            let document: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM work_objects WHERE community_id=$1 AND root_id=$2 AND kind=45013)")
                .bind(community.as_uuid()).bind(h.root.as_ref().and_then(|r| hex::decode(r).ok())).fetch_one(&mut *tx).await?;
            if document {
                return Err(invalid("branch cannot claim a document thread"));
            }
        }
        if kind == KIND_WORK_DOCUMENT {
            let branch: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM work_objects WHERE community_id=$1 AND root_id=$2 AND kind=45014)")
                .bind(community.as_uuid()).bind(h.root.as_ref().and_then(|r| hex::decode(r).ok())).fetch_one(&mut *tx).await?;
            if branch {
                return Err(invalid("document cannot claim a branch thread"));
            }
        }
        if let Some(git) = &h.git {
            let parts: Vec<_> = git.splitn(3, ':').collect();
            if parts[1] != event.pubkey.to_hex() {
                return Err(invalid(
                    "repository adoption requires the Git owner signature",
                ));
            }
            let tags: Option<serde_json::Value> = sqlx::query_scalar("SELECT tags FROM events WHERE community_id=$1 AND kind=30617 AND pubkey=$2 AND d_tag=$3 AND deleted_at IS NULL ORDER BY created_at DESC,id LIMIT 1 FOR SHARE")
                .bind(community.as_uuid()).bind(actor.as_slice()).bind(parts[2]).fetch_optional(&mut *tx).await?;
            let tags: Vec<Vec<String>> = serde_json::from_value(
                tags.ok_or_else(|| invalid("announce the Git repository before adoption"))?,
            )
            .map_err(|e| invalid(&e.to_string()))?;
            let bindings: Vec<_> = tags
                .iter()
                .filter(|t| t.first().is_some_and(|v| v == "buzz-channel"))
                .collect();
            if bindings.len() != 1 || bindings[0].get(1) != Some(&h.channel.to_string()) {
                return Err(invalid("Git binding must match canonical repository home"));
            }
        }
        sqlx::query("INSERT INTO work_objects (community_id,object_id,kind,channel_id,root_id,repository_id,git_coordinate,branch_ref,home,head,deleted) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT (community_id,object_id) DO UPDATE SET head=EXCLUDED.head, deleted=EXCLUDED.deleted")
            .bind(community.as_uuid()).bind(h.object).bind(kind as i32).bind(h.channel)
            .bind(h.root.as_ref().and_then(|r| hex::decode(r).ok())).bind(h.repository).bind(&h.git).bind(&h.branch)
            .bind(home_json).bind(event.id.as_bytes().as_slice()).bind(revision.deleted).execute(&mut *tx).await
            .map_err(|e| if e.as_database_error().is_some_and(|e| e.is_unique_violation()) { invalid("room or code identity already claimed") } else {e.into()})?;
        let result =
            crate::event::insert_event_in_transaction(&mut tx, community, event, Some(h.channel))
                .await?;
        tx.commit().await?;
        Ok(result)
    }
}

/// Fence legacy repository replacements against the adopted, immutable home.
/// Uses the same community lock as adoption, so replacement cannot race a claim.
pub(crate) async fn guard_repository_replacement(
    tx: &mut Transaction<'_, Postgres>,
    community: CommunityId,
    event: &Event,
    d_tag: &str,
) -> Result<()> {
    if event.kind.as_u16() as u32 != KIND_GIT_REPO_ANNOUNCEMENT {
        return Ok(());
    }
    sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1, 45010))")
        .bind(community.as_uuid().to_string())
        .execute(&mut **tx)
        .await?;
    let coordinate = format!("30617:{}:{d_tag}", event.pubkey.to_hex());
    let row = sqlx::query(
        "SELECT channel_id, deleted FROM work_objects WHERE community_id=$1 AND git_coordinate=$2",
    )
    .bind(community.as_uuid())
    .bind(coordinate)
    .fetch_optional(&mut **tx)
    .await?;
    if let Some(row) = row {
        let channel: Uuid = row.try_get("channel_id")?;
        let bindings: Vec<_> = event
            .tags
            .iter()
            .filter(|t| t.as_slice().first().is_some_and(|v| v == "buzz-channel"))
            .collect();
        if row.try_get::<bool, _>("deleted")?
            || bindings.len() != 1
            || bindings[0].content() != Some(channel.to_string().as_str())
        {
            return Err(invalid(
                "legacy write cannot change an adopted repository home",
            ));
        }
    }
    Ok(())
}

#[cfg(test)]
#[path = "work_object_postgres_tests.rs"]
mod postgres_tests;

/// Internal event writers cannot bypass canonical acceptance or drop its audience.
pub(crate) async fn guard_event_insert(
    connection: &mut sqlx::PgConnection,
    community: CommunityId,
    event: &Event,
    channel: Option<Uuid>,
) -> Result<()> {
    if !is_work_object(event.kind.as_u16() as u32) {
        return Ok(());
    }
    let revision = buzz_core::work_object::parse(event).map_err(|e| invalid(&e))?;
    if channel != Some(revision.home.channel) {
        return Err(invalid("canonical state cannot be global"));
    }
    let accepted: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM work_objects WHERE community_id=$1 AND object_id=$2 AND head=$3 AND channel_id=$4)")
        .bind(community.as_uuid()).bind(revision.home.object).bind(event.id.as_bytes().as_slice()).bind(channel)
        .fetch_one(connection).await?;
    if !accepted {
        return Err(invalid("use atomic canonical acceptance"));
    }
    Ok(())
}
