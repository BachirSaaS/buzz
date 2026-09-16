#!/bin/sh
# Synthetic UI only: fresh file credentials and explicitly blocked external seams.
set -eu
if [ "${1:-}" = --help ]; then
  cat <<'HELP'
Synthetic manager walkthrough (100x30 terminal recommended).
Run without arguments; every invocation creates a fresh isolated HOME.

Right/Left: Host / Agents / Harnesses / Providers. a: controls. Tab: list.
Harnesses: inspect the pre-seeded Review runtime (Buzz Agent / Review OpenAI /
  gpt-5 / high / REVIEW_MODE=synthetic). Provider/model controls remain independent.
Agents: Sign in with saved owner key -> select Review agent -> Start -> yes ->
  Review runtime -> matching synthetic nsec below -> yes. Registration selects
  the runtime through an authenticated Save receipt, then submits Start. Wait for
  the actual running report. Stop -> yes waits for owned process teardown.
  Refresh agents performs another bounded authenticated directory read.
  Choose runtime saves a loaded local runtime for the next launch, without
  changing the current run or requiring identity registration again.
Synthetic agent nsec (never use real credentials in this fixture):
  nsec1yg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3qxh9tww
Ctrl-Q: exit even inside a form; this test closes its owned relay/host.

The fixture pre-provisions PUBLIC assignment authority, but leaves catalog
registration absent. Registration does NOT mint genesis or host placement.
The real synthetic relay enforces owner signatures; the owned ACP process checks
REVIEW_MODE=synthetic. No installed service, provider, OS-store or external relay
is accessed. Host Start/Stop service buttons remain deliberately fenced.
Move: after Start, choose Move… -> Destination host / default runtime -> yes.
Wait for the agent to report its new host and running state. Inspect operations
shows Move complete only after that destination run is observed. Repeat Move to
return to Review host. Destination uses an isolated owned fixture runtime; no
workspace, session or key is sent between hosts. Both hosts pin the same explicit
public genesis and keep separate synthetic credential stores.
HELP
  exit 0
fi
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
NODE=${BEEHIVE_REVIEW_NODE:-/Users/loganj/Library/Caches/hermit/pkg/node-24.15.0/bin/node}
BUN=${BEEHIVE_REVIEW_BUN:-/Users/loganj/.buzz/artifacts/beehive-opentui-57f9c8fa/runtime/bun-darwin-aarch64/bun}
[ -x "$NODE" ] && [ -x "$BUN" ] || { echo 'Set BEEHIVE_REVIEW_NODE and BEEHIVE_REVIEW_BUN' >&2; exit 1; }
HOME=$(mktemp -d "${TMPDIR:-/tmp}/beehive-pairing-cli-ux-XXXXXX")
export HOME
export BEEHIVE_TEST_CREDENTIAL_FILE="$HOME/credentials.json"
export NODE_OPTIONS="--import=$ROOT/test/manager-installed-loader.ts"
export BEEHIVE_BUN="$BUN"
export BEEHIVE_TEST_REGISTRATION_WALKTHROUGH=1
unset BUZZ_PRIVATE_KEY BUZZ_AUTH_TAG BUZZ_RELAY_URL BEEHIVE_REAL_BUZZ_ACP
cd "$ROOT"
printf 'Synthetic review HOME: %s\n' "$HOME" >&2
exec "$NODE" src/manager-entry.ts
