//! An owned signing capability captured before an active-user operation awaits.

use std::sync::Arc;

use nostr::{
    signer::SignerBackend, util::BoxedFuture, Event, EventBuilder, Keys, NostrSigner, PublicKey,
    SignerError, UnsignedEvent,
};

/// Owner operations not covered by rust-nostr's signing/encryption interface.
/// Implementations belong to the captured identity; they must not resolve the
/// current user or fall back to another backend when an operation fails.
pub(crate) trait AgentCapabilities: std::fmt::Debug + Send + Sync {
    fn public_key(&self) -> PublicKey;

    fn authorize_agent<'a>(
        &'a self,
        agent: &'a PublicKey,
        conditions: &'a str,
    ) -> BoxedFuture<'a, Result<String, String>>;

    /// Invalid records yield `Ok(None)`; operational failures yield `Err`.
    /// Validation includes the event signature, envelope, and keyed address.
    fn read_agent_memory<'a>(
        &'a self,
        event: &'a Event,
        agent: &'a PublicKey,
    ) -> BoxedFuture<'a, Result<Option<buzz_core_pkg::engram::Body>, String>>;
}

impl AgentCapabilities for Keys {
    fn public_key(&self) -> PublicKey {
        Keys::public_key(self)
    }

    fn authorize_agent<'a>(
        &'a self,
        agent: &'a PublicKey,
        conditions: &'a str,
    ) -> BoxedFuture<'a, Result<String, String>> {
        Box::pin(async move {
            buzz_sdk_pkg::nip_oa::compute_auth_tag(self, agent, conditions)
                .map_err(|e| format!("failed to compute NIP-OA auth tag: {e}"))
        })
    }

    fn read_agent_memory<'a>(
        &'a self,
        event: &'a Event,
        agent: &'a PublicKey,
    ) -> BoxedFuture<'a, Result<Option<buzz_core_pkg::engram::Body>, String>> {
        Box::pin(async move {
            // The original engram listing verified before validate_and_decrypt,
            // which validates the envelope/keyed address but not the signature.
            if event.verify().is_err() {
                return Ok(None);
            }
            Ok(buzz_core_pkg::engram::validate_and_decrypt(
                event,
                agent,
                &self.public_key(),
                self.secret_key(),
                agent,
            )
            .ok())
        })
    }
}

/// A signer's immutable identity and its asynchronous rust-nostr capability.
/// No secret-key accessor is exposed by this boundary.
#[derive(Clone, Debug)]
pub(crate) struct ActiveUserSigner {
    public_key: PublicKey,
    signer: Arc<dyn NostrSigner>,
    agent_capabilities: Option<Arc<dyn AgentCapabilities>>,
}

impl ActiveUserSigner {
    /// Capture a local identity, deriving the cached public key from those keys.
    pub(crate) fn local(keys: Keys) -> Self {
        let keys = Arc::new(keys);
        Self {
            public_key: AgentCapabilities::public_key(keys.as_ref()),
            signer: keys.clone(),
            agent_capabilities: Some(keys),
        }
    }

    /// Resolve the cached identity from the signer itself, never caller input.
    #[cfg(test)]
    pub(crate) async fn new(signer: Arc<dyn NostrSigner>) -> Result<Self, String> {
        let public_key = signer.get_public_key().await.map_err(|e| e.to_string())?;
        Ok(Self {
            public_key,
            signer,
            agent_capabilities: None,
        })
    }

    /// Attest to an agent using the captured owner, preserving exact conditions.
    pub(crate) async fn authorize_agent(
        &self,
        agent: &PublicKey,
        conditions: &str,
    ) -> Result<String, String> {
        self.agent_capabilities
            .as_ref()
            .ok_or("signer has no owner authorization")?
            .authorize_agent(agent, conditions)
            .await
    }

    /// Validate and decrypt an agent memory with this captured owner. Invalid
    /// records are skippable; an unavailable crypto capability is an operation
    /// failure and must never be presented as an empty memory listing.
    pub(crate) async fn read_agent_memory(
        &self,
        event: &Event,
        agent: &PublicKey,
    ) -> Result<Option<buzz_core_pkg::engram::Body>, String> {
        self.agent_capabilities
            .as_ref()
            .ok_or("signer cannot validate keyed agent memory addresses")?
            .read_agent_memory(event, agent)
            .await
    }

    #[cfg(test)]
    pub(crate) fn with_test_authorization(self, keys: Keys) -> Self {
        self.with_test_agent_capabilities(Arc::new(keys))
    }

    #[cfg(test)]
    fn with_test_agent_capabilities(mut self, capabilities: Arc<dyn AgentCapabilities>) -> Self {
        assert_eq!(self.public_key, capabilities.public_key());
        self.agent_capabilities = Some(capabilities);
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
