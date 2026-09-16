# Host-local enrollment and Move — local functional candidate

Delegation `25a9e2b7`, based on `f59436c1aa6020e84f75853e54e59102103c9814`.
This replaces the earlier incomplete navigation checkpoints. Their exact text and
historical evidence remain available in Git and the referenced artifact directories.
No push, export, installation, relay change or native rebuild was performed.
Installed `176497874` stays intact.

## Corrected owner scope

Logan's correction `260a376e895ff7b1cce2fb8dcae800a4ad0661c8fcd30be0e7fc696e12905485`
and steering `5679e6d7d7b51a2b07103fa6cfd2182ab567269d5216dcce7b45799b61839de1`
supersede the earlier shared-first-enrollment investigation. **There is no shared
claim, global singleton or relay-rollout gate.** Registration and explicit Start
are host-local; Move transfers between selected hosts. Local duplicate prevention,
authenticated owner intent, retained identity/assignment history, credential custody
and truthful transfer outcomes remain required. Initial local enrollment does not
assert absence on independently configured hosts.

## Implemented flow and code map

- Four sections remain Host / Agents / Harnesses / Providers. Directory selection
  drives agent details. Start / Stop / Restart / Move and saved runtime
  harness/provider/model/effort/environment remain available. Later selected-next
  changes do not re-register identity or mutate active snapshots.
- `manager-controller.ts` captures an exact **local host** enrollment target for
  an owned directory agent lacking a local slot, even when another host reports
  that identity. `manager-view.ts` passes this target for explicit Start, not the
  other report's target. Matching hidden nsec and configured runtime registration
  still use read-back custody and settings revision fences.
- After verified registration, the controller submits a durable authenticated
  `enroll` intent. `host-transport.ts` admits it only from the configured owner.
  The host's bounded serialized enrollment queue runs under its existing
  `host.lock`; shutdown aborts/drains it before slot teardown.
- `local-enrollment.ts` retains an inert public `agents/<agent>/enrollment.json`
  before the ordinary journal and v3 manifest. Exact retained attempts recover
  journal/manifest prefixes; retained journals are never reset. Existing custody
  is read, not recreated. Enrollment hydrates through the extracted ordinary slot
  constructor. New and existing slot inventories are checked against the actual
  wire budget before manifest activation. Slot capacity stays 32.
- Enrollment is **stopped placement, not Start**. The continuation requires the
  enrollment receipt and fresh exact inventory, then the existing Save receipt,
  then submits ordinary revision-fenced Start. Cancellation may retain credentials
  or stopped enrollment, but cannot launch on a late receipt. Retry is explicit.
- Independent local roots now compose with Move. For such a destination,
  `authorize-move` is an authenticated owner command pinning the exact source
  operation/assignment, destination assignment and next revision. Only after its
  receipt does the controller submit the source Move. Destination preparation
  verifies this authorized prefix; the unseen successor still requires its exact
  source/relay signature. Without destination authorization, cross-root Move fails
  before source Stop. The previous same-root Move path is preserved.
- Destination adoption retains its prior assignment in `assignmentHistory` and
  preserves identity, configurations and run history. Authorizations/history are
  bounded. Selected-source owned Stop, preparation lifetime/CAS, source-consumed
  outbox, actual destination launch checks, retained receipts and failed/unknown
  outcome reporting remain governing. No credentials/workspace/session transfer.

## Evidence

`/Users/loganj/.buzz/artifacts/beehive-ux-25a9e2b7/`

- `focused-candidate.log`: **61 passed / 0 failed**, including initial unassigned
  registration → real private owner/host enrollment → actual owned process;
  cancellation before registration and after persisted enrollment; retry of
  before-journal, before-manifest and after-manifest failure prefixes; retained
  root/identity and host reopen; a running sibling unchanged; duplicate enrollment;
  independent-destination registration → actual Start → Stop → Move composition;
  cross-root Move without destination authorization refuses before source Stop;
  existing private/legacy/named Move, cancellation, signature, key-loss, Stop-failure,
  lost-grant and immutable selected-next tests.
- `typecheck-candidate.log`: Node 24.15.0 strict TypeScript passed.
- `renderer.log`: Bun 1.4.2 renderer **4/4**; four-way keyboard/pointer navigation,
  narrow layout, selected details, hidden input and cancellation ownership.
- `full-candidate.log`: one default-concurrent whole-package run, **239 passed /
  1 failed / 19 skipped**, 259 tests, natural 34.360 seconds. **Not green.**
  `broker.test.ts` failed its unchanged `ok` conversation-response timeout.
  Cause is not established; no deadline/assertion relaxation, serial mask or
  retry-to-green. Installed opt-in cases remain skipped. The earlier f594 Move
  suite evidence (233/1/19) and its qualification remain historical, not overwritten.
- `pty-first.log`, `walkthrough.json`, `01-host` through
  `11-destination-stopped` `.ansi`/`.txt`: actual isolated 100×30 Node/Bun PTY.
  Source starts without a slot/genesis; registration cancellation preserves
  settings; matching hidden nsec/runtime leads to actual gpt-5; Move reaches an
  independently enrolled destination and visibly reports **Move · Completed**;
  destination history is retained; awaited Stop and exit 0; nsec absent from output.
  Frames reconstruct real PTY bytes, not screenshots. Stop-barrier instrumentation
  is in tests; the PTY observes resulting states.
- Failed development evidence retained: `composition-first.log` exposed optional
  empty-chain normalization in the owner-authorized prefix; `composition-second.log`
  verifies its correction. `focused-final.log` and `typecheck-final.log` retain a
  duplicate local test variable introduced while adding reopen coverage; corrected
  candidate logs above supersede them. `registration-first.log`, `recovery-first.log`
  and `focused-first.log` preserve intermediate successful scope checks.
- Unchanged native historical 700-test evidence is reused, not rerun. No
  repository-wide CI, live provider/relay/admission/OS-store proof is claimed.

## Runnable reviewer UX

```sh
sh beehive/tools/ux-walkthrough.sh --help
sh beehive/tools/ux-walkthrough.sh
```

Every invocation creates a fresh `beehive-pairing-cli-ux-` HOME and explicit
`BEEHIVE_TEST_CREDENTIAL_FILE` plus `NODE_OPTIONS --import` installed-loader
isolation. It uses a real synthetic private relay, host owners and owned processes;
installed service, external provider, browser, harness and credential operations
remain fenced. Use only the printed synthetic nsec. The fixture pre-seeds the
configured runtime, not source placement. Destination setup uses ordinary local
registration and signed enrollment/Start/Stop, not a common pre-provisioned root.

Agents → Sign in → Start → yes → Review runtime → synthetic nsec → confirm.
Wait for running. Move → Destination host → confirm → wait for Move Completed.
Stop → confirm → wait for stopped. Ctrl-Q exits. Host/Agents/Harnesses/Providers
navigation and provider/runtime configuration remain as before.

Reproduce focused validation from package CWD:

```sh
NODE=/Users/loganj/Library/Caches/hermit/pkg/node-24.15.0/bin/node
"$NODE" node_modules/typescript/bin/tsc --noEmit
"$NODE" --test test/local-enrollment.test.ts test/registration-start.test.ts \
  test/private-move.test.ts test/move.test.ts test/named-move.test.ts \
  test/binding-recovery.test.ts test/manager-controller.test.ts test/intents.test.ts \
  test/profiles.test.ts test/host-settings.test.ts test/manager-navigation.test.ts \
  test/relay-directory.test.ts
"$NODE" --test test/*.test.ts
```

Independent UX acceptance is arranged by Larry after this functional handback.
Current-Desktop provider/harness parity is a separately supplied bounded read-only
delta, not a parity claim by this implementation. No packaged harness-contract pin,
Pi/Codex policy, Desktop/native source or installed artifact changed here.
