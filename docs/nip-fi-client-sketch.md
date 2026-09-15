# NIP-FI local-key client integration sketch

**Design/effort review only. Disabled by default. Not merge-ready or rollout evidence.**

This sketch follows [NIP-FI](nips/NIP-FI.md): a locally held Nostr key plus a
short-lived enterprise assertion. It does not implement remote custody, replace
local signing, or change the relay. JWT acquisition after browser login is an
assumed adapter capability. No real enterprise endpoint or credentials ship here.

## Read the diff in this order

1. `crates/buzz-ws-client/src/federated_identity.rs`: opaque assertion, explicit
   destination origins, proof-key equality, expiry, login-generation fence.
2. `desktop/src-tauri/src/federated_identity.rs`: assumed post-login exchange,
   native-only JWT storage, actual NIP-98/Blossom proof-key pairing.
3. Desktop sinks: `native_websocket.rs`, `native_relay_client.rs`,
   `huddle/relay_api.rs`, `relay.rs`, `relay/{get,submit}.rs`, media sinks.
4. Mobile counterpart: `shared/auth/federated_identity.dart`, socket/query,
   huddle, and media wiring.
5. Remaining work below. Header plumbing is NOT the whole level-of-effort.

## Product contract

Local keys remain portable and continue signing every event, as in VISION.md and
VISION_SOVEREIGN.md. Enterprise policy adds admission requirements for explicitly
configured communities, not a global replacement identity. No issuer or private
employee identity enters public profiles/events. A deployment can withdraw
enterprise access without taking custody of the user's key or deleting local
history. Local encryption, key backup, and key possession do not disappear.

An employee has one active bound key, not one key per device. Second-device key
transfer, lost-key rebinding, and membership/history migration are separate
product decisions; do not disguise them as automatic login behavior.

## Assumed login seam

Only the browser/code exchange portion of PR #7626 was consulted:
`builderlab/auth.rs` at `e00725c979a45c987ec757b08f607b9f0967c14c`.
That flow opens a browser with an ephemeral loopback return address, receives a
one-time code, exchanges it natively, and checks the current session. The JWT is
not the loopback URL credential and never passes through JavaScript.

The existing branch already has a browser login in `builderlab.rs`; this sketch
exposes `acquire_federated_assertion` as the next native command. It assumes:

- A build-configured HTTPS assertion endpoint, not discovered from a JWT or
  untrusted relay metadata.
- An authenticated request containing the current public key and relay URL.
- A response `{assertion, nostr_pubkey, expires_at}` where `expires_at` is a Unix
  second effective expiry consistent with JWT `exp` and issuer max-age policy.
- The adapter independently enforces enrollment, lifecycle, binding and possession.
  Merely submitting an arbitrary public key is NOT enrollment authorization.

These are illustrative field names, **not an existing kgoose API contract**.
Kind-27236 challenge signing/verification and PKCE/IdP details are intentionally
outside the assumed acquisition seam. Production must validate response metadata
against JWT claims and bind renewal to stable issuer/subject, key, and realm.
The current implementation checks syntactic JWS shape, key response consistency,
expiry metadata, and generation; it is not a client JWT cryptographic verifier.

Suggested native API after agreeing the adapter contract:

| Operation | Input | Result visible to renderer |
|---|---|---|
| Begin corporate login | configured realm, captured local identity | pending attempt identifier/status |
| Complete login + acquire assertion | browser code; native session only | ready/expiry/status, never JWT |
| Ensure fresh admission | realm, proof key, minimum remaining lifetime | internal assertion lease |
| Logout | current generation | cancelled operations/sockets and cleared credentials |
| Retry | current failed generation | one coordinated renewal, not one per component |

Current build knobs: `BUZZ_BUILD_NIP_FI_ORIGINS` is a comma-separated origin
allowlist; `BUZZ_BUILD_NIP_FI_ASSERTION_URL` selects the assumed exchange endpoint.
Absent origins preserve OSS mode. Mobile uses the same origins dart-define.
No internal deployment is enabled. Empty/misspelled origin configuration needs
release-time validation against the intended protected community inventory.

## End-to-end authority flow

```text
browser login → native adapter session → assertion issuance for LOCAL pubkey
                                      ↓
                    realm-scoped assertion session
                   /           |                 \
             WS upgrade    HTTP request       Blossom request
             + NIP-42      + NIP-98           + kind 24242
                   \           |                 /
                     same local key throughout
```

Do not put the JWT into `Authorization` (reserved for Nostr), event tags,
NIP-OA attestations, query parameters, logs, SQLite event storage, localStorage,
crash reports, or process arguments. It belongs in exactly one
`Nostr-Federated-Identity: Bearer …` request header. Avoid shared client defaults:
those clients also fetch third-party avatars, model providers, and other services.
Authenticated requests must refuse redirects, including same-host redirects that
change proof-bound paths. No unsigned retry on an enterprise-required origin.

## Transport inventory and actual sketch coverage

**Wired** means a real callsite now obtains/attaches evidence, not that its entire
lifecycle is complete. **Remaining** means include it in estimates and acceptance.

| Surface | Production seam | Sketch / remaining |
|---|---|---|
| Desktop live chat, forum, presence, typing, reactions, read-state, workflow/project event streams | TS `relayClientSession.ts` → native `native_websocket.rs` | **Wired upgrade** without JWT IPC; subsequent local NIP-42 unchanged. Native AUTH-key pinning and expiry/logout close ownership remain. |
| Desktop read-only observer sockets | `readOnlyRelayClient.ts` → same native bridge | **Wired upgrade**; observer-specific proof behavior and inability to anonymously observe protected communities need acceptance. |
| Desktop archive live sync, persona catalog, unread catch-up | `native_relay_client.rs` → `buzz-ws-client` | **Wired** shared assertion slot on every reconnect. Existing session cache is still `(relay,key)`; add login-generation/lifetime cancellation. |
| Desktop HTTP queries, explicit destination/key queries | `relay.rs::query_relay_at*` | **Wired**, exact serialized body still feeds NIP-98 payload hash. No-redirect client. |
| Desktop generic publication and deferred explicit-key publication | `relay/submit.rs`, `relay.rs::submit_signed_event_with_keys` | **Wired**, pair assertion with the NIP-98 proof, not event metadata or mutable current key. |
| Desktop workflow/moderation HTTP reads | `relay/get.rs` | **Wired** shared authenticated GET. Audit any new endpoint-specific callers. |
| Desktop media upload: image/video/file/voice/avatar/custom emoji | `commands/media_upload_progress.rs` | **Wired** upload request, no redirects; proofs shortened to 60s. Legacy alias retry needs fresh proof/evidence each attempt. |
| Desktop image protocol, video range proxy | `media_proxy.rs` | **Wired** both paths; no redirects. Existing cache policy is not enterprise-scoped yet. |
| Desktop save/copy/editor/snapshot media downloads | `commands/media_download.rs` | **Wired** main byte-fetch helper; unsigned proof-failure branch still needs explicit enterprise refusal. |
| Desktop persona-card avatar fetch | `commands/personas/card.rs` | **Wired** relay-origin credentials, third-party avatar requests receive no JWT. |
| Desktop human huddle audio | `huddle/relay_api.rs` | **Wired** every join/rejoin. Identity expiry/logout cancellation and reconnect UI remain. |
| Desktop transcription publication | `huddle/pipeline.rs` | **Wired** per-post assertion lookup using captured local key. Sketch stops on missing authority; durable/recoverable transcript behavior remains. |
| Desktop agent profile/snapshot publications | `relay.rs`, `commands/team_snapshot.rs`, `commands/personas/snapshot/import.rs` | **Wired key guard**: human JWT cannot authenticate agent proof. No agent assertion issuance implemented. |
| Desktop agent huddle TTS | `huddle/relay_api.rs` | **Wired key guard**, same agent policy blocker. |
| Mobile main socket | `relay_session.dart` → `relay_socket.dart` | **Wired** at connection time, using local signing as before. Renewal/provider rebuild/lifetime closure remain. |
| Mobile HTTP history/query | `relay_session.dart`, `relay_http_query_client.dart` | **Wired** paired request with redirect refusal in enterprise mode. |
| Mobile media upload | `media_upload.dart`, `media_upload/platform_bindings.dart` | **Wired**, no redirects; proof TTL 60s. |
| Mobile image/profile/custom emoji media headers | `media_auth.dart` → shared media consumers | **Wired**, fresh assertion composed outside memoized Blossom proof. Expiry must become retryable widget state, not uncaught build error. |
| Mobile huddle | controller → `huddle_auth.dart` → `huddle_transport.dart` | **Wired** authenticated production socket. Header-aware injected factory and renewal tests remain. |
| Mobile one-shot inactive-community publication | `signed_event_relay.dart::submitSignedEventOnce` | **Seam added, callers not wired**. Community removal, push bootstrap/revocation need explicit realm credential lookup. |
| Mobile invite mint | `features/invites/invite_create_provider.dart` | **Remaining** direct HTTP path; capture evidence after rate-limit waits, payload hash, no redirects. |
| Mobile invite claim | `features/invites/invite_join_provider.dart` | **Policy exception** in #7264, not precedent for unauthenticated normal usage. Confirm first enrollment flow. |
| Mobile pairing final relay verification | `features/pairing/pairing_provider.dart` | **Remaining** assertion for paired key; separate from ephemeral pairing sidecar. |
| iOS notification extension | `BuzzPushKit/.../BuzzPushNotificationResolver.swift`, two `/query` requests | **Remaining independent runtime**, not covered by Dart. See push section. |
| CLI and dev-MCP | `buzz-cli`, `buzz-dev-mcp`, shared WS crate | **Only shared request API added**. Independent credential acquisition/renewal/distribution needed, no implicit human token inheritance. |
| Git clone/fetch/push | `git-credential-nostr`, desktop Git launcher | **Remaining protocol integration**; credential helper cannot return the second header. |
| Browser repo/invite client | `web/` browser HTTP/WebSocket/media | **Remaining** CORS/header-capable transport and credential isolation; not covered by native code. |
| Pairing sidecar, public NIP-11, model downloads, updates, third-party URLs | separate hosts/transports | **No enterprise credential**, unless independently configured with a reviewed protocol. |

Not every event kind needs changes. Signing message/profile/reaction/read-state
builders remains local; they converge at a few network sinks. Conversely, a
feature that uploads media, posts an event, and opens audio crosses three sinks.

## Session/lifecycle implementation still required

The current slot is intentionally small. It is NOT a complete auth coordinator.

1. Capture `(realm, issuer/subject, local pubkey, login generation)` before async
   work. Keep a separate renewal sequence so two concurrent renewals cannot
   overwrite each other within one login generation.
2. Single-flight `ensureFresh` with bounded adapter calls and an explicit terminal
   state. Retain a valid assertion through transient failures; never turn a
   failure into an authoritative empty/unauthenticated success.
3. Derive effective expiry from JWT and configured policy. A 15-minute suggested
   issuer TTL is not a hardcoded client rule. Clock jumps, sleep, skew, and exact
   equality at expiry need tests.
4. For every new WS connection obtain current evidence, then fresh NIP-42. There
   is no in-band token replacement. An existing socket keeps its original lease;
   refreshing the slot does not extend it.
5. On expiration/logout/key import/community removal: stop new requests, cancel
   connect attempts and live sockets, cancel huddle I/O, invalidate media caches,
   reject late completions, keep local drafts. Existing cancellation owners must
   share this lifetime; a header check alone cannot stop an already-open socket.
6. Reconnect subscription recovery must cover the disconnected interval, not just
   replay live-only REQs. Archive uses live subscriptions: explicitly overlap
   finite catch-up with live delivery and deduplicate by event id.
7. Preserve pending publication identity and signed bytes. Lost ACKs are ambiguous:
   don't automatically regenerate an event with a new id after renewal. HTTP
   retries of reads differ from uploads/invites/non-idempotent mutations.
8. HTTP 401/missing → login; 403/evidence → bounded freshness recovery; 403/denied
   → stop loops; 503/unavailable → backoff. Server messages intentionally do not
   reveal offboarding vs private policy. Do not label every 403 "offboarded".
9. Renderer login gate should expose sign-in/cancel/retry and no local fallback on
   required communities. Distinguish network failure from employment denial only
   if the adapter supplies an authorized explanation. Preserve recovery controls.
10. Durable storage: memory-only assertion caching is adequate for the sketch.
    Production must decide whether to persist the login session in platform secure
    storage and reissue assertions after restart. No plaintext JWT preference file.

### Known sketch limitations, not hidden rollout assumptions

- Desktop post-login acquisition is a registered command, not yet invoked by a
  corporate login UI. The existing login host must be parameterized for the
  deployment. No real login/renewal was performed.
- No automatic renewal, single-flight coordinator, terminal auth state machine,
  full logout/socket cancellation, or complete community/key-change fencing.
- Invalidate is wired to desktop login start/logout, not every identity mutation.
  Acquisition can still race ordinary login invalidation paths; deployment is off.
- Tokens/metadata are trusted adapter response inputs; JWT claim consistency and
  stable corporate subject pinning still need implementation.
- Shared native bridge uses the current local key when opening; it does not yet
  bind later renderer-generated AUTH frames to that captured key locally. Relay
  pairing remains authoritative.
- Mobile provider owns a session but no mobile adapter exchange installs it yet.
  Optional callback seams preserve OSS tests; remaining one-shot callers have not
  opted in. They must not silently omit required evidence in an enterprise build.
- Existing unsigned media recovery, media error propagation, image/video disk
  caches and reload behavior need explicit enterprise policy and tests.
- Changes compile under the chosen build configuration only when separately
  verified; green unit tests do not prove app integration or deployment readiness.

## Media and cache work beyond headers

A video player can retain headers captured at initialization and perform a new
range request much later. Refresh at actual native request time, or rebuild the
player with preserved playback position. Exercise seek, background/resume, long
playback, voice notes, download/copy, thumbnails, profile avatars and emoji.

The JWT lifetime and 60-second Blossom lifetime are independent. Cache proof
bytes only until their own deadline; never memoize the JWT inside a long-lived
proof cache. Each new request needs both current pieces. Upload expiry is checked
at admission; don't assume a long video upload must finish in 60 seconds. Retrying
an upload later requires fresh proof and assertion, while preserving file bytes.

The proxy currently forwards public immutable caching headers. Define whether
local cached content remains accessible after logout/offboarding, and partition
caches by community and identity. An assertion cannot revoke bytes already stored
on disk. HTTP cache keys, Flutter image providers, audio/video plugins, OS caches,
and signed URLs are distinct seams. Do not promise retroactive deletion.

## Agents, Git, push, and browser are real scope

### Agents

NIP-OA proves owner authorization, not equality with the human assertion's
`nostr_pubkey`. Local agents, managed agent reconciliation, agent TTS, remote
provider deployments, CLI subprocesses and restart restoration require their own
admission design. Choose issuer-minted agent assertions or an explicitly reviewed
relay policy; don't append human JWTs to subprocess environment indiscriminately.
Document capability gates for unsupported operations instead of pretending all
agent workflows survive unchanged. Ordinary human conversation with an already
admitted agent is unaffected by this distinction.

### Git

The spec exempts credential-helper NIP-98 proofs from per-endpoint method/body
binding, NOT from the NIP-FI header. `git-credential-nostr` returns one credential;
it cannot alone attach the second header. A process-scoped authenticated bridge or
carefully scoped Git HTTP configuration needs implementation. Avoid JWTs in
persistent git config, command-line arguments or logs. Scope to exact repo host,
refresh on new requests, honor the proof's 60-second freshness, and test submodules,
LFS/redirects if supported, fetch and push separately. Git object signing stays local.

### Push

The iOS extension runs without the Flutter app and independently fetches messages
and presentation profiles over HTTP. Its App Group/keychain model needs assertion
sharing or a bounded background reissuance design. Expired evidence should produce
a generic notification, not a retry storm or stale cross-account preview. Check
lease creation/renewal/revocation, device removal, logout while asleep and durable
revocation journals. Decide independently whether push delivery itself is gated
by corporate lifecycle; client headers alone do not change gateway delivery.

### Browser

Native WS header injection does not solve the browser WebSocket restriction.
Browser HTTP needs CORS allowing the identity header; images/video require a
header-capable fetch/proxy rather than query-string credentials. Specify whether
protected browser access is in scope or explicitly unsupported. Public NIP-11
cannot bootstrap issuer/audience/private tenant configuration.

## Effort comparison rubric

Compare identical acceptance scope, not PR line counts. Below are work packages,
not calendar estimates (backend/API readiness and platform coverage dominate).

| Work package | Relative size | What this sketch establishes |
|---|---|---|
| Adapter login/acquisition | Medium, assumed backend | Reuse browser flow; new assertion exchange and binding contract |
| Scoped native assertion owner | Medium | Small independent object; local signing untouched |
| Desktop socket + HTTP threading | Medium | Several central sinks plus explicit-key/background exceptions |
| Mobile transport threading | Medium | Shared seams exist, but async media/UI adaptation is separate |
| Renewal/cancellation/catch-up | Large | Cross-cutting state machines; no in-band WS renewal |
| Media playback/caches | Medium–large | Separate JWT and proof deadlines; platform caches |
| Multi-device/key recovery | Product + medium client | Existing local key model retained, not solved by corporate login |
| Agent admission | Undecided / potentially large | Human assertion cannot cover another key |
| Git/browser/NSE | Large if all required | Independent processes/protocols, not incidental header additions |
| Acceptance/regression coverage | Large | Real expiry, revocation, multi-device and outage workflows |

The local-key approach avoids remote signing RPCs for every message, local crypto
replacement, and keyless feature parity work. It still pays for enterprise login,
assertion lifecycle and *every network admission surface*. Neither advantage
eliminates offboarding integration or native/background credential handling.

## Validation/acceptance plan

Automated tests must hit production sinks, not just token helper predicates:

- Adapter loopback fixture: login cancellation, wrong key, response-size bound,
  transient outage, superseded completion, concurrent renewal, expired response.
- Real local WS fixture capturing upgrade header, then verifying NIP-42 key;
  main native bridge, background client and huddle. Token never appears in frames.
- HTTP fixture captures both headers and exact body/hash; missing/expired/key
  mismatch refuse before sending; third-party origin/port and redirects get no JWT.
- Media proof TTL/tag tests; expired read renew once; range seek after 60 seconds;
  upload retry keeps payload bytes; unsigned recovery forbidden when required.
- Same-key logout/login, key replacement and community A→B→A during pending work;
  no stale installs/ACKs/cache writes. Independent agents cannot inherit human JWT.
- Short server lifetime forces new WS plus overlapping catch-up, preserves draft,
  and doesn't duplicate publication after ambiguous ACK.
- Mobile widget tests for sign-in/retry states; provider invalidation; every media
  consumer; background/resume and huddle renewal. NSE Swift tests separately.
- Off-mode regression suite and full `just ci`; live relay-backed tests with Will's
  WS/HTTP/deny/media branches integrated. No enforcement-stub rollout.

Live acceptance must name the device/build, community and exact workflow. At
minimum: retained local identity login, second device, send/reply/media/huddle,
expiry/reconnect, adapter outage, logout and revoked admission. No production
identity, schema, lifecycle state or deployment should be modified for this sketch.

## Dependencies

- #7224: WS admission/expiry; #7264: protected HTTP; #7265: disconnect/deny;
  #7288: strict media proof. These are independent work in progress; the sketch
  does not merge their relay code or assume their stub integration is complete.
- #7626 is only a login-flow reference, not a dependency on remote signing.
