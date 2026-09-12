//! Forward-only workflow deletion proofs, serialized with NIP-33 replacement.
//! One fixed-size row per deleted coordinate; no workflow content or secrets.

use buzz_core::{kind::KIND_WORKFLOW_DEF, CommunityId};
use chrono::{DateTime, Utc};
use sqlx::{Postgres, Transaction};
use uuid::Uuid;

use crate::{observability, replaceable::event_replacement_lock_key, Result};

/// Signed live head and its server-resolved channel.
#[derive(Debug, sqlx::FromRow)]
pub struct Head {
    /// Signed timestamp, not server receipt time.
    pub created_at: DateTime<Utc>,
    /// Exact signed definition ID.
    pub id: Vec<u8>,
    /// Stored channel scope; absent legacy scope is not authoritative.
    pub channel_id: Option<Uuid>,
}

/// Latest committed forward deletion for this coordinate.
#[derive(Debug, sqlx::FromRow)]
pub struct Deletion {
    /// Actual channel resolved by the successful transaction.
    pub channel_id: Uuid,
    /// Older/equal unseen saves must not revive this coordinate.
    pub deleted_through: DateTime<Utc>,
    /// Exact deletion whose atomic transaction committed.
    pub event_id: Vec<u8>,
}

/// Take the same lock as canonical kind-30620 replacement. The caller owns the transaction.
pub async fn lock_coordinate(
    tx: &mut Transaction<'_, Postgres>,
    community: CommunityId,
    owner: &[u8],
    id: Uuid,
) -> Result<()> {
    let d_tag = id.to_string();
    let key = event_replacement_lock_key(
        community,
        KIND_WORKFLOW_DEF as i32,
        owner,
        Some(d_tag.as_bytes()),
    );
    observability::observe_advisory_lock(
        observability::LockType::Replacement,
        sqlx::query("SELECT pg_advisory_xact_lock($1)")
            .bind(key)
            .execute(&mut **tx),
    )
    .await?;
    Ok(())
}

/// Read the live definition under the coordinate lock.
pub async fn head(
    tx: &mut Transaction<'_, Postgres>,
    community: CommunityId,
    owner: &[u8],
    id: Uuid,
) -> Result<Option<Head>> {
    Ok(sqlx::query_as(
        "SELECT created_at, id, channel_id FROM events WHERE community_id=$1 AND kind=$2 \
         AND pubkey=$3 AND d_tag=$4 AND deleted_at IS NULL ORDER BY created_at DESC, id ASC LIMIT 1",
    ).bind(community.as_uuid()).bind(KIND_WORKFLOW_DEF as i32).bind(owner).bind(id.to_string())
    .fetch_optional(&mut **tx).await?)
}

/// Read the trusted forward cutoff. Accepted legacy deletion events are never consulted.
pub async fn deletion(
    tx: &mut Transaction<'_, Postgres>,
    community: CommunityId,
    owner: &[u8],
    id: Uuid,
) -> Result<Option<Deletion>> {
    Ok(sqlx::query_as(
        "SELECT channel_id, deleted_through, event_id FROM workflow_deletions \
         WHERE community_id=$1 AND owner_pubkey=$2 AND workflow_id=$3",
    )
    .bind(community.as_uuid())
    .bind(owner)
    .bind(id)
    .fetch_optional(&mut **tx)
    .await?)
}

/// Recognize exact stored events, including soft-deleted versions, without reapplying them.
pub async fn event_seen(
    tx: &mut Transaction<'_, Postgres>,
    community: CommunityId,
    event: &nostr::Event,
) -> Result<bool> {
    Ok(sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM events WHERE community_id=$1 AND id=$2 AND created_at=$3)",
    )
    .bind(community.as_uuid())
    .bind(event.id.as_bytes().as_slice())
    .bind(
        DateTime::from_timestamp(event.created_at.as_secs() as i64, 0).ok_or(
            crate::DbError::InvalidTimestamp(event.created_at.as_secs() as i64),
        )?,
    )
    .fetch_one(&mut **tx)
    .await?)
}

/// Mutate both projections and advance the proof in the caller's transaction.
/// The caller must hold the coordinate lock, validate owner/channel and timestamp,
/// and insert the deletion event in this same transaction before committing.
pub async fn delete_in_transaction(
    tx: &mut Transaction<'_, Postgres>,
    community: CommunityId,
    owner: &[u8],
    id: Uuid,
    channel: Uuid,
    event: &nostr::Event,
) -> Result<()> {
    let through = DateTime::from_timestamp(event.created_at.as_secs() as i64, 0).ok_or(
        crate::DbError::InvalidTimestamp(event.created_at.as_secs() as i64),
    )?;
    sqlx::query("DELETE FROM workflows WHERE community_id=$1 AND id=$2 AND owner_pubkey=$3 AND channel_id=$4")
        .bind(community.as_uuid()).bind(id).bind(owner).bind(channel).execute(&mut **tx).await?;
    sqlx::query(
        "UPDATE events SET deleted_at=NOW() WHERE community_id=$1 AND kind=$2 AND pubkey=$3 \
        AND d_tag=$4 AND channel_id=$5 AND created_at <= $6 AND deleted_at IS NULL",
    )
    .bind(community.as_uuid())
    .bind(KIND_WORKFLOW_DEF as i32)
    .bind(owner)
    .bind(id.to_string())
    .bind(channel)
    .bind(through)
    .execute(&mut **tx)
    .await?;
    sqlx::query("INSERT INTO workflow_deletions (community_id, owner_pubkey, workflow_id, channel_id, deleted_through, event_id) \
        VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (community_id, owner_pubkey, workflow_id) \
        DO UPDATE SET deleted_through=EXCLUDED.deleted_through, event_id=EXCLUDED.event_id \
        WHERE workflow_deletions.deleted_through < EXCLUDED.deleted_through")
        .bind(community.as_uuid()).bind(owner).bind(id).bind(channel).bind(through)
        .bind(event.id.as_bytes().as_slice()).execute(&mut **tx).await?;
    Ok(())
}

/// Lock the active member and channel rows until the lifecycle transaction ends.
/// Returns the actual role; open-channel visibility is not workflow-author authority.
pub async fn channel_role(
    tx: &mut Transaction<'_, Postgres>,
    community: CommunityId,
    channel: Uuid,
    owner: &[u8],
) -> Result<Option<String>> {
    Ok(sqlx::query_scalar(
        "SELECT cm.role::text FROM channel_members cm JOIN channels c \
         ON c.community_id=cm.community_id AND c.id=cm.channel_id \
         WHERE cm.community_id=$1 AND cm.channel_id=$2 AND cm.pubkey=$3 \
         AND cm.removed_at IS NULL AND c.deleted_at IS NULL AND c.archived_at IS NULL \
         FOR SHARE OF c, cm",
    )
    .bind(community.as_uuid())
    .bind(channel)
    .bind(owner)
    .fetch_optional(&mut **tx)
    .await?)
}
