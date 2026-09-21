# Operator revocation notifications

Buzz exposes a deployment-operator endpoint for integrations that normalize an
upstream offboarding signal to a Nostr public key:

```http
POST /operator/revocation-notifications
Content-Type: application/json
Authorization: Nostr <base64 signed kind-27235 event>
```

```json
{
  "version": 1,
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "type": "identity.revoked",
  "target_pubkey": "<64 hex characters>",
  "occurred_at": "2026-09-21T12:34:56Z"
}
```

The request uses the existing operator service authentication configured by
`RELAY_OPERATOR_API_ORIGIN` and `RELAY_OPERATOR_PUBKEYS`. The kind-27235 NIP-98
event must sign the configured operator origin plus the exact endpoint path,
`POST`, and a `payload` tag containing the SHA-256 digest of the exact request
bytes. Existing freshness, replay, and operator-signer checks apply. The route
accepts at most 4 KiB.

The JSON contract is strict: unknown fields are rejected; `version` and `type`
have the fixed values above; `id` is a canonical hyphenated UUID;
`target_pubkey` is a valid 64-character hexadecimal x-only secp256k1 public
key; and `occurred_at` is an RFC3339 UTC timestamp ending in `Z`. Public-key
hex is accepted in either letter case and normalized to lowercase in logs.
Fractional seconds are accepted. An equivalent `+00:00` suffix is not accepted
because the wire contract requires `Z`. The occurrence time is informational
and has no recency requirement; NIP-98 independently supplies authentication
freshness.

Success returns:

```json
{
  "accepted": true,
  "status": "logged_stub",
  "revocation_applied": false,
  "id": "550e8400-e29b-41d4-a716-446655440000"
}
```

This acknowledgement means only that Buzz authenticated and validated the
notification and emitted a bounded structured log. It is not a durable audit
receipt and does not deduplicate deliveries, retry work, disconnect sessions,
change identity or database state, maintain a denylist, or enforce revocation.
Callers retrying a delivery must preserve the notification `id` and sign each
attempt with a fresh NIP-98 event.

Future SCIM, identity-provider, or generic webhook adapters can produce this
normalized request once they have independently resolved a target public key.
This endpoint does not perform corporate-identity-to-key mapping.
