# Explicit Buzz owner sign-in

Agents offers **Sign in with Buzz key** alongside saved-key and matching-key import.
The confirmation says Keychain read only, session only, no local copy. Merely
opening Beehive, selecting Agents, configuring routing, or choosing another
sign-in method never invokes this reader. It is not provider sharing/discovery.

## Canonical Desktop source contract

Verified using `git show` at Desktop commit
`6d1f488d2273dd314184fc2ec805f8982327dc51`, without changing this feature branch:

- `desktop/src-tauri/src/app_state_keyring.rs:9–23`: release service
  `buzz-desktop`; debug and demo services are deliberately different. This feature
  does not discover, select, or fall back to those services.
- `desktop/src-tauri/src/secret_store.rs:3–12,42–44,337–365`: the current item is
  service `buzz-desktop`, account **`secrets`**, a JSON map in the legacy macOS
  Keychain API, not an individual account named `identity`.
- `desktop/src-tauri/src/app_state.rs:306–307,371,387–388,667–673`: owner map member
  `identity`; Desktop encodes the secret as nsec and parses it as a Nostr key.
- `desktop/src-tauri/src/managed_agents/storage.rs:16–29`: agent nsecs share the
  containing item under `agent:<pubkey>` members.
- `desktop/src-tauri/src/secret_store.rs:549–575`: Desktop's ordinary `load`
  can migrate, write, and delete legacy entries. Beehive does **not** call it.

Reading the actual owner necessarily reads the containing JSON Keychain item,
which may contain agent nsecs, into the bounded Node helper. Beehive selects only
`identity`, never iterates/lookups other members or returns the blob. No separate
agent/provider entry, Desktop settings, legacy DPK item, or plaintext store is
queried. This unavoidable containing-item exposure is a security-review point,
not a claim that the OS supports reading one JSON member independently.

## Secret and authority flow

1. Renderer sends the explicit `signin-buzz` action with public routing only.
2. Controller retains existing owner/relay when configured; otherwise the human
   supplies them. Nothing is inferred from the discovered key.
3. Existing bounded Node credential child calls pinned `@napi-rs/keyring` via
   `loadNativeEntry()`, constructs the exact item, and calls **getPassword only**.
   Parse is bounded to a 1 MiB blob. Missing item/member, native access failure,
   malformed JSON/nsec/invalid scalar, and owner mismatch are distinct fixed
   outcomes; native denial/cancellation cannot reliably be distinguished and
   are reported together, not described as successful or as missing.
4. Only validated matching hex secret returns over private IPC. The controller
   checks generation/cancellation and independently validates the owner match
   before routing persistence/transport creation. Error text never includes
   native/parser exceptions or key material.
5. Existing management-client and authenticated directory code consume the
   secret. Buzz sign-in holds one controller-side session reference for explicit
   directory refresh; it does not re-read Buzz and does not require a Beehive
   Keychain copy. Saved/imported sign-in keeps its existing Beehive custody path.
6. Sign-out/close clears the session reference and closes the existing client;
   pending sign-in cancellation clears its retained reference and fences late
   completion. JavaScript strings/transport internals do not promise physical
   memory zeroization. Quit/sign-out does not stop hosts or agents.

No secret is added to snapshots, renderer messages, argv, public config/catalogs,
logs, or provider settings. Buzz Keychain is never overwritten, deleted, or
migrated. No key is generated; mismatch never retargets owner or relay. Existing
selected-next/active lifecycle behavior is untouched. The UI no longer incorrectly
claims every signed-in key is saved in Beehive.

## Synthetic validation and limitations

Final semantic candidate, pinned Node **24.15.0**, package-local TypeScript:

- Strict typecheck passed.
- `node --test test/buzz-owner-key.test.ts test/manager-controller.test.ts`:
  **12 passed**. New tests bind the real child IPC dispatch with a test-only
  native module injection; wrong service/account or any Beehive custody operation
  fails. Controller tests cover missing/denied/cancelled/malformed/mismatched
  results, late completion, config immutability, session refresh, and exclusion
  of owner nsec/hex/unrelated blob member from public snapshots.
- Pinned Bun **1.4.2**, `bun test ./test/opentui-screen.bun.ts`: **8 passed**.
- Actual Node controller + Bun UI in a fresh `beehive-pairing-cli-` HOME with
  explicit `BEEHIVE_TEST_CREDENTIAL_FILE`, `NODE_OPTIONS --import` established
  installed-loader isolation: Agents → Buzz key → cancel → confirm → signed-in
  controls. The directory and installed service paths were deliberately fenced.
  A separate fresh traversal of the **unchanged installed launcher** exercised
  saved-key sign-in (cancel/confirm), with the same explicit isolation. This is
  compatibility evidence, not installation of this feature or real relay proof.
- **One** default concurrent full-package run was attempted on the final semantic
  candidate. It exceeded the outer tool's **400 second** bound, so no final suite
  summary exists. Retained output reports failures in assignment, broker, and
  cancellation tests; the four new Buzz tests passed. No retry, serialization,
  timeout increase, or assertion relaxation. Baseline was already non-green
  (245 pass / 1 broker failure / 19 skip); this run cannot be equated to baseline
  or claimed green. Failure causes are unclassified.

Evidence bundle: `/tmp/buzz-owner-evidence/` (full/focused/typecheck/Bun logs,
actual-UI PTY drivers and ANSI captures). Initial UI-driver failures are retained:
raw terminal delta chunks do not always contain whole labels; confirmation
text required placing the new custody disclosure first; signed-in controls can
scroll beyond the visible area. Corrected traversal observes actual signed-in
state, not an off-screen Sign out label.

No native source changed or native package was rebuilt/tested. No production
Keychain access, provider/relay calls, install, push, or PR. OS prompt interaction,
actual production-item compatibility, installed feature delivery, and independent
security review remain unvalidated. Existing guarded publication/export route
must wait for that review.
