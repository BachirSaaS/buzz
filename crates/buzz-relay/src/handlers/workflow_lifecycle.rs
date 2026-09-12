//! Canonical workflow deletion: author/channel validation and a single commit.

use super::ingest::{IngestAuth, IngestError, IngestResult};
use crate::state::AppState;
use buzz_core::{kind::KIND_DELETION, TenantContext};
use buzz_db::{
    workflow::{self, lifecycle},
    DbError,
};
use nostr::Event;
use std::sync::Arc;
use uuid::Uuid;

pub(super) struct Coordinate {
    owner: [u8; 32],
    id: Uuid,
}

fn rejected(message: &str) -> IngestError {
    IngestError::Rejected(message.into())
}
fn db_error(error: DbError) -> IngestError {
    IngestError::Internal(format!("error: workflow lifecycle: {error}"))
}

/// Route only canonical UUID workflow a-deletes; other kind-5 operations retain their contract.
pub(super) fn deletion_coordinate(event: &Event) -> Result<Option<Coordinate>, IngestError> {
    if u32::from(event.kind.as_u16()) != KIND_DELETION {
        return Ok(None);
    }
    let targets: Vec<_> = event
        .tags
        .iter()
        .filter(|t| matches!(t.kind().to_string().as_str(), "a" | "e"))
        .collect();
    let Some(value) = targets.iter().find_map(|t| {
        (t.kind().to_string() == "a")
            .then(|| t.content())
            .flatten()
            .filter(|v| v.starts_with("30620:"))
    }) else {
        return Ok(None);
    };
    let parts: Vec<_> = value.split(':').collect();
    if parts.len() != 3 {
        return Err(rejected("invalid: malformed workflow deletion coordinate"));
    }
    let Ok(id) = Uuid::parse_str(parts[2]) else {
        return Ok(None);
    }; // legacy name-based path
    if targets.len() != 1 || targets[0].as_slice().len() != 2 || parts[2] != id.to_string() {
        return Err(rejected(
            "invalid: workflow deletion requires exactly one canonical UUID coordinate",
        ));
    }
    let owner = hex::decode(parts[1])
        .ok()
        .and_then(|bytes| <[u8; 32]>::try_from(bytes).ok())
        .ok_or_else(|| rejected("invalid: malformed workflow owner"))?;
    if parts[1] != hex::encode(owner) {
        return Err(rejected("invalid: noncanonical workflow owner"));
    }
    Ok(Some(Coordinate { owner, id }))
}

pub(super) async fn delete(
    tenant: &TenantContext,
    state: &Arc<AppState>,
    tracer: &Arc<dyn buzz_conformance::Tracer>,
    event: &Event,
    auth: &IngestAuth,
    coordinate: Coordinate,
) -> Result<IngestResult, IngestError> {
    let Coordinate { owner, id } = coordinate;
    if owner != auth.pubkey().to_bytes() || owner != event.pubkey.to_bytes() {
        return Err(rejected(
            "forbidden: only the workflow author can delete it",
        ));
    }
    let community = tenant.community();
    let mut tx = state
        .db
        .begin_event_write_transaction()
        .await
        .map_err(db_error)?;
    buzz_deletion::store(&state.db)
        .guard_transaction(&mut tx, community)
        .await
        .map_err(|_| rejected("restricted: community writes are fenced"))?;
    lifecycle::lock_coordinate(&mut tx, community, &owner, id)
        .await
        .map_err(db_error)?;
    let head = lifecycle::head(&mut tx, community, &owner, id)
        .await
        .map_err(db_error)?;
    let cutoff = lifecycle::deletion(&mut tx, community, &owner, id)
        .await
        .map_err(db_error)?;
    let runtime = match workflow::get_workflow_in_transaction(&mut tx, community, id).await {
        Ok(row) => Some(row),
        Err(DbError::NotFound(_)) => None,
        Err(error) => return Err(db_error(error)),
    };
    if runtime
        .as_ref()
        .is_some_and(|row| row.owner_pubkey != owner)
    {
        return Err(rejected("forbidden: workflow belongs to a different owner"));
    }
    let channel = head
        .as_ref()
        .and_then(|h| h.channel_id)
        .or_else(|| runtime.as_ref().and_then(|r| r.channel_id))
        .or_else(|| cutoff.as_ref().map(|d| d.channel_id))
        .ok_or_else(|| rejected("invalid: workflow not found"))?;
    if head.as_ref().is_some_and(|h| h.channel_id != Some(channel))
        || runtime
            .as_ref()
            .is_some_and(|r| r.channel_id != Some(channel))
        || cutoff.as_ref().is_some_and(|d| d.channel_id != channel)
    {
        return Err(rejected("conflict: workflow lifecycle is unverified"));
    }
    let h_tags: Vec<_> = event
        .tags
        .iter()
        .filter(|tag| tag.kind().to_string() == "h")
        .collect();
    if h_tags.len() > 1
        || h_tags.first().is_some_and(|tag| {
            tag.as_slice().len() != 2 || tag.content() != Some(channel.to_string().as_str())
        })
    {
        return Err(rejected(
            "forbidden: workflow deletion channel does not match",
        ));
    }
    super::ingest::check_token_channel_access(auth, channel).map_err(IngestError::AuthFailed)?;
    if lifecycle::channel_role(&mut tx, community, channel, &owner)
        .await
        .map_err(db_error)?
        .is_none()
    {
        return Err(rejected(
            "forbidden: workflow requires active channel membership",
        ));
    }
    // Proof is forward-only; an old accepted event is not evidence that its side effects completed.
    if lifecycle::event_seen(&mut tx, community, event)
        .await
        .map_err(db_error)?
    {
        if cutoff
            .as_ref()
            .is_some_and(|d| d.event_id == event.id.as_bytes().as_slice())
        {
            emit_success(tracer, tenant, event, auth, channel, false);
            return Ok(IngestResult {
                event_id: event.id.to_hex(),
                accepted: true,
                message: "duplicate: workflow deletion previously committed".into(),
            });
        }
        return Err(rejected(
            "conflict: previous workflow deletion is unverified; refresh required",
        ));
    }
    if head.is_some() != runtime.is_some() {
        return Err(rejected("conflict: workflow lifecycle is unverified"));
    }
    let timestamp = event.created_at.as_secs() as i64;
    if head
        .as_ref()
        .is_some_and(|h| h.created_at.timestamp() > timestamp)
        || cutoff
            .as_ref()
            .is_some_and(|d| d.deleted_through.timestamp() >= timestamp)
    {
        return Err(rejected(
            "conflict: workflow deletion is stale; refresh required",
        ));
    }
    let (stored, inserted) =
        buzz_db::event::insert_event_in_transaction(&mut tx, community, event, Some(channel))
            .await
            .map_err(db_error)?;
    if !inserted {
        return Err(rejected(
            "conflict: previous workflow deletion is unverified; refresh required",
        ));
    }
    lifecycle::delete_in_transaction(&mut tx, community, &owner, id, channel, event)
        .await
        .map_err(db_error)?;
    tx.commit().await.map_err(|e| db_error(e.into()))?;
    state
        .workflow_engine
        .invalidate_channel_workflows(community, channel);
    super::event::dispatch_persistent_event(
        tenant,
        state,
        &stored,
        KIND_DELETION,
        &event.pubkey.to_hex(),
        None,
    )
    .await;
    emit_success(tracer, tenant, event, auth, channel, true);
    Ok(IngestResult {
        event_id: event.id.to_hex(),
        accepted: true,
        message: format!(
            "response:{}",
            serde_json::json!({"workflow_id":id,"deleted":true,"lifecycle_version":1})
        ),
    })
}

fn emit_success(
    tracer: &Arc<dyn buzz_conformance::Tracer>,
    tenant: &TenantContext,
    event: &Event,
    auth: &IngestAuth,
    channel: Uuid,
    inserted: bool,
) {
    use crate::conformance::{
        channel_label, claimed_community_from_event, emit, msg_id_label, state_for_request,
        TraceAction,
    };
    let msg_id = msg_id_label(event.id.as_bytes());
    let channel = channel_label(channel);
    let claimed_community = claimed_community_from_event(event);
    let action = if inserted {
        TraceAction::WriteInsert {
            msg_id,
            channel,
            claimed_community,
        }
    } else {
        TraceAction::WriteDuplicate {
            msg_id,
            channel,
            claimed_community,
        }
    };
    emit(tracer, action, state_for_request(tenant, auth.pubkey()));
}

#[cfg(test)]
mod postgres_tests;

#[cfg(test)]
mod tests {
    use super::*;
    use buzz_core::kind::KIND_WORKFLOW_DEF;
    use nostr::{EventBuilder, Keys, Kind, Tag};
    #[test]
    fn routes_only_one_canonical_workflow_coordinate() {
        let keys = Keys::generate();
        let id = Uuid::new_v4();
        let address = format!("{KIND_WORKFLOW_DEF}:{}:{id}", keys.public_key());
        let event = |tags| {
            EventBuilder::new(Kind::EventDeletion, "")
                .tags(tags)
                .sign_with_keys(&keys)
                .expect("fixture event")
        };
        let a = Tag::parse(["a", &address]).expect("a tag");
        assert!(deletion_coordinate(&event(vec![a.clone()]))
            .expect("valid")
            .is_some());
        assert!(deletion_coordinate(&event(vec![a.clone(), a])).is_err());
        let alias = format!("{KIND_WORKFLOW_DEF}:{}:{}", keys.public_key(), id.simple());
        assert!(
            deletion_coordinate(&event(vec![Tag::parse(["a", &alias]).expect("alias")])).is_err()
        );
        assert!(
            deletion_coordinate(&event(vec![Tag::parse(["e", &"a".repeat(64)]).expect("e")]))
                .expect("generic")
                .is_none()
        );
    }
}
