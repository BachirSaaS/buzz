#!/usr/bin/env bash
# Launch Riley's pinned service with the existing Buzz identity, kept out of logs.
set -euo pipefail
cd "$(dirname "$0")/.."
source ./bin/activate-hermit
exec /usr/bin/python3 scripts/chief-accumulator.py "$@"
