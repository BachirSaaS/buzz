# HPKE nsec backup envelope v1

Buzz Desktop exposes a native Rust encryption component for a future corporate
recovery service. It encrypts a native Nostr secret locally and produces an
opaque envelope. It does not provision a recipient, upload an envelope, create
KMS keys, or implement release and recovery.

The API is `hpke_key_backup::seal_nostr_secret`. Its recipient key and enrollment
metadata must come from trusted native configuration or a verified service
registry. It is intentionally not a Tauri command: a renderer, deep link, Nostr
event, or relay input must never choose the recipient key. A future KMS response
will contain SPKI; trusted native registry code must parse it and pass the
65-byte uncompressed SEC1 point to this API explicitly.

This does not replace the local password-protected NIP-49 backup. Local identity
and community use must continue to work without corporate backup.

## Cryptography

- RFC 9180 Base mode
- KEM `0x0010`: DHKEM(P-256, HKDF-SHA256)
- KDF `0x0001`: HKDF-SHA256
- AEAD `0x0002`: AES-256-GCM
- `info`: the 19 ASCII bytes `buzz/nsec-backup/v1`
- recipient key: exactly 65 bytes, uncompressed SEC1 P-256 (`0x04 || X || Y`)
- plaintext: exactly the raw 32-byte secp256k1 Nostr secret
- one plaintext per fresh HPKE context

HPKE Base mode provides recipient confidentiality, not sender authentication.
The future service must authenticate enrollment/upload separately (and add a
signature if cryptographic sender authentication is required). Release policy
and enterprise authentication are also server responsibilities.

## JSON envelope

The wire object has exactly these fields:

```json
{
  "version": 1,
  "suite": { "kem_id": 16, "kdf_id": 1, "aead_id": 2 },
  "recipient_key_id": "immutable key version ID",
  "service_namespace": "service/environment namespace",
  "owner_id": "immutable opaque owner subject",
  "backup_id": "lowercase-hyphenated-UUID",
  "nostr_pubkey": "64 lowercase hex characters",
  "enc": "base64url without padding",
  "ciphertext": "base64url without padding"
}
```

`recipient_key_id`, `service_namespace`, and `owner_id` are exact UTF-8 strings
of 1 through 255 bytes with no control characters. They are opaque identifiers;
an email address is not an authorization identity. `backup_id` is the canonical
text form of the 16 bytes authenticated below. `nostr_pubkey` is derived from the
encrypted secret, never accepted independently. `enc` decodes to 65 bytes and
`ciphertext` decodes to 48 bytes (32-byte plaintext plus 16-byte GCM tag).

JSON member ordering and whitespace are not authenticated and consumers must not
depend on them. The metadata values are authenticated through the deterministic
binary encoding below.

## Associated data

AAD is the following concatenation, in this exact order. Integers are unsigned
big-endian. Text is exact UTF-8. `len16(text)` is a two-byte length followed by
that many bytes, so delimiters inside identifiers are never ambiguous.

| Bytes | Value |
|---|---|
| 23 | ASCII `buzz/nsec-backup/aad/v1` |
| 1 | envelope version `0x01` |
| 2 | KEM ID `0x0010` |
| 2 | KDF ID `0x0001` |
| 2 | AEAD ID `0x0002` |
| 2 + N | `len16(recipient_key_id)` |
| 2 + N | `len16(service_namespace)` |
| 2 + N | `len16(owner_id)` |
| 16 | UUID bytes in network order |
| 32 | raw Nostr x-only public-key bytes |

Before opening, receivers must reject unsupported version/suite values,
noncanonical UUID/public-key/base64 encodings, invalid field bounds, and wrong
binary lengths, then reconstruct AAD from the envelope.

The checked-in fixture at
`desktop/src-tauri/src/testdata/hpke_nsec_backup_v1.json` pins a full envelope,
AAD, recipient test key, and plaintext test key for future Kotlin interop. Tests
also open the exact required suite's official RFC 9180/CFRG vector; this verifies
standards compatibility, not KMS or KGoose integration.
