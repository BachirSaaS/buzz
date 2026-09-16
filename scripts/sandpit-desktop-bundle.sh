#!/usr/bin/env bash
# Repeatable local app bundle, with isolated app, keyring, and OAuth identities.
set -euo pipefail
cd "$(dirname "$0")/.."
source bin/activate-hermit
just sandpit-poc-build
cargo build -p buzz-agent -p buzz-dev-mcp -p buzz-cli -p git-credential-nostr
TARGET_TRIPLE=$(rustc -vV | sed -n 's|host: ||p')
for executable in buzz-acp buzz-agent buzz-dev-mcp buzz git-credential-nostr; do
  cp "target/debug/$executable" "desktop/src-tauri/binaries/$executable-$TARGET_TRIPLE"
done
DEMO_CONFIG=$(mktemp /tmp/buzz-sandpit-bundle.XXXXXX)
trap 'rm -f "$DEMO_CONFIG"' EXIT
node desktop/scripts/demo-build-config.mjs 'Sandpit Demo' "$DEMO_CONFIG" 2026091500000001
BUZZ_BUILD_DEMO_SLUG=sandpit-demo-2026091500000001 pnpm --dir desktop tauri build --debug --bundles app --config "$DEMO_CONFIG"
DEMO_APP='desktop/src-tauri/target/debug/bundle/macos/Buzz Sandpit Demo.app'
cp sandpit/target/release/sandpit "$DEMO_APP/Contents/MacOS/buzz-sandpit"
codesign --force --deep --sign - "$DEMO_APP"
printf 'Demo app: %s/%s\n' "$PWD" "$DEMO_APP"
