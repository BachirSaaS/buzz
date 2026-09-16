#!/usr/bin/env bash
# Local-only Block UI prototype: production relay, existing Buzz identity,
# isolated app data and agent configuration. Never prints or saves the key.
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"
source ./bin/activate-hermit

CONFIG_PATH="${TMPDIR:-/tmp}/buzz-blockui-staging-config.json"
export CONFIG_PATH
node --input-type=module <<'JS'
import { readFileSync, writeFileSync } from 'node:fs';
import { demoBuildConfig } from './desktop/scripts/demo-build-config.mjs';
const identity = demoBuildConfig('Block UI Staging', '2026091500000001');
const base = JSON.parse(readFileSync('./desktop/src-tauri/tauri.conf.json', 'utf8'));
writeFileSync(process.env.CONFIG_PATH, JSON.stringify({
  ...identity.tauriConfig,
  app: { windows: base.app.windows.map((window) => ({
    ...window, url: 'index.html#/pulse',
  })) },
  build: {
    devUrl: 'http://localhost:1435',
    beforeDevCommand: 'exec ./node_modules/.bin/vite --port 1435 --strictPort',
  },
}, null, 2));
JS

export BUZZ_BUILD_DEMO_SLUG="block-ui-staging-2026091500000001"
export BUZZ_RELAY_URL="wss://buzz.block.builderlab.xyz"
export BUZZ_SHARE_IDENTITY=1
export VITE_PORT=1435
export VITE_HMR_PORT=1436

if [[ "${1:-}" != "--no-build" ]]; then
    # A frontend-only setup can leave zero-byte sidecar placeholders. Build and
    # bundle the real agent executables before packaging a usable staging app.
    cargo build --release -p buzz-acp -p buzz-agent -p buzz-backend-kubernetes \
        -p buzz-dev-mcp -p git-credential-nostr -p buzz-cli
    bash scripts/bundle-sidecars.sh
fi
cd desktop

if [[ "${1:-}" != "--no-build" ]]; then
    pnpm exec tauri build --debug --bundles app --config "$CONFIG_PATH"
fi

# Buzz's source Info.plist supplies the production display name; stamp the
# local bundle after packaging, as the repository's demo-build recipe does.
export BLOCKUI_APP_PATH="$PWD/src-tauri/target/debug/bundle/macos/Buzz Block UI Staging.app"
/usr/bin/python3 - <<'PY'
import os
from pathlib import Path
import plistlib
import subprocess
import sys

app = Path(os.environ['BLOCKUI_APP_PATH'])
for name in ('buzz-acp', 'buzz-agent', 'buzz-dev-mcp', 'git-credential-nostr', 'buzz'):
    sidecar = app / 'Contents/MacOS' / name
    if not sidecar.is_file() or sidecar.stat().st_size == 0 or not os.access(sidecar, os.X_OK):
        sys.exit(f'Missing or unusable staging sidecar: {name}. Rebuild without --no-build.')
plist = app / 'Contents/Info.plist'
if not plist.is_file():
    sys.exit('Build the staging app before using --no-build.')
data = plistlib.loads(plist.read_bytes())
name = 'Buzz Block UI Staging'
if data.get('CFBundleName') != name or data.get('CFBundleDisplayName') != name:
    data['CFBundleName'] = data['CFBundleDisplayName'] = name
    plist.write_bytes(plistlib.dumps(data))
    subprocess.run(['/usr/bin/codesign', '--force', '--deep', '--sign', '-', str(app)], check=True)
PY

if [[ "${1:-}" == "--build-only" ]]; then
    exit 0
fi

/usr/bin/python3 - <<'PY'
import json
import os
from pathlib import Path
import subprocess
import sys

result = subprocess.run(
    ['/usr/bin/security', 'find-generic-password', '-s', 'buzz-desktop',
     '-a', 'secrets', '-w'], capture_output=True, text=True,
)
if result.returncode:
    sys.exit('Could not access the existing Buzz identity in Keychain.')
try:
    identity = json.loads(result.stdout).get('identity')
except (ValueError, AttributeError):
    sys.exit('The Buzz Keychain entry has an unexpected format.')
if not isinstance(identity, str) or not identity.strip():
    sys.exit('No existing Buzz signing identity was found.')
environment = os.environ.copy()
environment['BUZZ_PRIVATE_KEY'] = identity.strip()
binary = Path(os.environ['BLOCKUI_APP_PATH']) / 'Contents/MacOS/buzz-desktop'
if not binary.is_file():
    sys.exit('Build the staging app before using --no-build.')
print('Launching Buzz Block UI Staging with your existing Buzz identity.', flush=True)
os.execve(binary, [str(binary)], environment)
PY
