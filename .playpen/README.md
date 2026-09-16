# Buzz relay Playpen

The `builderbot-block` profile deploys the local `buzz-relay` binary into a
personal pod cloned from the `buzz` deployment in `bb-block` staging. The pod
keeps the staging deployment's environment, service account, secrets, database,
Redis, and S3 configuration. Treat every request as a staging data mutation.

The profile requires the `dx-admin-operator` role for the `bb-block` BuilderBot
cluster. It creates the temporary mesh Service and VirtualService used by
Playpen routing; no permanent per-user route is required.

## Direct workflow

From an `arm64` Linux checkout with Docker available:

```bash
. ./bin/activate-hermit
PLAYPEN_PROFILE=builderbot-block sq playpen sync --no-attach
```

The hook builds only `buzz-relay` in the Rust and Debian versions declared by
the production `Dockerfile`. It keeps the web and admin bundles from the
staging image.

## Build on Blox, deploy locally

BuilderBot cluster access is unavailable from Blox. When policy or local
resources require a Blox build, compile on an `arm64` Blox workstation and
download the binary into the same revision of a clean local checkout:

```bash
. ./bin/activate-hermit
PLAYPEN_PROFILE=builderbot-block sq playpen sync --dry-run --no-attach
```

Transfer `target/playpen-bookworm/release/buzz-relay` to that same path in the
local checkout.

Then activate the `bb-utility` toolchain locally so `bbp` is available and
tell the hook to use the downloaded binary. Keep Playpen's build phase enabled:
it also runs the copy and sync hooks.

```bash
source ~/.zprofile
. ~/Development/bb-utility/bin/activate-hermit
cd /path/to/buzz
BUZZ_PLAYPEN_USE_PREBUILT=1 \
  PLAYPEN_PROFILE=builderbot-block \
  sq playpen sync --no-attach
```

Use the exact Playpen name printed by `sync` when routing requests. To list or
remove the pod:

```bash
PLAYPEN_PROFILE=builderbot-block sq playpen list
PLAYPEN_PROFILE=builderbot-block sq playpen down
```

The Playpen expires automatically. Spin it down sooner when testing is done.
