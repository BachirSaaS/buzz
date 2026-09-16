#!/usr/bin/env bash
# Local development preview with its own Desktop identity and keyring namespace.
set -euo pipefail
cd "$(dirname "$0")/.."
source bin/activate-hermit
cargo build --manifest-path sandpit/Cargo.toml --release -p sandpit-dylib
cargo build --manifest-path sandpit/Cargo.toml --release --bin sandpit
cargo build -p buzz-acp -p buzz-agent -p buzz-dev-mcp -p buzz-cli -p git-credential-nostr
cp sandpit/target/release/sandpit target/debug/buzz-sandpit
TARGET_TRIPLE=$(rustc -vV | sed -n 's|host: ||p')
for executable in buzz-acp buzz-agent buzz-dev-mcp buzz git-credential-nostr; do
  cp "target/debug/$executable" "desktop/src-tauri/binaries/$executable-$TARGET_TRIPLE"
done
# Development lookup uses workspace binaries, including the adjacent engine.
export BUZZ_DEV_KEYRING_SERVICE=buzz-desktop-dev.sandpit
export BUZZ_RELAY_URL="${BUZZ_RELAY_URL:-ws://localhost:3000}"
unset BUZZ_PRIVATE_KEY BUZZ_SHARE_IDENTITY BUZZ_ACP_SECURITY_POLICY BUZZ_ACP_SECURITY_STATUS
cd desktop
exec ../bin/pnpm exec tauri dev --config '{"identifier":"xyz.block.buzz.app.dev.sandpit","productName":"Buzz Sandpit Demo","build":{"devUrl":"http://localhost:1437","beforeDevCommand":"exec ./node_modules/.bin/vite --port 1437 --strictPort"}}' "$@"
