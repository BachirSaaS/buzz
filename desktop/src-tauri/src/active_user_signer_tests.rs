use std::sync::{
    atomic::{AtomicUsize, Ordering},
    Arc,
};

use nostr::signer::SignerBackend;
use nostr::{
    util::BoxedFuture, Event, EventBuilder, Keys, Kind, NostrSigner, PublicKey, SignerError,
    Timestamp, UnsignedEvent,
};
use tokio::sync::Notify;

use super::ActiveUserSigner;

#[derive(Debug)]
pub(crate) struct ControlledSigner {
    pub(crate) keys: Keys,
    pub(crate) entered: Notify,
    pub(crate) release: Notify,
    pub(crate) fail: bool,
    pub(crate) fail_kind: AtomicUsize,
    pub(crate) public_key_reads: AtomicUsize,
}

impl ControlledSigner {
    pub(crate) async fn wait_entered(&self) {
        tokio::time::timeout(std::time::Duration::from_secs(5), self.entered.notified())
            .await
            .unwrap();
    }

    pub(crate) fn new(fail: bool) -> Arc<Self> {
        Arc::new(Self {
            keys: Keys::generate(),
            entered: Notify::new(),
            release: Notify::new(),
            fail,
            // No Nostr kind can equal this sentinel (kind:0 is a real profile).
            fail_kind: AtomicUsize::new(usize::MAX),
            public_key_reads: AtomicUsize::new(0),
        })
    }
}

macro_rules! delegate_crypto {
    ($method:ident) => {
        fn $method<'a>(
            &'a self,
            public_key: &'a PublicKey,
            content: &'a str,
        ) -> BoxedFuture<'a, Result<String, SignerError>> {
            self.keys.$method(public_key, content)
        }
    };
}

impl NostrSigner for ControlledSigner {
    fn backend(&self) -> SignerBackend<'_> {
        SignerBackend::Custom("controlled".into())
    }
    fn get_public_key(&self) -> BoxedFuture<'_, Result<PublicKey, SignerError>> {
        self.public_key_reads.fetch_add(1, Ordering::SeqCst);
        Box::pin(async { Ok(self.keys.public_key()) })
    }
    fn sign_event(&self, unsigned: UnsignedEvent) -> BoxedFuture<'_, Result<Event, SignerError>> {
        Box::pin(async move {
            self.entered.notify_one();
            self.release.notified().await;
            if self.fail || self.fail_kind.load(Ordering::SeqCst) == unsigned.kind.as_u16() as usize
            {
                return Err(SignerError::from("deliberate signer failure"));
            }
            NostrSigner::sign_event(&self.keys, unsigned).await
        })
    }
    delegate_crypto!(nip04_encrypt);
    delegate_crypto!(nip04_decrypt);
    delegate_crypto!(nip44_encrypt);
    delegate_crypto!(nip44_decrypt);
}

#[tokio::test]
async fn local_signatures_match_fields_and_identity() {
    let keys = Keys::generate();
    let signer = ActiveUserSigner::local(keys.clone());
    let builder = EventBuilder::new(Kind::TextNote, "fixed template")
        .custom_created_at(Timestamp::from(123456));
    let expected = builder.clone().sign_with_keys(&keys).unwrap();
    let actual = signer.sign_event(builder).await.unwrap();
    assert_eq!(actual.id, expected.id);
    assert_eq!(actual.pubkey, expected.pubkey);
    assert_eq!(actual.created_at, expected.created_at);
    assert_eq!(actual.tags, expected.tags);
    assert_eq!(actual.content, expected.content);
    actual.verify().unwrap();
    let encrypted = signer
        .signer()
        .nip44_encrypt(&signer.public_key(), "private")
        .await
        .unwrap();
    assert_eq!(
        signer
            .signer()
            .nip44_decrypt(&signer.public_key(), &encrypted)
            .await
            .unwrap(),
        "private"
    );
}

#[tokio::test]
async fn caches_identity_and_waits_for_async_signer_failure() {
    let controlled = ControlledSigner::new(true);
    let signer = ActiveUserSigner::new(controlled.clone()).await.unwrap();
    assert_eq!(signer.public_key(), controlled.keys.public_key());
    assert_eq!(
        signer.signer().get_public_key().await.unwrap(),
        controlled.keys.public_key()
    );
    let task = tokio::spawn(async move {
        signer
            .sign_event(EventBuilder::new(Kind::TextNote, "test"))
            .await
    });
    controlled.wait_entered().await;
    assert!(!task.is_finished());
    controlled.release.notify_one();
    assert_eq!(
        task.await.unwrap().unwrap_err(),
        "deliberate signer failure"
    );
    assert_eq!(controlled.public_key_reads.load(Ordering::SeqCst), 1);
}
