# Revised manager UX — partial implementation checkpoint

Delegation 5b89d3b2; base 9aef40a3f626200ef1a702c64e315cad5339f2d3.
**Not a delivery candidate. Do not install this checkpoint.**

Implemented:
- Removed the separate Controls frame altogether. The right-hand Details border
  now encloses the report scroll and bounded, borderless action viewport. Tab/a,
  focused `[Actions]`, keyboard selection and pointer activation remain real.
- Production Agents row generation groups directory rows under Registered agents
  and Other agents using saved registration custody, with a Register agent row at
  the top of Registered agents. Other-agent details offer Register agent.
- Both profile preview and registration reject a key differing from the selected
  Other agent even without a Start continuation. Generic registration still permits
  deliberate selection of a new identity.
- Removed the selectable Quit action; retained quit keys. Named Refresh harnesses.

No settings schema, retained configuration, credential custody, transport, provider
or native implementation changed. Existing runtime workflows are still present.

## Evidence

Direct Node 24.15.0 package typecheck passes. Direct Bun 1.4.2 renderer: 8/8.
Focused Node registration/navigation: 15/15. Renderer includes 100x30 long report,
keyboard and pointer actions, unchanged-refresh report scroll AND selected action
focus retention, overflow, narrow layout and hidden-input/quit ownership. This is
renderer evidence, not the requested complete actual-launcher walkthrough.

Logs: `/Users/loganj/.buzz/artifacts/beehive-revised-5b89d3b2/`.
The first renderer run exposed old-coordinate expectations after removing borders;
the final action viewport retains the old usable row count (without a third frame)
and those existing coordinate assertions pass. One initial typecheck fixture lacked
required Settings fields; corrected the fixture rather than weakening its type.
No full-package run attempted; inherited timed-out/non-green baseline is unchanged.

Reproduce focused controller tests from repository root (fresh isolated fixture;
no production keychain/provider/service/relay operations):

```sh
NODE=/path/to/node-24.15.0/bin/node
ROOT=$PWD
FIXTURE=$(mktemp -d /tmp/beehive-pairing-cli-revised-XXXXXX)
BEEHIVE_TEST_CREDENTIAL_FILE="$FIXTURE/credentials.json" \
NODE_OPTIONS="--import=$ROOT/beehive/test/manager-installed-loader.ts" \
BEEHIVE_TEST_REGISTRATION_WALKTHROUGH=1 \
"$NODE" --test beehive/test/registration-start.test.ts beehive/test/manager-navigation.test.ts
"$NODE" beehive/node_modules/typescript/bin/tsc --noEmit -p beehive
(cd beehive && /path/to/bun-1.4.2 test ./test/opentui-screen.bun.ts)
```

## Required next work before publishing/installing

1. Evolve selected-next configuration API to accept harness/provider/model/effort/
   environment directly. Replace runtimeForm/name/chooser paths, registration's
   saved-runtime prerequisite, and Move's runtime selection. Preserve immutable
   saved records and active-run snapshots; do not implement UI-only fake runtimes.
2. Complete grouped Agents behavior for saved registrations absent from current
   directory results. Group header rows currently use ordinary list navigation.
3. Contextual sign-in chooser at actual authority boundaries; signed-out sign-in
   choices directly in Agents list. Verify Buzz first use without preconfigured
   owner, preserving its single-selection flow.
4. Remember/discover harness state on reopen, and project env Databricks availability
   using existing `databricksHost` URL validation and secure provider references.
   Current addDatabricks only saves a workspace/reference (no immediate login);
   do not accidentally add credential reads to passive render.
5. Extract/test actual production menu generation (existing renderer overflow test
   is explicitly only a generic stress fixture), then one complete isolated 100x30
   actual-launcher walkthrough using adapted existing loaders. Do not claim the
   preconfigured-owner registration fixture proves Buzz first use.
6. Self-review full flow, ordinary signed-off commit/publish and exact remote-head
   verification; then request separate laptop-first guarded installation. No native
   rebuild needed unless subsequent code changes native sources.

This run does not push or install. Laptop/current remains the prior 9aef40a build.
