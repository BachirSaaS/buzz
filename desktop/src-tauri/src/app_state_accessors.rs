//! Convenience accessors over [`AppState`]'s lock-guarded fields.
//!
//! Kept apart from `app_state.rs`, which owns the struct, its builder, and the
//! identity-key resolution that populates it.

use nostr::Keys;

use crate::app_state::AppState;
use crate::managed_agents::config_bridge::SessionConfigCache;
use crate::managed_agents::ManagedAgentRuntimeKey;

impl AppState {
    /// Capture the authority supplied by this renderer realm. Local builds have no realm token.
    pub(crate) fn renderer_signer(
        &self,
        _generation: Option<u64>,
    ) -> Result<crate::active_user_signer::ActiveUserSigner, String> {
        self.active_signer()
    }

    /// Capture the signer for an explicit destination before any asynchronous work.
    pub(crate) fn renderer_signer_at(
        &self,
        generation: Option<u64>,
        _relay: &str,
    ) -> Result<crate::active_user_signer::ActiveUserSigner, String> {
        self.renderer_signer(generation)
    }

    /// Capture media authority; local recovery may retain unsigned media reads.
    pub(crate) fn media_read_scope(
        &self,
        _generation: Option<u64>,
        _operation_generation: u64,
    ) -> Result<crate::media_read::MediaReadScope, String> {
        Ok(crate::media_read::MediaReadScope::new(
            self.active_signer().ok(),
            crate::relay::relay_api_base_url_with_override(self),
            None,
        ))
    }

    /// Compatibility local-key access, preserving historical recovery exceptions.
    /// New signing paths must use active_signer/signing_keys instead.
    pub(crate) fn local_identity_keys(&self) -> Result<Keys, String> {
        self.keys
            .lock()
            .map(|keys| keys.clone())
            .map_err(|e| e.to_string())
    }

    /// Test-only replacement; production installs identity storage or a workspace.
    #[cfg(test)]
    pub(crate) fn replace_local_identity_keys(&self, keys: Keys) -> Result<(), String> {
        let mut generation = self
            .operation_generation
            .lock()
            .map_err(|e| e.to_string())?;
        *self.keys.lock().map_err(|e| e.to_string())? = keys;
        *generation = generation.wrapping_add(1);
        Ok(())
    }

    /// Atomically replace local keys and their storage metadata after persistence.
    pub(crate) fn install_local_identity(
        &self,
        keys: Keys,
        storage: crate::identity_storage::IdentityStorage,
    ) -> Result<(), String> {
        let mut generation = self
            .operation_generation
            .lock()
            .map_err(|e| e.to_string())?;
        let mut guard = self.keys.lock().map_err(|e| e.to_string())?;
        *guard = keys;
        self.set_identity_storage(storage);
        *generation = generation.wrapping_add(1);
        Ok(())
    }

    /// Replace the workspace identity and relay as one foreground-operation boundary.
    /// Reapplying the same local owner/relay is not a new authentication session.
    /// Retire captures only on a real scope transition (including away and back).
    pub(crate) fn install_local_workspace(
        &self,
        relay_url: String,
        keys: Option<Keys>,
    ) -> Result<(), String> {
        let mut generation = self
            .operation_generation
            .lock()
            .map_err(|e| e.to_string())?;
        let mut relay = self.relay_url_override.lock().map_err(|e| e.to_string())?;
        let mut current_keys = self.keys.lock().map_err(|e| e.to_string())?;
        let current_relay = relay.clone().unwrap_or_else(crate::relay::relay_ws_url);
        let changed = current_relay != relay_url
            || keys
                .as_ref()
                .is_some_and(|keys| keys.public_key() != current_keys.public_key());
        *relay = Some(relay_url);
        if let Some(keys) = keys {
            *current_keys = keys;
        }
        if changed {
            *generation = generation.wrapping_add(1);
        }
        Ok(())
    }

    /// Preserve the local identity IPC's key/metadata snapshot under the key lock.
    pub(crate) fn local_identity_snapshot(
        &self,
    ) -> Result<crate::identity_storage::LocalIdentitySnapshot, String> {
        use std::sync::atomic::Ordering::Acquire;
        let keys = self.keys.lock().map_err(|e| e.to_string())?;
        Ok(crate::identity_storage::LocalIdentitySnapshot {
            pubkey: keys.public_key(),
            storage: self.identity_storage(),
            lost: self.identity_lost.load(Acquire),
            locked: self.keyring_locked.load(Acquire),
            reset_failed: self.reset_failed.load(Acquire),
        })
    }

    /// Public identity for reads that historically allowed local recovery mode.
    pub(crate) fn identity_public_key(&self) -> Result<nostr::PublicKey, String> {
        self.keys
            .lock()
            .map(|keys| keys.public_key())
            .map_err(|e| e.to_string())
    }

    /// Lock the huddle state mutex, converting a poisoned-lock error to a String.
    ///
    /// Convenience wrapper — replaces 15+ instances of
    /// `state.huddle_state.lock().map_err(|e| e.to_string())?` throughout the
    /// huddle module.
    pub fn huddle(&self) -> Result<std::sync::MutexGuard<'_, crate::huddle::HuddleState>, String> {
        self.huddle_state.lock().map_err(|e| e.to_string())
    }

    pub fn get_session_cache(&self, key: &ManagedAgentRuntimeKey) -> Option<SessionConfigCache> {
        self.session_config_cache.lock().ok()?.get(key).cloned()
    }

    pub fn put_session_cache(&self, key: ManagedAgentRuntimeKey, cache: SessionConfigCache) {
        if let Ok(mut map) = self.session_config_cache.lock() {
            map.insert(key, cache);
        }
    }

    pub fn clear_agent_session_cache(&self, key: &ManagedAgentRuntimeKey) {
        if let Ok(mut map) = self.session_config_cache.lock() {
            map.remove(key);
        }
    }

    pub fn clear_agent_session_caches(&self, pubkey: &str) {
        if let Ok(mut map) = self.session_config_cache.lock() {
            map.retain(|key, _| key.pubkey != pubkey);
        }
    }

    /// Capture the active user's signing capability, preserving the recovery guard.
    pub(crate) fn active_signer(
        &self,
    ) -> Result<crate::active_user_signer::ActiveUserSigner, String> {
        #[cfg(test)]
        {
            self.signing_keys()?;
            if let Some(signer) = self.test_signer.lock().map_err(|e| e.to_string())?.clone() {
                return Ok(signer);
            }
        }
        self.signing_keys()
            .map(crate::active_user_signer::ActiveUserSigner::local)
    }

    /// Capture local signing for entrypoints that historically allowed recovery mode.
    ///
    /// Compatibility only: HTTP reads, renderer binding, and human huddle audio/STT
    /// used the raw key lock before signer extraction. Do not use this for new
    /// entrypoints or replace an existing `active_signer` / `signing_keys` guard.
    pub(crate) fn legacy_local_signer(
        &self,
    ) -> Result<crate::active_user_signer::ActiveUserSigner, String> {
        self.keys
            .lock()
            .map_err(|e| e.to_string())
            .map(|keys| crate::active_user_signer::ActiveUserSigner::local(keys.clone()))
    }

    /// Return the active identity keys if they are in a signable state.
    ///
    /// Returns `Err` when the identity is in a lost state (`identity_lost`
    /// — ephemeral key, user must re-import their nsec) or when the keyring
    /// is locked (`keyring_locked` — key is held in a keyring that is
    /// unavailable this boot). All signing and publish commands must call
    /// this instead of locking `state.keys` directly, so that recovery mode
    /// blocks publishing under an invalid or inaccessible identity.
    pub fn signing_keys(&self) -> Result<Keys, String> {
        if self
            .identity_lost
            .load(std::sync::atomic::Ordering::Acquire)
            || self
                .keyring_locked
                .load(std::sync::atomic::Ordering::Acquire)
        {
            return Err("identity is in recovery mode; event signing is disabled \
                 until the identity is restored and Buzz is relaunched"
                .to_string());
        }
        self.keys
            .lock()
            .map_err(|e| e.to_string())
            .map(|k| k.clone())
    }

    /// Emit the current huddle state to the frontend via Tauri event.
    ///
    /// Acquires both locks (app_handle + huddle_state), clones a snapshot,
    /// releases both, then emits. Best-effort — no-op if either lock is
    /// poisoned or the app_handle hasn't been set yet.
    pub fn emit_huddle_state_changed(&self) {
        let app = match self.app_handle.lock() {
            Ok(guard) => guard.clone(),
            Err(_) => return,
        };
        let Some(app) = app else { return };
        let snapshot = match self.huddle_state.lock() {
            Ok(hs) => hs.clone(),
            Err(_) => return,
        };
        crate::huddle::state::emit_huddle_state(&app, &snapshot);
    }
}
