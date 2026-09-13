//! An owned signing capability captured before an active-user operation awaits.

use std::sync::Arc;

use nostr::{
    signer::SignerBackend, util::BoxedFuture, Event, EventBuilder, Keys, NostrSigner, PublicKey,
    SignerError, UnsignedEvent,
};

/// A signer's immutable identity and its asynchronous rust-nostr capability.
/// No secret-key accessor is exposed by this boundary.
#[derive(Clone, Debug)]
pub(crate) struct ActiveUserSigner {
    public_key: PublicKey,
    signer: Arc<dyn NostrSigner>,
    authorization: Option<Arc<Keys>>,
}

impl ActiveUserSigner {
    /// Capture a local identity, deriving the cached public key from those keys.
    pub(crate) fn local(keys: Keys) -> Self {
        let keys = Arc::new(keys);
        Self {
            public_key: keys.public_key(),
            signer: keys.clone(),
            authorization: Some(keys),
        }
    }

    /// Resolve the cached identity from the signer itself, never caller input.
    #[cfg(test)]
    pub(crate) async fn new(signer: Arc<dyn NostrSigner>) -> Result<Self, String> {
        let public_key = signer.get_public_key().await.map_err(|e| e.to_string())?;
        Ok(Self {
            public_key,
            signer,
            authorization: None,
        })
    }

    /// Attest to an agent using the captured owner, preserving exact conditions.
    pub(crate) async fn authorize_agent(
        &self,
        agent: &PublicKey,
        conditions: &str,
    ) -> Result<String, String> {
        let keys = self
            .authorization
            .as_ref()
            .ok_or("signer has no owner authorization")?;
        buzz_sdk_pkg::nip_oa::compute_auth_tag(keys, agent, conditions)
            .map_err(|e| format!("failed to compute NIP-OA auth tag: {e}"))
    }

    #[cfg(test)]
    pub(crate) fn with_test_authorization(mut self, keys: Keys) -> Self {
        assert_eq!(self.public_key, keys.public_key());
        self.authorization = Some(Arc::new(keys));
        self
    }

    /// The identity captured with this signing capability.
    pub(crate) fn public_key(&self) -> PublicKey {
        self.public_key
    }

    /// Borrow the existing library capability, including NIP-04 and NIP-44.
    pub(crate) fn signer(&self) -> &dyn NostrSigner {
        self
    }

    /// Build with the captured identity and asynchronously sign without re-fetching it.
    pub(crate) async fn sign_event(&self, builder: EventBuilder) -> Result<Event, String> {
        self.signer
            .sign_event(builder.build(self.public_key))
            .await
            .map_err(|e| e.to_string())
    }
}

impl NostrSigner for ActiveUserSigner {
    fn backend(&self) -> SignerBackend<'_> {
        self.signer.backend()
    }

    fn get_public_key(&self) -> BoxedFuture<'_, Result<PublicKey, SignerError>> {
        Box::pin(async { Ok(self.public_key) })
    }

    fn sign_event(&self, unsigned: UnsignedEvent) -> BoxedFuture<'_, Result<Event, SignerError>> {
        self.signer.sign_event(unsigned)
    }

    fn nip04_encrypt<'a>(
        &'a self,
        public_key: &'a PublicKey,
        content: &'a str,
    ) -> BoxedFuture<'a, Result<String, SignerError>> {
        self.signer.nip04_encrypt(public_key, content)
    }

    fn nip04_decrypt<'a>(
        &'a self,
        public_key: &'a PublicKey,
        content: &'a str,
    ) -> BoxedFuture<'a, Result<String, SignerError>> {
        self.signer.nip04_decrypt(public_key, content)
    }

    fn nip44_encrypt<'a>(
        &'a self,
        public_key: &'a PublicKey,
        content: &'a str,
    ) -> BoxedFuture<'a, Result<String, SignerError>> {
        self.signer.nip44_encrypt(public_key, content)
    }

    fn nip44_decrypt<'a>(
        &'a self,
        public_key: &'a PublicKey,
        content: &'a str,
    ) -> BoxedFuture<'a, Result<String, SignerError>> {
        self.signer.nip44_decrypt(public_key, content)
    }
}

#[cfg(test)]
#[path = "active_user_signer_tests.rs"]
pub(crate) mod tests;
