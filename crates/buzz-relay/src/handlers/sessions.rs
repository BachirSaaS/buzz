//! Session commands share normal channel message storage and authorization.
use std::sync::Arc;

use buzz_core::kind::{KIND_MEMBER_ADDED_NOTIFICATION, KIND_SESSION_COMMAND};
use buzz_db::sessions::SessionCommand;
use nostr::Event;
use uuid::Uuid;

use super::ingest::{IngestError, IngestResult};
use crate::state::AppState;
use buzz_core::tenant::TenantContext;

/// Validate a bounded command envelope before applying any database writes.
pub fn parse(event: &Event) -> Result<(Uuid, SessionCommand), String> {
    if u32::from(event.kind.as_u16()) != KIND_SESSION_COMMAND || event.content.len() > 2048 {
        return Err("invalid session command".into());
    }
    let mut tags: Vec<_> = event.tags.iter().map(|tag| tag.as_slice()).collect();
    if let Some(client) = tags
        .last()
        .filter(|tag| tag.first().is_some_and(|name| name == "client-id"))
    {
        if client.len() != 2 {
            return Err("invalid session client identifier".into());
        }
        let client_id =
            Uuid::parse_str(&client[1]).map_err(|_| "invalid session client identifier")?;
        if client_id.to_string() != client[1] {
            return Err("invalid session client identifier".into());
        }
        tags.pop();
    }
    if tags.len() != 1 || tags[0].len() != 2 || tags[0][0] != "h" {
        return Err("session commands require exactly one h tag".into());
    }
    let id = Uuid::parse_str(&tags[0][1]).map_err(|_| "invalid session identifier")?;
    let command =
        serde_json::from_str(&event.content).map_err(|_| "invalid session command content")?;
    Ok((id, command))
}

/// Apply a command transactionally, then refresh discovery for humans and agents.
pub async fn accept(
    tenant: &TenantContext,
    state: &Arc<AppState>,
    event: &Event,
) -> Result<IngestResult, IngestError> {
    if !state.config.sessions_enabled {
        return Err(IngestError::Rejected(
            "restricted: sessions are not enabled on this relay".into(),
        ));
    }
    let (id, command) = parse(event).map_err(IngestError::Rejected)?;
    let (_, inserted) = state
        .db
        .apply_session_command(tenant.community(), id, event, &command)
        .await
        .map_err(|error| match error {
            buzz_db::DbError::AccessDenied(message) | buzz_db::DbError::InvalidData(message) => {
                IngestError::Rejected(message)
            }
            _ => IngestError::Internal("session could not be saved".into()),
        })?;
    // Re-run discovery on exact retries as repair after a lost publication.
    state.invalidate_channel_deleted(tenant);
    super::side_effects::emit_group_discovery_events(tenant, state, id)
        .await
        .map_err(|_| IngestError::Internal("session saved; retry to finish discovery".into()))?;
    let members = state
        .db
        .get_members(tenant.community(), id)
        .await
        .map_err(|_| {
            IngestError::Internal("session saved; retry to finish member discovery".into())
        })?;
    for member in members {
        super::side_effects::emit_membership_notification(
            tenant,
            state,
            id,
            &member.pubkey,
            &event.pubkey.to_bytes(),
            KIND_MEMBER_ADDED_NOTIFICATION,
        )
        .await
        .map_err(|_| IngestError::Internal("session saved; retry to notify participants".into()))?;
    }
    Ok(IngestResult {
        event_id: event.id.to_hex(),
        accepted: true,
        message: if inserted {
            String::new()
        } else {
            "duplicate:".into()
        },
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use nostr::{EventBuilder, Keys, Kind, Tag};

    fn event(body: serde_json::Value, tags: Vec<Tag>) -> Event {
        EventBuilder::new(Kind::Custom(9050), body.to_string())
            .tags(tags)
            .sign_with_keys(&Keys::generate())
            .unwrap()
    }

    #[test]
    fn session_command_accepts_one_trailing_outbox_identifier() {
        let id = Uuid::new_v4().to_string();
        let h = Tag::parse(["h", &id]).unwrap();
        let client = Tag::parse(["client-id", &id]).unwrap();
        let body = serde_json::json!({"action":"create","title":"Work","parent_id":id});
        assert!(parse(&event(body.clone(), vec![h.clone(), client.clone()])).is_ok());
        for tags in [
            vec![h.clone(), client.clone(), client.clone()],
            vec![client, h.clone()],
            vec![h.clone(), Tag::parse(["client-id", "invalid"]).unwrap()],
            vec![h, Tag::parse(["client-id", &id, "extra"]).unwrap()],
        ] {
            assert!(parse(&event(body.clone(), tags)).is_err());
        }
    }

    #[test]
    fn session_command_envelope_rejects_ambiguous_authority() {
        let id = Uuid::new_v4().to_string();
        let h = Tag::parse(["h", &id]).unwrap();
        assert!(parse(&event(
            serde_json::json!({"action":"create","title":"Work"}),
            vec![h.clone()]
        ))
        .is_ok());
        for body in [
            serde_json::json!(null),
            serde_json::json!([]),
            serde_json::json!({"action":"create","title":"Work","role":"owner"}),
            serde_json::json!({"action":"move","parent_id":id}),
            serde_json::json!({"action":"create","title":"Work","parent_id":"invalid"}),
        ] {
            assert!(parse(&event(body, vec![h.clone()])).is_err());
        }
        assert!(parse(&event(
            serde_json::json!({"action":"create","title":"Work"}),
            vec![h.clone(), h]
        ))
        .is_err());
    }
}

#[cfg(test)]
#[path = "sessions_postgres_tests.rs"]
mod postgres_tests;
