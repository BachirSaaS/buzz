use std::sync::Arc;

use nostr::{
    signer::SignerBackend, util::BoxedFuture, Event, EventBuilder, JsonUtil, Keys, Kind,
    NostrSigner, PublicKey, SignerError, Tag, UnsignedEvent,
};
use tokio::sync::Notify;

use super::*;
use crate::archive::{pipeline::plan_archive, ArchiveCandidate, MatchedScope, ScopeType};

#[derive(Debug)]
struct PausedDecrypt {
    keys: Keys,
    entered: Notify,
    release: Notify,
}

macro_rules! delegate {
    ($method:ident) => {
        fn $method<'a>(
            &'a self,
            peer: &'a PublicKey,
            content: &'a str,
        ) -> BoxedFuture<'a, Result<String, SignerError>> {
            self.keys.$method(peer, content)
        }
    };
}

impl NostrSigner for PausedDecrypt {
    fn backend(&self) -> SignerBackend<'_> {
        SignerBackend::Custom("paused-decrypt".into())
    }
    fn get_public_key(&self) -> BoxedFuture<'_, Result<PublicKey, SignerError>> {
        Box::pin(async { Ok(self.keys.public_key()) })
    }
    fn sign_event(&self, event: UnsignedEvent) -> BoxedFuture<'_, Result<Event, SignerError>> {
        NostrSigner::sign_event(&self.keys, event)
    }
    delegate!(nip04_encrypt);
    delegate!(nip04_decrypt);
    delegate!(nip44_encrypt);
    fn nip44_decrypt<'a>(
        &'a self,
        peer: &'a PublicKey,
        content: &'a str,
    ) -> BoxedFuture<'a, Result<String, SignerError>> {
        Box::pin(async move {
            self.entered.notify_one();
            self.release.notified().await;
            self.keys.nip44_decrypt(peer, content).await
        })
    }
}

// Exercises the production preparation/commit seam with a genuinely suspended
// NostrSigner: SQLite remains writable during crypto and a removed subscription
// cannot be resurrected by the delayed result.
#[tokio::test]
async fn delayed_decrypt_rechecks_subscription_before_commit() {
    let controlled = Arc::new(PausedDecrypt {
        keys: Keys::generate(),
        entered: Notify::new(),
        release: Notify::new(),
    });
    let signer = ActiveUserSigner::new(controlled.clone()).await.unwrap();
    let owner = signer.public_key().to_hex();
    let agent = Keys::generate();
    let content = buzz_core_pkg::observer::encrypt_observer_payload(
        &agent,
        &signer.public_key(),
        &serde_json::json!({"channelId": "channel-a"}),
    )
    .unwrap();
    let event = EventBuilder::new(Kind::Custom(24200), content)
        .tags([
            Tag::public_key(signer.public_key()),
            Tag::parse(["agent", &agent.public_key().to_hex()]).unwrap(),
            Tag::parse(["frame", "telemetry"]).unwrap(),
        ])
        .sign_with_keys(&agent)
        .unwrap();
    let conn = Connection::open_in_memory().unwrap();
    conn.execute_batch(store::SCHEMA).unwrap();
    let relay = "wss://relay.example";
    store::upsert_save_subscription(&conn, &owner, relay, "owner_p", &owner, "[24200]", 0).unwrap();
    let plan = plan_archive(
        vec![ArchiveCandidate {
            raw_event_json: event.as_json(),
            matched_scope: MatchedScope {
                scope_type: ScopeType::OwnerP,
                scope_value: owner.clone(),
            },
        }],
        &owner,
        relay,
        &conn,
    )
    .unwrap();
    let task = tokio::spawn(async move {
        prepare_archive(Vec::new(), plan.ephemeral, plan.pre_dropped, &signer).await
    });
    tokio::time::timeout(
        std::time::Duration::from_secs(5),
        controlled.entered.notified(),
    )
    .await
    .unwrap();
    assert!(!task.is_finished());
    conn.execute("DELETE FROM save_subscriptions", []).unwrap();
    controlled.release.notify_one();
    let prepared = task.await.unwrap();
    assert_eq!(prepared.ready.len(), 1);
    assert_eq!(
        prepared.ready[0].observer_channel.as_deref(),
        Some("channel-a")
    );
    let result = commit_ready(&prepared, &owner, relay, 0, &conn).unwrap();
    assert_eq!(result.persisted, 0);
    assert_eq!(result.dropped, 1);
    let count: i64 = conn
        .query_row("SELECT count(*) FROM archived_events", [], |row| row.get(0))
        .unwrap();
    assert_eq!(count, 0);
}
