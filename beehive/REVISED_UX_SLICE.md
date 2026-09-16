# Revised manager UX — direct agent configuration

Completes the manager continuation from d216bbe (previously a local checkpoint).
No installation is performed by this continuation.

## Data flow and compatibility

- Registered-agent Details exposes Configure. Registration first verifies the
  selected agent's canonical matching nsec, then collects harness, provider,
  model, effort and environment. There is no configuration name or runtime
  chooser/setup/navigation. Start of an unregistered agent still registers first.
- Direct submissions create immutable backing definitions in the existing
  append-only settings catalog. These are real saved host-loadable definitions,
  not ephemeral display rows. Existing runtime records, credential references,
  registrations, host bindings, instructions and history remain retained.
- On an existing local slot, Configure awaits the exact host-loaded binding and
  submits authenticated revision-checked Save. Host selectedNext remains the
  authority; an active run is not mutated. Registration-to-Start still waits for
  enrollment/Save receipts and a matching report before Start. Cancellation,
  late completion, unknown results and stale selection remain fenced.
- Configure is host-local, matching credential/binding custody. Move selects the
  destination and uses that destination's saved future configuration; a destination
  needing setup is configured there through the same direct registration flow.
  No credentials or bindings are copied between hosts. Existing Move authorization,
  source teardown, destination preparation and late-grant rules are unchanged.
- Discovered harness inventory is now optional durable metadata in settings.json;
  historical catalogs without that field still load. Refresh harnesses invokes
  real discovery and retains providers and immutable agent definitions. It never
  silently selects a configuration or restarts a run.
- A valid process DATABRICKS_HOST is normalized into a durable public workspace
  reference without credentials, browser or model calls. The normal secure native
  path remains responsible for authentication when needed. Reopen reuses the
  reference instead of creating another provider.
- Signed-out Agents directly contains sign-in choices. Protected controller
  requests return a contextual sign-in requirement, and protected section
  navigation resumes after successful sign-in. Cancellation restores the prior
  section without Working. Signed-in Agents has no standing sign-in menu.
  Buzz first use still derives owner/normal Host relay in one selection; manual
  import accepts matching nsec and saved-owner sign-in uses the retained key.
- One Details border encloses report and actions; no third Controls frame or
  selectable Quit. q remains. Registered/Other grouping includes saved identities
  absent from the current directory. Pointer-opened inputs now retain focus after
  mouse dispatch (a real walkthrough finding, with a renderer regression).

## Focused validation

Direct Node 24.15.0 typecheck; controller/navigation **18/18**; form boundaries
**3/3**; Buzz custody/first-use/late completion **4/4**; direct Bun 1.4.2 renderer
**9/9**. The controller flow checks direct registration, active snapshot
immutability across Configure, remembered providers/harnesses/definitions, next
Start, signed-out authority and environment Databricks. Existing focused Move,
registration cancellation and late receipt tests remain included.

Two actual **100×30 shell-launcher** workflows use the existing first-use PTY
and registration/manager loader fixtures, with fresh explicit
`beehive-pairing-cli-` homes and credential files:

1. Signed-out Agents choices; contextual Harnesses sign-in cancellation and
   restoration; one Buzz selection resumes Harnesses; q/exit0/terminal restoration.
2. No controller owner or backing configuration initially; contextual Buzz sign-in;
   environment Databricks visible; actual provider Save; Refresh harnesses;
   separate Registered/Other; Start of known Other agent; matching nsec; direct
   harness/provider/model/effort/environment; running; Configure; Stop; actual
   launcher/controller reopen; remembered catalog and credentials; next Start;
   Stop; q/exit0/terminal restoration. Detail actions are pointer-driven and fields
   are keyboard-driven. Controller tests additionally verify old active snapshots
   remain byte-identical and next Start selects the new saved binding.

Only synthetic loopback relay, credential backend and external ACP fixture are
used. The native OAuth, production service/discovery and provider boundaries are
fenced. No production Keychain, provider, relay, browser, harness or host operation;
no native rebuild. Shell-launcher staging is under artifacts, not an installation.

Evidence directory: `/Users/loganj/.buzz/artifacts/beehive-direct-28618049/`.
Includes typecheck/focused/form/renderer/Buzz logs and actual shell smoke logs.
Initial iterations retained there include stale old-navigation expectations,
using the manager loader for a form-only file with additional exports, and the
pointer-focus failure. The first successful first-use driver also found a cleanup
attempt against an already-exited process; cleanup now checks its owned child.
None is represented as a production credential failure or a green broad suite.

**The inherited 400-second incomplete/non-green full-suite result remains open.**
No broad rerun, inherited-failure triage or repository-wide CI claim.

## Portable laptop-first smoke after separately guarded installation

Larry dispatches laptop installation first. From the exact installed package
root (not a production HOME), run its committed synthetic driver against the
actual installed launcher:

```sh
cd /absolute/path/to/installed/beehive
export BEEHIVE_SMOKE_NODE="$PWD/runtime/node"
export BEEHIVE_BUN="$PWD/runtime/bun"
export BEEHIVE_SMOKE_LAUNCHER="$PWD/bin/beehive"
"$BEEHIVE_SMOKE_NODE" --version  # v24.15.0
"$BEEHIVE_BUN" --version         # 1.4.2
/usr/bin/python3 test/buzz-first-use-smoke.py
BEEHIVE_SMOKE_DIRECT=1 /usr/bin/python3 test/buzz-first-use-smoke.py
```

The driver constructs a closed child environment, explicit credential fixture,
NODE_OPTIONS --import manager loader and fresh HOME itself. It prints each
surviving fixture root, with ANSI and reconstructed frames. The direct workflow
reopens that same synthetic home to verify saved configuration. Do not substitute
production credentials, loosen loader fences, or interpret fixture readiness as
real provider/relay approval. Install/publish provenance and exact head belong in
the delivery post, not a moving hash embedded in this document.
