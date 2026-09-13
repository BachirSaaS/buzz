//! Foreground owner-proof preparation, not workspace activation or agent custody.
use crate::{active_user_signer::ActiveUserSigner, app_state::AppState};
use nostr::{Keys, ToBech32};

/// One captured owner capability and relay, retained across all proof awaits.
pub(crate) struct OwnerAuthorizationScope {
    pub(crate) signer: ActiveUserSigner,
    pub(crate) relay_base: String,
    legacy_recovery: bool,
}

impl OwnerAuthorizationScope {
    pub(crate) fn capture(state: &AppState) -> Result<Self, String> {
        Ok(Self {
            legacy_recovery: false,
            signer: state.active_signer()?,
            relay_base: crate::relay::relay_api_base_url_with_override(state),
        })
    }

    /// Preserve the historical missing-tag repair's local recovery exception.
    pub(crate) fn capture_legacy_repair(state: &AppState) -> Result<Self, String> {
        Ok(Self {
            signer: state.legacy_local_signer()?,
            relay_base: crate::relay::relay_api_base_url_with_override(state),
            legacy_recovery: true,
        })
    }

    /// Revalidate owner and relay before a synchronous commit or publication.
    /// Never replace the captured capability with the current one.
    pub(crate) fn check_current(&self, state: &AppState) -> Result<(), String> {
        let current = if self.legacy_recovery {
            state.legacy_local_signer()?
        } else {
            state.active_signer()?
        };
        if current.public_key() != self.signer.public_key()
            || crate::relay::relay_api_base_url_with_override(state) != self.relay_base
        {
            return Err("owner authorization scope changed; retry operation".into());
        }
        Ok(())
    }
}

/// Inert independent-agent material. Nothing is stored or published by minting.
/// Dropping this on any proof failure/cancellation leaves no keyring/record writes.
pub(crate) struct AuthorizedAgent {
    pub(crate) keys: Keys,
    pub(crate) private_key_nsec: String,
    pub(crate) pubkey: String,
    pub(crate) auth_tag: Option<String>,
}

/// Shared production mint boundary for create and both snapshot import callers.
/// Human custody comes only from `owner`; fresh keys belong only to the new agent.
pub(crate) async fn prepare_agent(owner: &ActiveUserSigner) -> Result<AuthorizedAgent, String> {
    let keys = Keys::generate();
    let auth_tag = Some(owner.authorize_agent(&keys.public_key(), "").await?);
    let private_key_nsec = keys.secret_key().to_bech32().map_err(|e| e.to_string())?;
    Ok(AuthorizedAgent {
        pubkey: keys.public_key().to_hex(),
        keys,
        private_key_nsec,
        auth_tag,
    })
}
