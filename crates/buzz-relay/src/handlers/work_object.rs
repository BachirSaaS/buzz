//! Canonical object ingress checks outside the ordinary message protocol.
use std::sync::Arc;

use buzz_core::kind::{is_work_object, KIND_WORK_BRANCH, KIND_WORK_REPOSITORY};
use nostr::Event;

use super::ingest::{IngestAuth, IngestError};
use crate::state::AppState;
use buzz_auth::Scope;
use buzz_core::tenant::TenantContext;

pub(super) fn validate_capability(event: &Event, auth: &IngestAuth) -> Result<(), IngestError> {
    if !is_work_object(event.kind.as_u16() as u32) {
        return Ok(());
    }
    let revision = buzz_core::work_object::parse(event)
        .map_err(|e| IngestError::Rejected(format!("invalid: {e}")))?;
    // Fail closed until the ingress API can express both channel capabilities.
    if revision.home.repository.is_some() && auth.channel_ids().is_some() {
        return Err(IngestError::AuthFailed(
            "restricted: branch registration requires an unscoped token".into(),
        ));
    }
    if matches!(
        event.kind.as_u16() as u32,
        KIND_WORK_REPOSITORY | KIND_WORK_BRANCH
    ) && !auth.scopes().contains(&Scope::ReposWrite)
    {
        return Err(IngestError::AuthFailed(
            "restricted: repository objects require repos:write".into(),
        ));
    }
    Ok(())
}

pub(super) async fn guard_deletion(
    tenant: &TenantContext,
    event: &Event,
    state: &Arc<AppState>,
) -> Result<(), IngestError> {
    for tag in event.tags.iter() {
        if tag.kind().to_string() == "a"
            && tag
                .content()
                .and_then(|v| v.split(':').next())
                .and_then(|v| v.parse().ok())
                .is_some_and(is_work_object)
        {
            return Err(IngestError::Rejected(
                "invalid: use a canonical tombstone revision".into(),
            ));
        }
        if tag.kind().to_string() != "e" {
            continue;
        }
        let Some(target) = tag.content().and_then(|v| hex::decode(v).ok()) else {
            continue;
        };
        let stored = state
            .db
            .get_event_by_id_including_deleted_for_event_write(tenant.community(), &target)
            .await
            .map_err(|e| IngestError::Internal(format!("error: {e}")))?;
        if stored.is_some_and(|s| is_work_object(s.event.kind.as_u16() as u32)) {
            return Err(IngestError::Rejected(
                "invalid: use a canonical tombstone revision".into(),
            ));
        }
    }
    Ok(())
}
