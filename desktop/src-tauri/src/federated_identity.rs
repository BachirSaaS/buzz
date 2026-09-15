//! NIP-FI client integration sketch: enterprise admission, still local signing.
//!
//! Build configuration is deliberately explicit and disabled by default. The
//! adapter exchange is an assumed API, not a claim that kgoose implements it.
use std::{
    sync::Arc,
    time::{SystemTime, UNIX_EPOCH},
};

use base64::{engine::general_purpose::STANDARD, Engine};
use buzz_ws_client_pkg::federated_identity::{Assertion, IdentitySession, IDENTITY_HEADER};
use nostr::PublicKey;
use serde::Deserialize;
use tauri::State;

use crate::app_state::AppState;

pub(crate) fn now() -> Result<u64, String> {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_secs())
        .map_err(|_| "system clock unavailable".into())
}

/// Invalid corporate build config is retained as an error, never an OSS fallback.
pub(crate) fn configured_session() -> Result<Arc<IdentitySession>, String> {
    let origins = option_env!("BUZZ_BUILD_NIP_FI_ORIGINS").unwrap_or("");
    let origins: Vec<&str> = origins
        .split(',')
        .filter(|value| !value.is_empty())
        .collect();
    IdentitySession::new(&origins)
        .map(Arc::new)
        .map_err(|error| error.to_string())
}

pub(crate) fn session(state: &AppState) -> Result<&Arc<IdentitySession>, String> {
    state.federated_identity.as_ref().map_err(Clone::clone)
}

/// Pair with the actual HTTP/Blossom proof, including explicit agent-key paths.
/// Do not silently substitute the currently selected human's key.
pub(crate) fn proof_key(auth: &str) -> Result<PublicKey, String> {
    let encoded = auth
        .strip_prefix("Nostr ")
        .ok_or("invalid local possession proof")?;
    let bytes = STANDARD
        .decode(encoded)
        .or_else(|_| base64::engine::general_purpose::URL_SAFE_NO_PAD.decode(encoded))
        .map_err(|_| "invalid local possession proof")?;
    let event: nostr::Event =
        serde_json::from_slice(&bytes).map_err(|_| "invalid local possession proof")?;
    Ok(event.pubkey)
}

pub(crate) fn http_header(
    state: &AppState,
    url: &str,
    auth: &str,
) -> Result<Option<reqwest::header::HeaderValue>, String> {
    session(state)?
        .header(url, proof_key(auth)?, now()?)
        .map_err(|error| error.to_string())
}

/// Call only on a no-redirect client. Never add this to shared default headers.
pub(crate) fn authorize(
    state: &AppState,
    request: reqwest::RequestBuilder,
    url: &str,
    auth: &str,
) -> Result<reqwest::RequestBuilder, String> {
    Ok(match http_header(state, url, auth)? {
        Some(header) => request.header(IDENTITY_HEADER, header),
        None => request,
    })
}

#[derive(Deserialize)]
struct AdapterAssertion {
    assertion: String,
    nostr_pubkey: String,
    /// Assumed API: effective JWT expiry (including issuer max-age policy).
    expires_at: u64,
}

/// Sketch adapter seam: call after browser login; renew through this same API.
///
/// Assumed request/response only. The backend must authorize binding and key
/// possession before issuing; this does not implement kind-27236 enrollment.
/// JWTs stay native. No renderer injection, key migration, or remote signing.
#[tauri::command]
pub(crate) async fn acquire_federated_assertion(
    state: State<'_, AppState>,
    login: State<'_, crate::builderlab::BuilderlabSession>,
) -> Result<(), String> {
    let endpoint = option_env!("BUZZ_BUILD_NIP_FI_ASSERTION_URL")
        .ok_or("enterprise adapter API is not configured")?;
    let endpoint = url::Url::parse(endpoint).map_err(|_| "invalid enterprise adapter URL")?;
    if endpoint.scheme() != "https"
        || !endpoint.username().is_empty()
        || endpoint.password().is_some()
        || endpoint.query().is_some()
        || endpoint.fragment().is_some()
    {
        return Err("invalid enterprise adapter URL".into());
    }
    let identity = session(&state)?;
    let generation = identity.generation().map_err(|e| e.to_string())?;
    let keys = state.signing_keys()?;
    let relay_url = crate::relay::relay_ws_url_with_override(&state);
    let credential = login.credential_for_federated_identity()?;
    let mut credential = reqwest::header::HeaderValue::from_str(&credential)
        .map_err(|_| "invalid login credential")?;
    credential.set_sensitive(true);
    let mut response = state
        .media_fetch_client
        .post(endpoint)
        .header("X-BB-Session-Credential", credential)
        .json(&serde_json::json!({"nostr_pubkey":keys.public_key().to_hex(),"relay_url":relay_url}))
        .timeout(std::time::Duration::from_secs(30))
        .send()
        .await
        .map_err(|_| "enterprise assertion service unavailable")?;
    if !response.status().is_success() {
        return Err("enterprise assertion request rejected".into());
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| "enterprise assertion response unavailable")?
    {
        if bytes.len().saturating_add(chunk.len()) > 24 * 1024 {
            return Err("enterprise assertion response too large".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    let result: AdapterAssertion =
        serde_json::from_slice(&bytes).map_err(|_| "invalid enterprise assertion response")?;
    if result.nostr_pubkey != keys.public_key().to_hex() {
        return Err("enterprise assertion key mismatch".into());
    }
    // Existing scope checks plus login-generation fencing prevent late install.
    if state.signing_keys()?.public_key() != keys.public_key()
        || crate::relay::relay_ws_url_with_override(&state) != relay_url
    {
        return Err("enterprise login scope changed".into());
    }
    let assertion = Assertion::new(
        &result.assertion,
        keys.public_key(),
        result.expires_at,
        now()?,
    )
    .map_err(|e| e.to_string())?;
    identity
        .install(generation, assertion)
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn query_sink_sends_assertion_and_matching_local_proof() {
        use axum::{http::HeaderMap, routing::post, Router};
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        let keys = nostr::Keys::generate();
        let expected_key = keys.public_key();
        let app = Router::new().route(
            "/query",
            post(move |headers: HeaderMap, body: String| async move {
                assert_eq!(headers[IDENTITY_HEADER], "Bearer aaa.bbb.ccc");
                let auth = headers["authorization"].to_str().unwrap();
                assert_eq!(proof_key(auth).unwrap(), expected_key);
                assert_eq!(body, "[]");
                "[]"
            }),
        );
        let server = tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });
        let mut state = crate::app_state::build_app_state();
        state.federated_identity = Ok(Arc::new(IdentitySession::new(&[&base]).unwrap()));
        let identity = session(&state).unwrap();
        identity
            .install(
                0,
                Assertion::new(
                    "aaa.bbb.ccc",
                    keys.public_key(),
                    now().unwrap() + 60,
                    now().unwrap(),
                )
                .unwrap(),
            )
            .unwrap();
        let result = crate::relay::query_relay_at_with_keys(&state, &base, &[], &keys, None).await;
        server.abort();
        server.await.ok();
        assert!(result.unwrap().is_empty());
    }

    #[test]
    fn derives_pairing_key_from_actual_local_proof() {
        let keys = nostr::Keys::generate();
        let auth = crate::relay::build_nip98_auth_header_for_keys(
            &keys,
            &reqwest::Method::POST,
            "https://relay.example/query",
            b"[]",
        )
        .unwrap();
        assert_eq!(proof_key(&auth).unwrap(), keys.public_key());
        assert!(proof_key("Bearer never-a-possession-proof").is_err());
    }
}
