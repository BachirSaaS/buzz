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
