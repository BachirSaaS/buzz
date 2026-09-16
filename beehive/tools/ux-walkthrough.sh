#!/bin/sh
# Synthetic UI only: fresh file credentials and explicitly blocked external seams.
set -eu
if [ "${1:-}" = --help ]; then
  cat <<'HELP'
Synthetic manager walkthrough (100x30 terminal recommended).
Run without arguments; every invocation creates a fresh isolated HOME.

Right/Left: Host / Agents / Harnesses / Providers. a: controls. Tab: list.
Harnesses: Add runtime -> Buzz Agent -> Review OpenAI -> fixture-model ->
  Environment JSON (e.g. {"REVIEW_MODE":"synthetic"}) -> Runtime name -> yes.
  Escape at Environment cancels without saving. Select the saved runtime to
  inspect harness/provider/model/effort/environment names. Save affects new runs.
Providers: Add provider or Models; synthetic keys only. Escape cancels.
Agents: Register opens hidden nsec entry; Escape cancels.
Ctrl-Q: exit even inside a form.

This fixture blocks external credentials, network, browser and service actions.
It does NOT demonstrate registration-first execution or authenticated Move.
Use the committed runtime-environment and host-settings tests for synthetic
owned-process environment and Save/Start/Stop evidence, not this UI fixture.
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
unset BUZZ_PRIVATE_KEY BUZZ_AUTH_TAG BUZZ_RELAY_URL BEEHIVE_REAL_BUZZ_ACP
cd "$ROOT"
"$NODE" --input-type=module <<'JS'
import { fixtureCredential } from './test/manager-installed-fixture.ts';
import { publicKey } from './src/protocol.ts';
const directory = `${process.env.HOME}/.beehive/host`;
const signal = new AbortController().signal;
await fixtureCredential({action:'configure',directory,label:'Review host',owner:publicKey('1'.repeat(64)),relay:'wss://fixture.invalid'},signal);
await fixtureCredential({action:'add-openai',directory,name:'Review OpenAI',secret:'synthetic-only'},signal);
JS
printf 'Synthetic review HOME: %s\n' "$HOME" >&2
exec "$NODE" src/manager-entry.ts
