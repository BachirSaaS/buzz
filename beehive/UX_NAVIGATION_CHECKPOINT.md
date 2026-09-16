# Revised UX checkpoint — incomplete

This is a local implementation checkpoint for delegation 6d8d3485, **not the
requested end-to-end candidate**. Base: `176497874fb450818fddcad6b04ce0e619183f81`.
No push, export, installation or native rebuild was performed.

## Implemented

- Four top-level sections: Host, Agents, Harnesses, Providers. Keyboard arrows
  cycle sections; header pointer targets use the same order, including 40-column
  layout. Each section retains its exact selection; a removed selection is not
  silently replaced by another target.
- Host displays host name, exact relay URL, state and saved/loaded revisions.
  Its single Start/Stop control follows the verified service state; unknown
  ownership still refuses Start. Existing awaited Stop is unchanged.
- Harnesses displays discovered adapters and saved runtime details. Opening the
  section invokes existing bounded discovery. Refresh and Add runtime are here.
- Providers independently displays saved providers, Add provider and Models for
  the selected provider. Details omit OS credential references.
- Agents exposes the existing signed management Restart operation, replacing the
  legacy blanket refusal. Exact selection/revision/freshness, assigned host,
  stopped/running phase and unresolved-operation gates precede submission.
  Host Restart still owns preflight, awaited teardown, replay and cancellation.

## Source/operation map

`manager-navigation.ts` owns section order and selection retention;
`manager-view.ts` chooses section controls and captures selected requests;
`opentui-screen.ts` owns keyboard/pointer presentation. The Node
`manager-controller.ts` remains the sole UI management-request boundary.
`intents.ts`, `host.ts`, service custody/ownership and all management-wire limits
are unchanged. Saving provider/runtime configuration still does not alter an
active run. Existing Pi and Codex runtime paths were not changed.

Current checkout Desktop sources inspected:
- `desktop/src-tauri/src/commands/agent_discovery/relay_directory.rs`: relay-self
  membership authority, paginated kind 39002 membership and owner kind 30177
  coordinates, exact-agent profiles and policy verification. **Not integrated
  into this checkpoint.** A broad kind-0 scan is not an equivalent directory.
- `desktop/src-tauri/src/managed_agents/discovery/{catalog,runtime_metadata}.rs`
  and `desktop/src/features/agents/lib/agentConfigCore.ts`: capability-driven
  harness/provider/model/effort fields and dependent-value policies.
- Existing Beehive `harness-discovery.ts`, `harness-contract.json`,
  `runtime-form.ts`, `settings-credentials.ts`, `settings-runtime.ts` and native
  helper contract remain in force. The packaged discovery contract is still
  pinned to historical `78618804...`; no new current-Desktop parity claim.
  No Desktop contributor rules changed; no Desktop files were edited.

## Required work still missing

1. **Global relay agent list**: Agents still uses private host reports, including
   host/operation rows. Next: add a bounded, cancellable authenticated directory
   adapter using the current Desktop consumer and explicit fixtures, then project
   exact-key directory rows independently from management authority.
2. **Registration-first continuation**: Register is still identity-only. Runtime
   choice, environment variables and automatic continuation are absent. Next:
   introduce a typed operation/result state machine (the current renderer request
   returns `void`, including failures), bind the exact nsec public key and saved
   runtime atomically, then continue only after verified success and fresh
   authority. Cancellation must discard continuation without claiming OS rollback.
   Secret possession must never synthesize assignment/genesis authority.
3. **Move in this manager**: absent. Next: expose the existing signed Move
   preparation/grant flow, capturing source and destination revisions; registration
   of a local destination must finish before source ownership is consumed. Reuse
   the real `move.test.ts`/named-Move fixtures for partial, stopped and unknown
   results rather than chaining optimistic Stop and Start.
4. **Current Desktop discovery/provider parity**: existing provider setup and
   runtime configuration are reused, not refreshed end to end. Next: compare the
   packaged contract and provider/auth/model consumers with current Desktop;
   preserve capability-specific Pi/Codex behavior and OS custody.
5. **Concise UI copy**: old prose, draft/publication actions and identity-only
   registration copy remain. Next: remove stale actions/copy with the completed
   agent workflow. Host name and relay are displayed, not newly editable.

No unresolved product-authority question was identified; these are unfinished
implementation tasks, not external blockers. Do not schedule delivery acceptance
against this checkpoint as if they were complete.

## Validation

Artifact directory:
`/Users/loganj/.buzz/artifacts/beehive-ux-6d8d3485/`

- Node 24.15.0 TypeScript check: passed (`typecheck-final.log`).
- Focused manager/navigation + real Restart integration: **9 passed**
  (`focused.log`). The final full run also covers added stale/standby Restart
  manager guards.
- Bun 1.4.2 renderer: **4 passed** (`renderer-final.log`): four-way keyboard and
  pointer navigation, narrow header, selected details, disabled controls,
  hidden entry, cancellation and editor ownership.
- One final default-concurrent package suite: **202 passed, 4 failed, 19 skipped**,
  225 tests, 32.344 seconds (`full-suite.log`). **Not green.** Failures:
  - `acp.test.ts`: ACP operation timed out (additional to the brief's historical
    three failures; cause not established).
  - `admission-cancel.test.ts`: wrong-authority control elapsed 2787 > 2500ms;
    log retains not-authority and accepted Start/Stop receipts.
  - `broker.test.ts`: `ok` stimulus conversation response timeout.
  - `disconnect.test.ts`: missing resistant readiness, null trace.
  No timeout, concurrency, assertion or production containment relaxation, and no
  full-suite rerun. Similar historical symptoms are not a waiver or diagnosis.
- Native unchanged: reuse supplied historical 700 pass / 0 fail / 1 ignored
  evidence; not a new native run. No repository-wide CI claim.
- Real isolated 100x30 PTY walkthrough passed (`pty-final.log`, `walkthrough.json`):
  all sections; cancelled registration and runtime form; provider cancellation
  preserves settings byte-for-byte; provider Save creates a second synthetic
  provider; selected-provider details and model listing; hidden keys absent;
  clean exit. External credential/relay/provider/browser/harness/service actions
  were explicitly blocked. This is not registration continuation or Move proof.

Failed evidence is retained: `renderer.log` and `renderer-diagnostic.log` used
`pressKey('right')`, which sends literal text; corrected to the mock's
`pressArrow('right')`. `pty-first/` and `pty.log` retain the first failed save
probe: the driver assumed Home selects the first action; it does not. Corrected
only the driver to use bounded Up arrows. `full-suite.log` retains all failures.

## Reusable reviewer walkthrough

From this checkout, in a real terminal at least 100x30:

```sh
sh beehive/tools/ux-walkthrough.sh
```

The script creates a fresh `beehive-pairing-cli-ux-` HOME, prints its path,
sets `BEEHIVE_TEST_CREDENTIAL_FILE` and `NODE_OPTIONS --import` to the extended
installed loader, seeds only synthetic host/provider data and starts the actual
Node controller/Bun renderer. It does not invoke the installed Beehive launcher.
Use only synthetic values. Every invocation creates a new fixture directory.

1. Inspect Host name/relay/state and Start control. Real service operations are
   blocked by the fixture; this is intentionally not a host lifecycle demo.
2. Right to Agents; `a`, Up to Register, Enter; Escape cancels hidden input.
3. Right to Harnesses; inspect Buzz Agent and Refresh. Add runtime traverses
   Harness → Provider → Model → Runtime name. Escape cancels.
4. Right to Providers; inspect Review OpenAI. `a` selects controls; Up/Down and
   Enter open Add provider or Models. Save a synthetic OpenAI key with `yes`.
5. Tab to list; Up/Down changes selected-provider details. Left/Right restores
   each section's prior selection. `q` quits outside forms; Ctrl-Q always quits.

For another machine, set `BEEHIVE_REVIEW_NODE` and `BEEHIVE_REVIEW_BUN` to direct
Node 24.15.0 and Bun 1.4.2 executables. The defaults point at existing local
runtime artifacts, not downloaded or rebuilt binaries.

Evidence replay: `cat <artifact-dir>/06-providers.ansi` in a 100x30 terminal.
`01-host.txt` through `10-provider-selected.txt` are plain frame reconstructions
from the real PTY bytes (not screenshots); corresponding `.ansi` streams are the
raw evidence. `pty-walkthrough.py` is the saved automation, `frames.py` the decoder.

Exact validation commands (Node/Bun variables are the script's defaults):

```sh
NODE=/Users/loganj/Library/Caches/hermit/pkg/node-24.15.0/bin/node
BUN=/Users/loganj/.buzz/artifacts/beehive-opentui-57f9c8fa/runtime/bun-darwin-aarch64/bun
cd beehive
"$NODE" node_modules/typescript/bin/tsc --noEmit
"$NODE" --test test/manager-controller.test.ts test/manager-navigation.test.ts test/restart.test.ts
"$BUN" test ./test/opentui-screen.bun.ts
"$NODE" --test test/*.test.ts
```

## Continuation b3d1e450 — environment and typed completion slice

This continuation remains **incomplete**, not a functional UX handback. No push,
export, installation or native change. The earlier missing-work list still applies
except that runtime environment configuration is now implemented. The earlier
navigation and Restart evidence remains valid for its stated scope.

Implemented in this slice:

- Node `ManagerController.request` returns `ManagerResult`: completed, submitted
  (with operation ID), failed, cancelled or ignored. `manager-entry.ts` carries
  that exact completion across IPC; `manager-view.ts` cannot treat a failed or
  cancelled profile lookup as success. Old preview data is cleared before nsec
  validation. Runtime discovery failure and model-query cancellation exit the
  form. Submitted is **not** a host receipt or successful execution.
- Runtime setup includes a JSON name/value environment field before the name and
  confirmation. Validation is shared between form, controller, settings, local
  setup and launch. It permits at most 32 entries, 2048 UTF-8 bytes/value and 8192
  serialized bytes; blocks controls, identity/provider/harness configuration,
  loader hooks and secret-bearing names. These are **nonsecret user-supplied
  values**, not an OS credential editor; naming rules cannot detect a secret
  disguised as an ordinary value. Provider/model/effort remain separate fields.
- The append-only settings snapshot includes environment; binding fingerprints
  therefore include it. `settings-runtime.ts` projects it only into the selected
  local binding; `host.ts` passes it into `prepareAgent`. `acp.ts` copies/freezes
  it and overlays authoritative managed environment. Save never mutates a prior
  definition or active run. Selected runtime detail lists variable names only.

Source-grounded limits / next edits (do not repeat broad discovery):

1. **Private Move is not an available existing manager operation.** There are
   three separate refusals: `intents.ts` submit's `privateHosts` allowlist,
   `catalog-transport.ts` send allowlist, and `host-transport.ts` authenticated
   receive allowlist. Host Move prepare/grant messages also currently have no
   private host-to-host authenticated routing. Legacy `move.test.ts` is necessary
   but insufficient. Implement authenticated source/destination grant transport
   and ownership verification before enabling the manager action. Do not merely
   remove these allowlists or chain Stop/Start. Native sources were not needed
   or changed in this slice.
2. **Directory still missing.** Current Desktop
   `commands/agent_discovery/relay_directory.rs:list_relay_agents_for_selection`
   first obtains relay-self identity, paginates kind39002 authored by that relay
   and scoped to viewer `#p`, and owner kind30177 coordinates; then exact-agent
   kind10100/kind0, verified profile owners and exact-owner `#d=agent` policy.
   It retains membership-visible or viewer-owned agents. This is not kind0
   enumeration and is not signed Beehive assignment authority. Add a bounded,
   cancellable Node adapter and explicit synthetic query transport; wire rows
   separately from `ManagerController.inventory` (still private reports).
3. **Registration-first continuation still missing.** `ManagerResult` is now the
   executable completion seam, not the requested governing registration/lifecycle
   state machine. `registerAgent` remains identity-only. Next introduce one
   captured operation state with exact agent/target/revisions and saved runtime;
   extend the credential operation atomically with that runtime association;
   continue only after verified registration and fresh assignment authority.
   Retained key read-back and public-only assignment journals remain unchanged.
   Do not manufacture genesis from nsec possession. Cancellation must discard
   the captured continuation without claiming OS rollback.
4. **Desktop provider/discovery parity still missing.** Bounded current consumer
   inspection: `AgentConfigFields.tsx:advancedEditorBlock` passes `config.env_vars`
   into `EnvVarsEditor`, excluding API key and structured keys; the latter keeps
   required/file-satisfied/hidden rows separate. `agentConfigCore.ts` owns runtime
   descriptors and dependent resets. Beehive's new nonsecret local JSON subset
   is intentionally more restrictive, not full Desktop parity; no historical
   harness-contract pin was updated. Current provider catalog/auth/model consumer
   alignment and remaining concise-copy cleanup still need implementation.

ACP failure investigation: saved prior `full-suite.log:266–272` identifies the
external ACP boundary test and `AgentSession`'s per-RPC timeout, but contains no
fixture mode or method. The a83a47b diff changed only manager/navigation/rendering,
their tests/docs and walkthrough; it did not change ACP/host launch paths. This
excludes a direct ACP edit in that commit, **not** contention or an unrelated bug.
The cause remains unestablished. This slice adds a test-only wrapper identifying
fixture mode while preserving the original error as `cause`, timeout, assertions
and production behavior. Focused ACP passed; that is not a diagnosis or waiver.

Evidence: `/Users/loganj/.buzz/artifacts/beehive-ux-b3d1e450/`

- `focused.log`: 34/34 controller, runtime integration, Pi, environment and ACP.
- `host-environment.log`: 11/11. Actual host Save/Start/Stop through synthetic
  transport and owned Buzz/OpenAI, Buzz/Databricks and Codex-shaped processes
  assert environment received, old active run unchanged, OS provider seams
  synthetic, and exact wire/inventory limits unchanged. Environment test also
  observes an actual owned ACP child's environment and immutable launch copy.
- `typecheck-final.log`: strict passed. `renderer.log`: Bun 1.4.2 renderer 4/4.
- `pty-final.log`, `walkthrough.json`: real 100x30 Node/Bun UI. Registration and
  environment cancellation preserve settings; environment Save persists exact
  `REVIEW_MODE=synthetic`, selecting runtime shows corresponding details; provider
  cancellation/save/models and four sections work; hidden keys absent; exit 0.
  `11-environment-entered`, `12-runtime-confirmation`, `14-runtime-selected`
  have both ANSI streams and reconstructed plain frames. `pty-walkthrough.py`
  contains exact key interactions. First successful PTY evidence is retained
  separately in sibling `beehive-ux-b3d1e450-first-pty/`.
- Package-wide suite was **not rerun**: requested functional scope is unfinished.
  Prior 202 pass / 4 fail / 19 skip remains the last full-suite result, including
  all four unclassified failures. No timeout/concurrency/assertion relaxation.
  Native unchanged: reuse historical 700/0/1 evidence, not a new run.

Reviewer entry for this slice only: `sh beehive/tools/ux-walkthrough.sh --help`,
then run without arguments. Add runtime -> harness -> provider -> model ->
Environment `{ "REVIEW_MODE": "synthetic" }` -> name -> yes. Select that runtime.
The fixture still deliberately blocks external service, relay and OS operations;
it does not establish registration-first or Move. Final independent UX acceptance
should wait for those implementation tasks, not treat this as completion.

## Directory / registration continuation c34a8d5b + 00bf38b9 — still incomplete

This section supersedes earlier statements that directory integration and typed
registration continuation are wholly absent. **Not ready for independent UX
acceptance:** first placement for an initially unassigned owned directory agent
is still missing. No Move/provider-parity acceptance, push, export, installation,
or native rebuild. Installed both-machine `176497874` remains untouched.

### Implemented and corrected

- `relay-directory.ts` follows current Desktop's relay-self/viewer-scoped signed
  39002 membership, owner 30177 coordinates, exact 10100/0 queries and NIP-OA
  profile ownership. Pagination, signature/query scope, response sizes, request
  counts and 30-second operation budget are bounded. No broad kind-0 scan.
- Agents are exact-key directory rows. Private reports supply execution evidence
  only; a unique assigned report and freshness are still required. Host/operation
  diagnostics no longer masquerade as discovered agents. Footer uses the owner
  management connection in Agents rather than the local service connection.
- For an **already provisioned/assigned local slot**, Start captures identity,
  target, revision and settings generation; matching hidden nsec plus saved
  runtime registers custody; loaded binding -> authenticated Save receipt ->
  fresh exact selection -> explicit Start. Cancellation and stale revisions retire
  continuation without claiming credential rollback. Registration alone does not
  create a journal or placement.
- Corrected the first-runtime freeze. `RegisteredAgent.runtimeId` is retained
  **initial-registration metadata only**, not selected-next authority. Credential,
  profile and identity bytes remain immutable. Registering an existing identity
  does not overwrite that record. `Choose runtime…` sends the existing signed Save
  operation with the selected local binding's exact id/fingerprint and model.
  Subsequent Start accepts any saved runtime selected by the host; it does not
  revert to the initial link or require another nsec. Active snapshots remain
  immutable. Named configuration selection continues using the same host Save.
- `Refresh agents` is explicit, not a background timer: one bounded canonical
  rebuild per action, authenticated through the existing credential boundary;
  management connection is reused, not duplicated. Failure/cancellation retains
  previous rows with an incomplete-refresh status; success replaces the directory
  (including removals). Generation/cancel/close and exact owner/client fences
  prevent late results from replacing current state. It does not auto-retry.

### First-use placement: exact remaining seam, not a fixture workaround

`registration-start.test.ts` now exercises an **initially unassigned owned** agent
against the real synthetic relay/private host. Signed directory discovery works;
registration saves identity/runtime; no setup manifest is created; Start refuses.
This is a regression documenting the gap, **not a passed first-use journey**.

The missing product operation is owner-authorized **initial placement/enrollment
of this existing identity**, with pinned genesis and host-local slot activation.
`assignment.ts:createGenesis` currently restricts roots to new identity creation
or verified one-time legacy enrollment. `credential-slots.ts` supplies
`provisionCredentialSlot`/`addCredentialSlot` and explicit partial reconciliation;
these hold `host.lock` and must not reset any retained journal. `host.ts:host`
hydrates `entries` once before connecting; settings reload only adds bindings to
those entries, never new slots. Thus merely calling registration, or adding a
slot fixture before host startup, cannot implement the requested flow.

Existing user actions: `cli.ts:provision-agent` consumes an already supplied public
genesis and local binding with the matching key, while the host is stopped;
`reconcile-provision` recovers its exact inert partial attempt. `export-genesis`,
standby import and existing Move can preserve a known holder's authority; they
are not a way to mint fresh authority for an unassigned relay identity. There is
currently **no manager user action completing first placement**. This is unfinished
implementation, not evidence that the authenticated owner's explicit Start could
never authorize enrollment. Next work must integrate that explicit operation at
the owner/host authority boundary, handle inactive/live host slot activation and
partial/retry records, and prove no competing genesis can duplicate a retained
holder. Do not infer execution rights merely from directory ownership or custody.

### Precise subsequent work

1. Finish the placement flow above and replace the documented refusal with a
   production-path first-use Start acceptance and foreign-owner/retained-holder/
   partial/cancel negatives. Keep the unassigned fixture option; do not pre-seed
   authority to make the acceptance pass.
2. Private Move remains blocked in `intents.ts` submit's `privateHosts` allowlist,
   `catalog-transport.ts` send allowlist and `host-transport.ts` authenticated
   receive allowlist. Implement authenticated source/destination host-to-host
   prepare/grant routing and exact owner verification before removing refusals.
   Registration/placement must finish before source consumption. Legacy
   `move.test.ts`, named-Move and recovery tests are necessary, not sufficient.
3. Current Desktop parity source map remains
   `managed_agents/discovery/{catalog,runtime_metadata}.rs`,
   `AgentConfigFields.tsx`, `EnvVarsEditor`, `agentConfigCore.ts` and provider
   auth/model consumers. Beehive's `harness-discovery.ts`, `harness-contract.json`,
   `runtime-form.ts`, `settings-credentials.ts`, `settings-runtime.ts` and native
   helper still use their documented subset/historical pin. Preserve Pi/Codex
   capability policies; do not represent this as refreshed Desktop parity.
4. UI still contains legacy explanatory/status prose and publication affordances.
   Final concise selection-driven copy and independent walkthrough remain gates.

### Validation and surviving artifacts

Previous run `/Users/loganj/.buzz/artifacts/beehive-ux-c34a8d5b/`:
`focused-final.log` 42/42, strict typecheck, renderer 4/4, real PTY registered
pre-provisioned slot -> actual gpt-5 -> Stop -> exit 0. Its footer/retry-fence deltas
postdated that PTY. All earlier failed attempts remain in that directory.

Current artifacts: `/Users/loganj/.buzz/artifacts/beehive-ux-00bf38b9/`.

- `focused-final.log`: **46 passed, 0 failed**. Includes private owner/host + owned
  ACP initial registration, second runtime Save while active remains byte-equal,
  Stop/next Start with `runtime:second-runtime`, unchanged identity catalog;
  initially-unassigned refusal; refresh removals/failure/cancel/one connection;
  directory signatures/pagination; existing runtime/provider/environment fences.
- `typecheck-final-corrected.log`: passed. `renderer-final.log`: Bun 1.4.2 **4/4**.
- `pty.log`, `walkthrough.json`, `01-host` through `07-stopped` and
  `02-refreshed` `.ansi`/`.txt`: final real 100x30 PTY, explicit refresh,
  registration cancellation preserving settings, pre-provisioned registration,
  actual gpt-5 run, awaited Stop, hidden nsec absent, exit 0. `pty-walkthrough.py`
  preserves commands; `frames.py` reconstructs plain frames from raw bytes.
- Failed attempts retained: `focused-first.log` 29/31 exposed the obsolete
  immutable-runtime exception assertion and an overbroad harness inventory object
  sent as a Save binding. Fixed to exact `{id,fingerprint}`; no host assertion or
  timeout relaxed. `registration-second.log` 8/8. `typecheck-final.log` preserves
  an optional-property test error; corrected with an explicit non-null assertion.
- Full suite **not rerun** because functional scope remains incomplete. Last
  full result remains **202 pass / 4 fail / 19 skip**, including unestablished ACP
  timeout, admission elapsed bound, broker response timeout, missing resistant
  readiness. Native unchanged historical **700 pass / 0 fail / 1 ignored** reused.
  No repository-wide CI or live provider/relay/OS-store proof.

Reproduce from package CWD using Node 24.15.0:

```sh
NODE=/Users/loganj/Library/Caches/hermit/pkg/node-24.15.0/bin/node
"$NODE" --test test/registration-start.test.ts test/host-settings.test.ts \
  test/manager-controller.test.ts test/relay-directory.test.ts \
  test/manager-navigation.test.ts test/relay-name.test.ts \
  test/runtime-environment.test.ts test/settings-credentials.test.ts
"$NODE" node_modules/typescript/bin/tsc --noEmit
/Users/loganj/.buzz/artifacts/beehive-opentui-57f9c8fa/runtime/bun-darwin-aarch64/bun \
  test ./test/opentui-screen.bun.ts
```

Reviewer: `sh beehive/tools/ux-walkthrough.sh --help`, then without arguments.
The runnable script uses fresh `beehive-pairing-cli-ux-` HOME **and** explicit
`BEEHIVE_TEST_CREDENTIAL_FILE`/`NODE_OPTIONS --import` loader; installed service,
external provider/harness/auth/relay seams remain fenced. The pre-provisioned
assignment limitation is printed in help. Do not use real credentials.

Partial implementation checkpoint (0605ceff): global and effective author and
committer verified as Logan Johnson `<loganj@squareup.com>`. Preserve configured
Git behavior and use `git commit -s` for DCO; absent GPG configuration is not a
blocker and no Git configuration is changed. This checkpoints the reviewed
surviving directory/registration/runtime delta, not completed first enrollment.
The 46-test evidence above remains scoped to that partial implementation.

## 0605ceff — committed partial delta; first-enrollment authority decision

The reviewed 17-file surviving delta is committed as
`8c15d7d736653ce52220209f7552b60dd9d7d259` using the existing `git commit -s`
workflow. Global and effective author/committer are Logan Johnson
`<loganj@squareup.com>`; no Git configuration changed. This is **not a completed
first-use candidate**. Both installed `176497874` exports remain untouched.

Fresh evidence in `/Users/loganj/.buzz/artifacts/beehive-ux-0605ceff/`:
`checkpoint-focused.log` **46/46 passed**, `checkpoint-typecheck.log` strict
TypeScript passed. The focused list is exactly the reproduction list above.
The unassigned-agent test still documents refusal, not acceptance. No full suite,
new PTY, renderer, native, production credential/relay/provider or installed
service operations were run. Prior failed evidence and suite qualification stand.

### Concrete scope question raised in the work discussion

Must conflicting first enrollment converge across **independent authenticated
controllers and independently empty hosts**, or only within one retained local
installation/controller history? `VISION_REMOTE_AGENTS.md` says Start “from this
machine or another” converges to one live instance. The current implementation
has no shared first-enrollment decision:

- `assignment.ts:createGenesis` makes a random public root; `handoff.ts` validates
  lineage relative to that root, not uniqueness across roots.
- `host.ts:loadSlotState` pins a root in one journal. `host.lock`, revisions and
  operation fingerprints serialize/replay one installation only.
- `host-catalog.ts:HostOffers` authenticates infrastructure routes, explicitly not
  placement. Empty offers/inventory cannot prove an agent lacks a retained holder.
- `intents.ts:managementClient` persists before sending, but its signer/relay-scoped
  journal is local to one controller root, not shared across controllers.
- `credential-slots.ts` provisions supplied roots and refuses retained/partial
  replacement. Those callers currently own the external bootstrap decision.

Counterexample to a local-only automatic implementation: C1 signs first Start
for agent A on empty H1; C2 independently signs first Start for A on empty H2.
Each host has the matching owner/key and can win its own exclusive file write.
Distinct roots both validate, and even a deterministic root ID cannot make
`initialHost=H1` and `initialHost=H2` agree. Host-local receipts, directory checks,
or a controller-local enrollment file cannot resolve this race. No such unsafe
root-minting path was added in this run.

If cross-controller convergence is required, select a shared first-write bootstrap
authority scoped to relay/owner/agent, with atomic absent-to-pinned-root semantics
and exact read-back. Ordinary last-writer-wins publication is insufficient. Its
role should end at pinning the one initial root/host; the existing assignment/grant
chain remains the sole subsequent placement authority. If the guarantee is
intentionally local-scoped, record that narrower product contract explicitly
before shipping a local enrollment implementation. This is a scope/trust-root
question, not a claim that authenticated Start cannot authorize enrollment.

### Remaining implementation, once that scope is settled

1. Extend the existing explicit Start continuation to capture an unassigned exact
   owned directory key and exact local infrastructure target. Registration keeps
   custody/read-back and runtime metadata separate from assignment authority.
2. Pin/recover the initial root through the approved bootstrap authority before
   host activation. Persist the exact authenticated intent before network effects;
   conflicting identity/root/target requests refuse rather than reset history.
3. Integrate the activation transaction in `host()` under its existing lock and
   private authenticated receive boundary. Serialize enrollment; retain an inert
   recoverable prefix before journal/manifest activation; validate exact inventory
   bytes before live admission. Extract the existing per-entry hydration closure
   rather than restart the host or add an outside manifest mutator. Host close must
   abort/drain enrollment before enumerating slot teardown.
4. Return a durable enrollment result before the continuation sends ordinary
   revision-fenced Start. Cancellation may leave registered or assigned/stopped
   state but cannot launch late. Replay cannot mint another root or repeat a run.
5. Replace the existing unassigned refusal test and extend the same private-relay
   walkthrough, not a pre-provisioned substitute. Cover duplicate/conflicting
   attempts, each persistence prefix/retry, cancellation and an existing running
   sibling. Retain Save -> active unchanged -> Stop -> next Start coverage.

Authenticated Move and Desktop parity remain mapped in “Precise subsequent work”
above; no allowlists or provider/harness contracts were changed here. Larry owns
scope resolution, subsequent dispatch and independent final UX acceptance.

## 064d8808 — authenticated Move candidate (existing pinned assignments only)

Agents → Move… now chooses a destination host and its selected local runtime,
then submits the real durable owner intent. No genesis or initial enrollment path
changed. Destination setup/credential repair remains explicitly host-local; a
missing key shows the exact `import-agent-key` action, not a remote secret form.
Hosts without this public slot still require local provisioning with the existing
pinned genesis and local binding, followed by host startup/Refresh. The selector
uses already-selected destination runtimes; it does not remotely create runtime
bindings or copy workspace/session/key material.

Protocol/code owners:

- `catalog-transport.ts` / `intents.ts`: canonical authenticated owner → source
  Move, encrypted durable request before effects. Separate authenticated destination
  receipt persists in `.destination`; source consumption alone stays pending (or
  unknown on disconnect). Completed transfer history survives later Stop/Move and
  controller reopen. Reconcile queries the source outbox even after source acceptance
  while the destination result is missing; exact consumed grants are replayed once.
- `host-transport.ts` / new `private-handoff.ts`: NIP-59 source/destination routing,
  exact authenticated sender/recipient/agent/owner pairing. Each new successor is
  source-signed over a domain-separated relay-bound grant. Verify unseen successors
  against the locally pinned prefix, never public directory/availability claims.
  Existing locally pinned unsigned history is not discarded; an unseen unsigned
  suffix is refused. This is trusted-holder continuity, not shared first enrollment.
- `host.ts` / `handoff.ts`: existing per-slot revisions/CAS, durable preparations,
  selected/actual snapshots, awaited owned Stop, source-consumed grant outbox and
  prepared launch fences remain authoritative. Sign before persisting consumption;
  bound projected preparation inventory and grant wire bytes. Conflicting target
  operation IDs reject during preparation, before source Stop. Destination completion
  also requires the exact Move run to be actually running, never an old receipt.
- `manager-controller.ts` / `manager-view.ts`: relay-listed selection, eligible
  destination/setup guidance, typed submitted completion, truthful host/running report,
  concise recent operation result. Source acceptance is not UI completion.

Evidence: `/Users/loganj/.buzz/artifacts/beehive-ux-064d8808/`.

- `focused-candidate-final.log`: **55/55**, including real private two-host owned
  processes, successful/reverse transfer, exact retry/reopen, cross-controller target
  ID conflict, stale target CAS, missing destination key before preparation, delayed
  prepared reply + Stop cancellation, lost-grant reconciliation, postconsumption key
  loss → assigned/stopped → repaired explicit Start, and injected owned source Stop
  failure → quarantine/actual retained → repaired Stop without destination execution.
  The same run includes legacy Move/named recovery/binding recovery, sibling isolation,
  registration/initial-enrollment refusal, intents, profiles/wire bounds and controllers.
- `typecheck-last-corrected.log`: strict TypeScript passed. Renderer
  `renderer-candidate-final.log`: Bun 1.4.2 **4/4**.
- `pty-candidate-final.log`, `walkthrough.json`, `01-host` through
  `11-destination-stopped` `.ansi`/`.txt`: actual 100×30 PTY, registration cancellation,
  matching hidden nsec/runtime, source actual gpt-5, Move chooser/confirmation,
  destination owned fixture-model run under signed successor, visible **Move ·
  Completed**, awaited destination Stop and exit 0. The nsec is absent from output.
  The PTY snapshots observe resulting states, not independent timing instrumentation
  of the Stop barrier. `tools/ux-walkthrough.sh` reproduces the same two-host fixture.
- One default-concurrent package run `full-candidate.log`: **233 pass / 1 fail /
  19 skip**, natural 32.689s. The unchanged broker response-timeout assertion failed;
  no causal fix, deadline relaxation, serial masking or retry-to-green is claimed.
  This whole-package run precedes the final target-ID/actual-run completion guard and
  precise repair copy; final focused/typecheck/PTY cover that delta. Prior 202/4/19
  evidence remains historical. No further package-wide run was performed.
- Failed evidence retained: first/second private fixture runs exposed a reused
  synthetic credential store across hosts (fixed with separate host-local stores);
  `focused-final.log` 42/43 retained an obsolete operation-copy assertion;
  `typecheck-last.log` caught TypeScript's stale narrowing across `handle(start)`.
  No safety assertion or timeout was weakened. Final checks above supersede them.

Installed host service/provider/relay/OS-store operations remain fenced. Both installed
176497874 exports were untouched. Unchanged native historical 700-test evidence is
reused, not rerun. No repository-wide CI, live provider/admission, independent UX
acceptance, first-enrollment shared-root resolution or Desktop provider/harness parity
is claimed. Larry owns independent Move UX review and those separately tracked scopes.
