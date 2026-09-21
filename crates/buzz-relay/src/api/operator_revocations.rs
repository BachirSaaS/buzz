//! Deployment-operator revocation notification ingress.
//!
//! This surface validates and logs a normalized notification. It deliberately
//! does not revoke identities, disconnect sessions, persist state, publish to
//! Redis, or claim that enforcement occurred.

use std::sync::Arc;

use axum::{
    body::Bytes,
    extract::State,
    http::{header, HeaderMap, StatusCode},
    response::Json,
};
use chrono::{DateTime, SecondsFormat, Utc};
use nostr::PublicKey;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use uuid::Uuid;

use crate::state::AppState;

use super::{api_error, operator::authorize_operator_request};

const PATH: &str = "/operator/revocation-notifications";
const NOTIFICATION_VERSION: u32 = 1;
const NOTIFICATION_TYPE: &str = "identity.revoked";
const MAX_OCCURRED_AT_BYTES: usize = 64;

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct RevocationNotificationRequest {
    version: u32,
    id: String,
    #[serde(rename = "type")]
    notification_type: String,
    target_pubkey: String,
    occurred_at: String,
}

#[derive(Debug)]
struct ValidatedRevocationNotification {
    id: String,
    target_pubkey: PublicKey,
    occurred_at: DateTime<Utc>,
}

#[derive(Debug, Serialize)]
pub(crate) struct RevocationNotificationResponse {
    accepted: bool,
    status: &'static str,
    revocation_applied: bool,
    id: String,
}

fn validate_notification(
    request: RevocationNotificationRequest,
) -> Result<ValidatedRevocationNotification, &'static str> {
    if request.version != NOTIFICATION_VERSION {
        return Err("version must be 1");
    }
    if request.notification_type != NOTIFICATION_TYPE {
        return Err("type must be identity.revoked");
    }

    let id = Uuid::parse_str(&request.id).map_err(|_| "id must be a canonical UUID")?;
    if id.hyphenated().to_string() != request.id {
        return Err("id must be a canonical UUID");
    }

    let target_pubkey = parse_target_pubkey(&request.target_pubkey)?;
    let occurred_at = validate_occurred_at(&request.occurred_at)?;

    Ok(ValidatedRevocationNotification {
        id: request.id,
        target_pubkey,
        occurred_at,
    })
}

fn parse_target_pubkey(value: &str) -> Result<PublicKey, &'static str> {
    let pubkey = PublicKey::from_hex(value)
        .map_err(|_| "target_pubkey must be 64 lowercase hex characters")?;
    if pubkey.to_hex() != value {
        return Err("target_pubkey must be 64 lowercase hex characters");
    }
    pubkey
        .xonly()
        .map_err(|_| "target_pubkey is not a valid x-only secp256k1 public key")?;
    Ok(pubkey)
}

fn validate_occurred_at(value: &str) -> Result<DateTime<Utc>, &'static str> {
    if value.len() > MAX_OCCURRED_AT_BYTES || !value.ends_with('Z') {
        return Err("occurred_at must be an RFC3339 UTC timestamp ending in Z");
    }
    DateTime::parse_from_rfc3339(value)
        .map(|timestamp| timestamp.with_timezone(&Utc))
        .map_err(|_| "occurred_at must be an RFC3339 UTC timestamp ending in Z")
}

/// Validate and log an operator-authenticated revocation notification.
///
/// A successful response acknowledges only that the bounded notification was
/// authenticated, validated, and emitted to structured logs. It performs no
/// durable write, deduplication, retry scheduling, session closure, or access
/// revocation.
pub(crate) async fn receive_revocation_notification(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<Json<RevocationNotificationResponse>, (StatusCode, Json<Value>)> {
    let signer =
        authorize_operator_request(&state, &headers, "POST", PATH, None, Some(&body)).await?;

    if headers
        .get(header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        != Some("application/json")
    {
        return Err(api_error(
            StatusCode::UNSUPPORTED_MEDIA_TYPE,
            "content-type must be application/json",
        ));
    }

    let request: RevocationNotificationRequest = serde_json::from_slice(&body).map_err(|_| {
        api_error(
            StatusCode::BAD_REQUEST,
            "invalid revocation notification JSON",
        )
    })?;
    let notification = validate_notification(request)
        .map_err(|message| api_error(StatusCode::BAD_REQUEST, message))?;
    let occurred_at = notification
        .occurred_at
        .to_rfc3339_opts(SecondsFormat::AutoSi, true);

    tracing::info!(
        notification_id = %notification.id,
        signer = %signer.to_hex(),
        target_pubkey = %notification.target_pubkey.to_hex(),
        occurred_at = %occurred_at,
        status = "logged_stub",
        revocation_applied = false,
        "operator revocation notification logged; no revocation action applied"
    );

    Ok(Json(RevocationNotificationResponse {
        accepted: true,
        status: "logged_stub",
        revocation_applied: false,
        id: notification.id,
    }))
}

#[cfg(test)]
mod tests {
    use super::{validate_notification, RevocationNotificationRequest};

    const VALID_PUBKEY: &str = "79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798";

    fn valid_request() -> RevocationNotificationRequest {
        RevocationNotificationRequest {
            version: 1,
            id: "550e8400-e29b-41d4-a716-446655440000".to_string(),
            notification_type: "identity.revoked".to_string(),
            target_pubkey: VALID_PUBKEY.to_string(),
            occurred_at: "2026-09-21T12:34:56Z".to_string(),
        }
    }

    #[test]
    fn exact_contract_is_valid() {
        let notification = validate_notification(valid_request()).expect("valid notification");
        assert_eq!(notification.id, "550e8400-e29b-41d4-a716-446655440000");
        assert_eq!(notification.target_pubkey.to_hex(), VALID_PUBKEY);
    }

    #[test]
    fn timestamp_allows_fractional_seconds_but_requires_z() {
        let mut fractional = valid_request();
        fractional.occurred_at = "2026-09-21T12:34:56.123Z".to_string();
        assert!(validate_notification(fractional).is_ok());

        let mut offset = valid_request();
        offset.occurred_at = "2026-09-21T12:34:56+00:00".to_string();
        assert_eq!(
            validate_notification(offset).expect_err("offset form must fail"),
            "occurred_at must be an RFC3339 UTC timestamp ending in Z"
        );
    }

    #[test]
    fn semantic_contract_fields_are_strict() {
        let mut wrong_version = valid_request();
        wrong_version.version = 2;
        assert!(validate_notification(wrong_version).is_err());

        let mut wrong_type = valid_request();
        wrong_type.notification_type = "identity.disabled".to_string();
        assert!(validate_notification(wrong_type).is_err());

        let mut noncanonical_id = valid_request();
        noncanonical_id.id = "550E8400-E29B-41D4-A716-446655440000".to_string();
        assert!(validate_notification(noncanonical_id).is_err());

        let mut uppercase_key = valid_request();
        uppercase_key.target_pubkey = VALID_PUBKEY.to_uppercase();
        assert!(validate_notification(uppercase_key).is_err());

        let mut invalid_point = valid_request();
        invalid_point.target_pubkey = "0".repeat(64);
        assert!(validate_notification(invalid_point).is_err());
    }

    #[test]
    fn unknown_json_fields_are_rejected() {
        let body = format!(
            r#"{{"version":1,"id":"550e8400-e29b-41d4-a716-446655440000","type":"identity.revoked","target_pubkey":"{VALID_PUBKEY}","occurred_at":"2026-09-21T12:34:56Z","command":"disconnect"}}"#
        );
        assert!(serde_json::from_str::<RevocationNotificationRequest>(&body).is_err());
    }
}
