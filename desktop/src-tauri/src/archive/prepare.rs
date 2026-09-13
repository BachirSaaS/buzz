//! Prepare archive crypto outside SQLite, then persist accepted records atomically.

use nostr::{signer::SignerBackend, NostrSigner, PublicKey};
use rusqlite::{Connection, Transaction, TransactionBehavior};
use zeroize::Zeroizing;

use super::{
    pipeline::{BucketWithResult, Parsed},
    store, ArchiveBatchResult,
};
use crate::active_user_signer::ActiveUserSigner;

pub(crate) struct PreparedBatch {
    ready: Vec<Ready>,
    dropped: u32,
}

struct Ready {
    source: Parsed,
    // Only metrics persist plaintext. Drop zeroizes the serialized prepared
    // body on rollback, cancellation, stale admission, and successful commit.
    metric_json: Option<Zeroizing<String>>,
    observer_channel: Option<String>,
}

fn select_candidates(
    buckets: Vec<BucketWithResult>,
    ephemeral: Vec<Parsed>,
    pre_dropped: u32,
) -> (PreparedBatch, Vec<Parsed>) {
    let mut batch = PreparedBatch {
        ready: Vec::new(),
        dropped: pre_dropped,
    };
    let mut selected = ephemeral;
    for bucket in buckets {
        for source in bucket.group {
            if bucket.relay_failed
                || source.matched_scope.scope_type.as_str() != bucket.scope_type_str
                || source.matched_scope.scope_value != bucket.scope_value
                || !bucket.returned_ids.contains(&source.event.id.to_hex())
                || !bucket
                    .allowed_kinds
                    .contains(&(source.event.kind.as_u16() as u64))
            {
                batch.dropped += 1;
            } else {
                selected.push(source);
            }
        }
    }
    (batch, selected)
}

fn is_observer(source: &Parsed) -> bool {
    source.event.kind.as_u16() == super::KIND_AGENT_OBSERVER_FRAME
        && source.matched_scope.scope_type == super::ScopeType::OwnerP
}

fn requires_crypto(source: &Parsed) -> bool {
    is_observer(source) || source.event.kind.as_u16() == super::KIND_AGENT_TURN_METRIC
}

/// Consume a body verdict. Observer invalidity keeps baseline raw+NULL;
/// metrics with invalid bodies have no canonical or index row.
fn finish_body(batch: &mut PreparedBatch, source: Parsed, plaintext: Option<&str>) {
    let mut ready = Ready {
        source,
        metric_json: None,
        observer_channel: None,
    };
    let plaintext =
        plaintext.filter(|text| text.len() <= buzz_core_pkg::observer::OBSERVER_MAX_PLAINTEXT_LEN);
    match ready.source.event.kind.as_u16() {
        super::KIND_AGENT_TURN_METRIC => {
            let payload = plaintext
                .and_then(|text| {
                    serde_json::from_str::<
                        buzz_core_pkg::agent_turn_metric::AgentTurnMetricPayload,
                    >(text)
                    .ok()
                })
                .filter(|payload| payload.validate().is_ok());
            let Some(json) = payload.and_then(|payload| serde_json::to_string(&payload).ok())
            else {
                batch.dropped += 1;
                return;
            };
            ready.metric_json = Some(Zeroizing::new(json));
        }
        super::KIND_AGENT_OBSERVER_FRAME if is_observer(&ready.source) => {
            ready.observer_channel = plaintext
                .and_then(|text| serde_json::from_str::<serde_json::Value>(text).ok())
                .and_then(|v| v.get("channelId")?.as_str().map(str::to_owned));
        }
        _ => {}
    }
    batch.ready.push(ready);
}

/// `Ok(None)` means invalid local ciphertext, not an unavailable backend.
/// rust-nostr erases signer error types. Only its Keys backend is known to
/// perform purely local NIP-44 decryption (this crate enables `nip44`); every
/// other backend error must conservatively propagate, without string matching.
/// PR2 can refine remote invalid-data verdicts here when its protocol supports
/// them; crypto callers and the preparation/commit boundary need not change.
async fn decrypt_body(
    signer: &dyn NostrSigner,
    author: &PublicKey,
    content: &str,
) -> Result<Option<Zeroizing<String>>, String> {
    match signer.nip44_decrypt(author, content).await {
        Ok(text) => Ok(Some(Zeroizing::new(text))),
        Err(_) if matches!(signer.backend(), SignerBackend::Keys) => Ok(None),
        // Do not expose backend error strings: they can contain sensitive data.
        Err(_) => Err("archive decryption backend unavailable".to_owned()),
    }
}

/// Decrypt using the captured owner without holding a connection or store lock.
/// Local invalid bodies retain the historical raw+NULL observer index behavior;
/// invalid metrics are dropped rather than stored as ciphertext.
/// Operational errors abort the whole preparation, before any writes. This
/// does not retain candidates for retry: PR2 owns recovery scheduling,
/// including ephemeral frames that cannot be fetched again from the relay.
pub(super) async fn prepare_archive(
    buckets: Vec<BucketWithResult>,
    ephemeral: Vec<Parsed>,
    pre_dropped: u32,
    signer: &ActiveUserSigner,
) -> Result<PreparedBatch, String> {
    let (mut batch, selected) = select_candidates(buckets, ephemeral, pre_dropped);
    for source in selected {
        let text = if requires_crypto(&source)
            && buzz_core_pkg::observer::content_looks_like_nip44(&source.event.content)
        {
            decrypt_body(signer.signer(), &source.event.pubkey, &source.event.content).await?
        } else {
            None
        };
        finish_body(&mut batch, source, text.as_deref().map(String::as_str));
    }
    Ok(batch)
}

/// Recheck subscriptions and atomically persist prepared rows and indexes.
pub(crate) fn commit_ready(
    batch: &PreparedBatch,
    identity_pk: &str,
    relay_url: &str,
    now: i64,
    conn: &Connection,
) -> Result<ArchiveBatchResult, String> {
    let tx = Transaction::new_unchecked(conn, TransactionBehavior::Immediate)
        .map_err(|e| format!("failed to begin archive transaction: {e}"))?;
    let mut result = ArchiveBatchResult {
        persisted: 0,
        persisted_agent_metrics: 0,
        dropped: batch.dropped,
    };
    for ready in &batch.ready {
        let p = &ready.source;
        let kind = p.event.kind.as_u16();
        let scope_type = p.matched_scope.scope_type.as_str();
        let scope_value = &p.matched_scope.scope_value;
        // Authorization may have changed during prepare. Re-read after BEGIN
        // IMMEDIATE, never trust the planning snapshot to authorize a write.
        let allowed =
            store::get_subscription_kinds(&tx, identity_pk, relay_url, scope_type, scope_value)?
                .and_then(|json| serde_json::from_str::<Vec<u64>>(&json).ok())
                .is_some_and(|kinds| kinds.contains(&(kind as u64)));
        if !allowed {
            result.dropped += 1;
            continue;
        }
        if is_observer(p)
            && super::validate_ephemeral_frame(
                &p.event,
                identity_pk,
                scope_value,
                &tx,
                identity_pk,
                relay_url,
            )
            .is_err()
        {
            result.dropped += 1;
            continue;
        }
        let eid = p.event.id.to_hex();
        let pubkey = p.event.pubkey.to_hex();
        let created_at = p.event.created_at.as_secs() as i64;
        let raw_json = ready
            .metric_json
            .as_deref()
            .map(String::as_str)
            .unwrap_or(&p.raw_json);
        store::upsert_archived_event(
            &tx,
            identity_pk,
            relay_url,
            &eid,
            kind as i64,
            &pubkey,
            created_at,
            raw_json,
            now,
        )?;
        store::upsert_event_scope(
            &tx,
            identity_pk,
            relay_url,
            &eid,
            scope_type,
            scope_value,
            now,
        )?;
        if kind == super::KIND_AGENT_TURN_METRIC {
            let row = super::metric_store::AgentMetricIndexRow::from_payload(
                raw_json, &eid, &pubkey, created_at, now,
            );
            if super::metric_store::insert_metric_index_row(&tx, identity_pk, relay_url, &row)? {
                result.persisted_agent_metrics += 1;
            }
        }
        if is_observer(p) {
            store::upsert_observer_channel_index(
                &tx,
                identity_pk,
                relay_url,
                &eid,
                ready.observer_channel.as_deref(),
                created_at,
            )?;
        }
        result.persisted += 1;
    }
    tx.commit()
        .map_err(|e| format!("failed to commit archive transaction: {e}"))?;
    Ok(result)
}

#[cfg(test)]
#[path = "prepare_tests.rs"]
mod tests;
