//! Durable channel-backed sessions. Parent membership is resolved at read time.

use buzz_core::{CommunityId, StoredEvent};
use nostr::Event;
use serde::Deserialize;
use sqlx::{Postgres, Row, Transaction};
use uuid::Uuid;

use crate::{channel_members::acquire_channel_membership_lock, Db, DbError, Result};

/// Session metadata independent of the channel's message storage.
#[derive(Debug, Clone)]
pub struct SessionInfo {
    /// A parent supplies the entire current membership and role set.
    pub parent_id: Option<Uuid>,
}

/// Commands are scoped by the signed event's single `h` tag.
#[derive(Debug, Deserialize)]
#[serde(tag = "action", rename_all = "snake_case", deny_unknown_fields)]
pub enum SessionCommand {
    /// Create a private standalone session or a child of an existing channel.
    Create {
        /// Initial topic, generated from the first prompt by the client.
        title: String,
        /// Omitted for independent access.
        parent_id: Option<Uuid>,
    },
    /// Share a standalone session's whole history with a parent channel.
    Move {
        /// The channel that will control access.
        parent_id: Uuid,
        /// Explicit acknowledgement of full-history sharing and access changes.
        confirm_history: bool,
    },
}

/// Reject independent roster writes on children while holding their membership lock.
pub(crate) async fn require_independent_membership(
    tx: &mut Transaction<'_, Postgres>,
    community: CommunityId,
    channel: Uuid,
) -> Result<()> {
    let parent: Option<Uuid> = sqlx::query_scalar(
        "SELECT parent_channel_id FROM channels WHERE community_id=$1 AND id=$2",
    )
    .bind(community.as_uuid())
    .bind(channel)
    .fetch_optional(&mut **tx)
    .await?
    .flatten();
    if parent.is_some() {
        return Err(DbError::AccessDenied(
            "manage members in the parent channel".into(),
        ));
    }
    Ok(())
}

impl Db {
    /// Read a session's complete conversation, including agent replies, with bounded keyset paging.
    pub async fn session_window(
        &self,
        community: CommunityId,
        id: Uuid,
        limit: u32,
        cursor: Option<(chrono::DateTime<chrono::Utc>, Vec<u8>)>,
        kinds: Option<&[u32]>,
    ) -> Result<(crate::thread::ChannelWindow, crate::ReadSession)> {
        if self.session_info(community, id).await?.is_none() {
            return Err(DbError::InvalidData(
                "session timeline requires a session".into(),
            ));
        }
        let mut conn = self.pool.acquire().await?;
        let window = crate::thread::get_conversation_window_on(
            &mut conn, community, id, limit, cursor, kinds, true,
        )
        .await?;
        Ok((
            window,
            crate::ReadSession {
                inner: crate::ReadSessionInner::Writer(self.pool.clone()),
            },
        ))
    }

    /// Read a session's parent from the authoritative writer database.
    pub async fn session_info(
        &self,
        community: CommunityId,
        id: Uuid,
    ) -> Result<Option<SessionInfo>> {
        let row = sqlx::query("SELECT parent_channel_id FROM channels WHERE community_id=$1 AND id=$2 AND is_session AND deleted_at IS NULL")
            .bind(community.as_uuid()).bind(id).fetch_optional(&self.pool).await?;
        row.map(|row| {
            Ok(SessionInfo {
                parent_id: row.try_get("parent_channel_id")?,
            })
        })
        .transpose()
    }

    /// Direct children only; sessions cannot themselves be parents.
    pub async fn child_sessions(&self, community: CommunityId, parent: Uuid) -> Result<Vec<Uuid>> {
        Ok(sqlx::query_scalar("SELECT id FROM channels WHERE community_id=$1 AND parent_channel_id=$2 AND deleted_at IS NULL ORDER BY id")
            .bind(community.as_uuid()).bind(parent).fetch_all(&self.pool).await?)
    }

    /// Apply an authorized session command and store its signed receipt atomically.
    pub async fn apply_session_command(
        &self,
        community: CommunityId,
        id: Uuid,
        event: &Event,
        command: &SessionCommand,
    ) -> Result<(StoredEvent, bool)> {
        let actor = event.pubkey.to_bytes();
        let parent = match command {
            SessionCommand::Create { parent_id, .. } => *parent_id,
            SessionCommand::Move { parent_id, .. } => Some(*parent_id),
        };
        if parent == Some(id) {
            return Err(DbError::InvalidData(
                "a session cannot parent itself".into(),
            ));
        }
        let connection = crate::observability::acquire_writer(
            &self.pool,
            crate::observability::WriterOperation::EventWrite,
        )
        .await?;
        let mut tx = sqlx::Transaction::begin(connection, None).await?;
        // An ordinary channel cannot become a session. Reject it as the source
        // before taking two locks, including malformed create/move commands.
        let source_is_session: Option<bool> =
            sqlx::query_scalar("SELECT is_session FROM channels WHERE community_id=$1 AND id=$2")
                .bind(community.as_uuid())
                .bind(id)
                .fetch_optional(&mut *tx)
                .await?;
        if source_is_session == Some(false) {
            return Err(DbError::InvalidData(
                "session identifier belongs to an ordinary channel".into(),
            ));
        }
        // Session identity is immutable. Reject a session as parent before taking
        // two locks, preventing inverse child/parent lock graphs.
        if let Some(parent) = parent {
            let ordinary: bool = sqlx::query_scalar(
                "SELECT EXISTS(SELECT 1 FROM channels WHERE community_id=$1 AND id=$2 AND NOT is_session)",
            ).bind(community.as_uuid()).bind(parent).fetch_one(&mut *tx).await?;
            if !ordinary {
                return Err(DbError::AccessDenied(
                    "choose an active parent channel".into(),
                ));
            }
        }
        // Match roster publication: child membership, then parent membership.
        let mut locks = vec![id];
        locks.extend(parent);
        for channel in &locks {
            acquire_channel_membership_lock(&mut tx, community, *channel).await?;
        }
        // Match TTL updates: TTL advisory lock precedes channel row locks.
        sqlx::query("SELECT pg_advisory_xact_lock_shared(hashtextextended($1, 0))")
            .bind(format!("buzz_channel_ttl:{}:{}", community.as_uuid(), id))
            .execute(&mut *tx)
            .await?;
        // Row locks also serialize against archive/delete metadata writes.
        sqlx::query(
            "SELECT id FROM channels WHERE community_id=$1 AND id=ANY($2) ORDER BY id FOR UPDATE",
        )
        .bind(community.as_uuid())
        .bind(&locks)
        .fetch_all(&mut *tx)
        .await?;
        // Retrying an exact accepted command must not repeat a move or create.
        let previous: bool = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM events WHERE community_id=$1 AND id=$2)",
        )
        .bind(community.as_uuid())
        .bind(event.id.as_bytes().as_slice())
        .fetch_one(&mut *tx)
        .await?;
        if previous {
            let member: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM effective_channel_members m JOIN channels c ON c.community_id=m.community_id AND c.id=m.channel_id WHERE m.community_id=$1 AND m.channel_id=$2 AND m.pubkey=$3 AND m.removed_at IS NULL AND c.deleted_at IS NULL)")
                .bind(community.as_uuid()).bind(id).bind(actor.as_slice()).fetch_one(&mut *tx).await?;
            if !member {
                return Err(DbError::AccessDenied("session access has changed".into()));
            }
            let result = crate::event::insert_event_with_thread_metadata_tx(
                &mut tx,
                community,
                event,
                Some(id),
                None,
            )
            .await?;
            tx.commit().await?;
            return Ok(result);
        }
        if let Some(parent) = parent {
            // Locks serialize against both membership changes and a concurrent move.
            let allowed: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM channels c JOIN effective_channel_members m ON m.community_id=c.community_id AND m.channel_id=c.id WHERE c.community_id=$1 AND c.id=$2 AND NOT c.is_session AND c.channel_type IN ('stream','forum') AND c.archived_at IS NULL AND c.deleted_at IS NULL AND m.pubkey=$3 AND m.removed_at IS NULL)")
                .bind(community.as_uuid()).bind(parent).bind(actor.as_slice()).fetch_one(&mut *tx).await?;
            if !allowed {
                return Err(DbError::AccessDenied(
                    "choose an active channel you belong to".into(),
                ));
            }
        }
        match command {
            SessionCommand::Create { title, .. } => {
                if title.trim().is_empty() || title.chars().count() > 120 {
                    return Err(DbError::InvalidData(
                        "session title must contain 1 to 120 characters".into(),
                    ));
                }
                let exists: bool = sqlx::query_scalar(
                    "SELECT EXISTS(SELECT 1 FROM channels WHERE community_id=$1 AND id=$2)",
                )
                .bind(community.as_uuid())
                .bind(id)
                .fetch_one(&mut *tx)
                .await?;
                if exists {
                    return Err(DbError::InvalidData(
                        "session identifier already exists".into(),
                    ));
                }
                sqlx::query("INSERT INTO channels (community_id,id,name,channel_type,visibility,created_by,is_session,parent_channel_id) VALUES ($1,$2,$3,'stream','private',$4,true,$5)")
                    .bind(community.as_uuid()).bind(id).bind(title.trim()).bind(actor.as_slice()).bind(parent).execute(&mut *tx).await?;
                if parent.is_none() {
                    sqlx::query("INSERT INTO channel_members (community_id,channel_id,pubkey,role,invited_by) VALUES ($1,$2,$3,'owner',$3)")
                        .bind(community.as_uuid()).bind(id).bind(actor.as_slice()).execute(&mut *tx).await?;
                }
            }
            SessionCommand::Move {
                parent_id,
                confirm_history,
            } => {
                if !confirm_history {
                    return Err(DbError::InvalidData(
                        "confirm sharing the entire session history".into(),
                    ));
                }
                let owned: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM channels c JOIN channel_members m ON m.community_id=c.community_id AND m.channel_id=c.id WHERE c.community_id=$1 AND c.id=$2 AND c.is_session AND c.parent_channel_id IS NULL AND c.deleted_at IS NULL AND c.archived_at IS NULL AND m.pubkey=$3 AND m.role='owner' AND m.removed_at IS NULL)")
                    .bind(community.as_uuid()).bind(id).bind(actor.as_slice()).fetch_one(&mut *tx).await?;
                if !owned {
                    return Err(DbError::AccessDenied(
                        "only a standalone session owner can move it".into(),
                    ));
                }
                let missing: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM channel_members s WHERE s.community_id=$1 AND s.channel_id=$2 AND s.removed_at IS NULL AND NOT EXISTS(SELECT 1 FROM effective_channel_members p WHERE p.community_id=s.community_id AND p.channel_id=$3 AND p.pubkey=s.pubkey AND p.removed_at IS NULL))")
                    .bind(community.as_uuid()).bind(id).bind(parent_id).fetch_one(&mut *tx).await?;
                if missing {
                    return Err(DbError::AccessDenied(
                        "add every session participant to the destination channel before moving"
                            .into(),
                    ));
                }
                sqlx::query("UPDATE channels SET parent_channel_id=$3,updated_at=NOW() WHERE community_id=$1 AND id=$2")
                    .bind(community.as_uuid()).bind(id).bind(parent_id).execute(&mut *tx).await?;
            }
        }
        let result = crate::event::insert_event_with_thread_metadata_tx(
            &mut tx,
            community,
            event,
            Some(id),
            None,
        )
        .await?;
        tx.commit().await?;
        Ok(result)
    }
}

#[cfg(test)]
mod postgres_tests {
    use super::*;
    use crate::channel::{ChannelType, ChannelVisibility, MemberRole};
    use nostr::{EventBuilder, Keys, Kind, Tag};

    fn command(keys: &Keys, id: Uuid, body: serde_json::Value) -> Event {
        EventBuilder::new(Kind::Custom(9050), body.to_string())
            .tags([Tag::parse(["h", &id.to_string()]).unwrap()])
            .sign_with_keys(keys)
            .unwrap()
    }

    #[tokio::test]
    #[ignore = "requires Postgres"]
    async fn session_creation_move_and_revocation() {
        exercise_session_creation_move_and_revocation().await;
    }

    #[tokio::test]
    #[ignore = "requires Postgres"]
    async fn migration_schema_session_creation_move_and_revocation() {
        exercise_session_creation_move_and_revocation().await;
    }

    async fn exercise_session_creation_move_and_revocation() {
        let url = crate::test_support::database_url();
        let db = Db::new(&crate::DbConfig {
            database_url: url,
            ..Default::default()
        })
        .await
        .unwrap();
        if std::env::var("BUZZ_TEST_SCHEMA_MODE").as_deref() != Ok("desired") {
            db.migrate().await.unwrap();
        }
        let community = CommunityId::from_uuid(Uuid::new_v4());
        sqlx::query("INSERT INTO communities(id,host) VALUES ($1,$2)")
            .bind(community.as_uuid())
            .bind(format!("sessions-{}.test", community.as_uuid()))
            .execute(&db.pool)
            .await
            .unwrap();
        let owner = Keys::generate();
        let guest = Keys::generate();
        let owner_key = owner.public_key().to_bytes();
        let guest_key = guest.public_key().to_bytes();
        crate::user::ensure_user(&db.pool, community, &owner_key)
            .await
            .unwrap();
        crate::user::ensure_user(&db.pool, community, &guest_key)
            .await
            .unwrap();
        let parent = db
            .create_channel(
                community,
                "Team",
                ChannelType::Stream,
                ChannelVisibility::Private,
                None,
                &owner_key,
                None,
            )
            .await
            .unwrap();
        let session = Uuid::new_v4();
        let create = command(
            &owner,
            session,
            serde_json::json!({"action":"create","title":"Review the layout"}),
        );
        let parsed = serde_json::from_str(&create.content).unwrap();
        assert!(
            db.apply_session_command(community, session, &create, &parsed)
                .await
                .unwrap()
                .1
        );
        assert!(
            !db.apply_session_command(community, session, &create, &parsed)
                .await
                .unwrap()
                .1,
            "exact retries do not create another session"
        );
        assert!(db.is_member(community, session, &owner_key).await.unwrap());
        assert!(!db.is_member(community, session, &guest_key).await.unwrap());
        db.add_member(
            community,
            session,
            &guest_key,
            MemberRole::Member,
            Some(&owner_key),
        )
        .await
        .unwrap();
        let unauthorized = command(
            &guest,
            session,
            serde_json::json!({"action":"move","parent_id":parent.id,"confirm_history":true}),
        );
        assert!(db
            .apply_session_command(
                community,
                session,
                &unauthorized,
                &serde_json::from_str(&unauthorized.content).unwrap()
            )
            .await
            .is_err());
        let foreign_id = Uuid::new_v4();
        let foreign = command(
            &owner,
            foreign_id,
            serde_json::json!({"action":"create","title":"Foreign","parent_id":parent.id}),
        );
        assert!(db
            .apply_session_command(
                CommunityId::from_uuid(Uuid::new_v4()),
                foreign_id,
                &foreign,
                &serde_json::from_str(&foreign.content).unwrap()
            )
            .await
            .is_err());
        // Session windows retain replies; ordinary channel windows retain roots.
        let root = EventBuilder::new(Kind::Custom(9), "Prompt")
            .tags([Tag::parse(["h", &session.to_string()]).unwrap()])
            .sign_with_keys(&owner)
            .unwrap();
        let reply = EventBuilder::new(Kind::Custom(9), "Agent reply")
            .tags([Tag::parse(["h", &session.to_string()]).unwrap()])
            .sign_with_keys(&guest)
            .unwrap();
        let root_time =
            chrono::DateTime::from_timestamp(root.created_at.as_secs() as i64, 0).unwrap();
        let reply_time =
            chrono::DateTime::from_timestamp(reply.created_at.as_secs() as i64, 0).unwrap();
        crate::event::insert_event_with_thread_metadata(
            &db.pool,
            community,
            &root,
            Some(session),
            None,
        )
        .await
        .unwrap();
        crate::event::insert_event_with_thread_metadata(
            &db.pool,
            community,
            &reply,
            Some(session),
            Some(crate::event::ThreadMetadataParams {
                event_id: reply.id.as_bytes(),
                event_created_at: reply_time,
                channel_id: session,
                parent_event_id: Some(root.id.as_bytes()),
                parent_event_created_at: Some(root_time),
                root_event_id: Some(root.id.as_bytes()),
                root_event_created_at: Some(root_time),
                depth: 1,
                broadcast: false,
            }),
        )
        .await
        .unwrap();
        let (timeline, _) = db
            .session_window(community, session, 20, None, Some(&[9]))
            .await
            .unwrap();
        assert_eq!(timeline.rows.len(), 2);
        let (page, _) = db
            .session_window(community, session, 1, None, Some(&[9]))
            .await
            .unwrap();
        assert_eq!(page.rows.len(), 1);
        assert!(page.has_more);
        assert!(db
            .session_window(community, parent.id, 20, None, None)
            .await
            .is_err());
        let move_event = command(
            &owner,
            session,
            serde_json::json!({"action":"move","parent_id":parent.id,"confirm_history":true}),
        );
        let movement = serde_json::from_str(&move_event.content).unwrap();
        assert!(
            db.apply_session_command(community, session, &move_event, &movement)
                .await
                .is_err(),
            "missing participants prevent history sharing"
        );
        assert!(db
            .session_info(community, session)
            .await
            .unwrap()
            .unwrap()
            .parent_id
            .is_none());
        db.add_member(
            community,
            parent.id,
            &guest_key,
            MemberRole::Member,
            Some(&owner_key),
        )
        .await
        .unwrap();
        db.apply_session_command(community, session, &move_event, &movement)
            .await
            .unwrap();
        assert_eq!(
            db.session_info(community, session)
                .await
                .unwrap()
                .unwrap()
                .parent_id,
            Some(parent.id)
        );
        assert!(
            db.remove_member(community, session, &guest_key, &owner_key)
                .await
                .is_err(),
            "a child cannot override its parent roster"
        );
        db.remove_member(community, parent.id, &guest_key, &owner_key)
            .await
            .unwrap();
        assert!(
            !db.is_member(community, session, &guest_key).await.unwrap(),
            "old standalone membership never survives parent revocation"
        );
        assert!(!db
            .get_accessible_channel_ids(community, &guest_key)
            .await
            .unwrap()
            .contains(&session));
        assert!(!db
            .get_members(community, session)
            .await
            .unwrap()
            .iter()
            .any(|member| member.pubkey == guest_key));
        let child = Uuid::new_v4();
        let child_event = command(
            &owner,
            child,
            serde_json::json!({"action":"create","title":"Child work","parent_id":parent.id}),
        );
        db.apply_session_command(
            community,
            child,
            &child_event,
            &serde_json::from_str(&child_event.content).unwrap(),
        )
        .await
        .unwrap();
        // Capture and publish the inherited roster through the production
        // replacement guard (including the database INSERT trigger).
        let relay = Keys::generate();
        let mut snapshot = db
            .lock_member_snapshot(community, child, &relay.public_key().to_bytes())
            .await
            .unwrap();
        assert_eq!(snapshot.members.len(), 1);
        assert_eq!(snapshot.members[0].pubkey, owner_key);
        let roster = EventBuilder::new(Kind::Custom(39002), "")
            .tags([
                Tag::parse(["d", &child.to_string()]).unwrap(),
                Tag::parse(["p", &hex::encode(owner_key), "", "owner"]).unwrap(),
            ])
            .sign_with_keys(&relay)
            .unwrap();
        assert!(
            snapshot
                .replace_member_event(community, child, &roster)
                .await
                .unwrap()
                .1
        );
        let mut contender = db.pool.begin().await.unwrap();
        let unlocked: bool =
            sqlx::query_scalar("SELECT pg_try_advisory_xact_lock(hashtextextended($1,0))")
                .bind(format!(
                    "buzz_channel_membership:{}:{}",
                    community.as_uuid(),
                    parent.id
                ))
                .fetch_one(&mut *contender)
                .await
                .unwrap();
        assert!(
            !unlocked,
            "parent mutations must wait for child roster publication"
        );
        contender.rollback().await.unwrap();
        snapshot.release().await.unwrap();
        // A legacy publisher's empty physical roster is rejected by the trigger.
        let stale = EventBuilder::new(Kind::Custom(39002), "")
            .tags([Tag::parse(["d", &child.to_string()]).unwrap()])
            .sign_with_keys(&Keys::generate())
            .unwrap();
        assert!(crate::event::insert_event_with_thread_metadata(
            &db.pool,
            community,
            &stale,
            Some(child),
            None,
        )
        .await
        .is_err());
        // Administrative removal shares the parent lock and never edits a
        // child's unused physical roster.
        db.add_member(
            community,
            parent.id,
            &guest_key,
            MemberRole::Member,
            Some(&owner_key),
        )
        .await
        .unwrap();
        assert!(db.is_member(community, child, &guest_key).await.unwrap());
        assert!(db
            .deploy_kick_member(community, child, &guest_key, &owner_key)
            .await
            .is_err());
        db.deploy_kick_member(community, parent.id, &guest_key, &owner_key)
            .await
            .unwrap();
        assert!(!db.is_member(community, child, &guest_key).await.unwrap());
        let nested_id = Uuid::new_v4();
        let nested = command(
            &owner,
            nested_id,
            serde_json::json!({"action":"create","title":"Nested","parent_id":child}),
        );
        assert!(db
            .apply_session_command(
                community,
                nested_id,
                &nested,
                &serde_json::from_str(&nested.content).unwrap()
            )
            .await
            .is_err());
        db.soft_delete_channel(community, parent.id).await.unwrap();
        assert!(
            db.apply_session_command(
                community,
                child,
                &child_event,
                &serde_json::from_str(&child_event.content).unwrap()
            )
            .await
            .is_err(),
            "accepted receipts cannot restore revoked access"
        );
        assert!(
            !db.is_member(community, child, &owner_key).await.unwrap(),
            "deleted parents revoke child access"
        );
    }
}
