#!/usr/bin/env bash
# Git exports repository-local variables (GIT_DIR, GIT_INDEX_FILE, ...) to
# hooks. Pre-push lanes run test suites whose fixtures spawn git in temp dirs;
# with those variables inherited, fixtures operate on this checkout instead.
# Transport, credential, and TLS settings (GIT_SSH_COMMAND, GIT_ASKPASS, ...)
# are left intact.
#
# Lefthook runs each lane in its own pty session, so a killed push never
# signals the lane directly: the pty just hangs up. `just` survives SIGHUP,
# so an `exec`'d lane would outlive the hook under PID 1. Instead this script
# stays the session leader and turns a hangup into SIGTERM for its whole
# process group, which `just` forwards to the recipe.
set -euo pipefail
# shellcheck disable=SC2046
unset $(git rev-parse --local-env-vars)
trap 'trap - HUP INT TERM; kill -TERM 0' HUP INT TERM
# Backgrounded so the trap can run mid-command; `<&0` keeps the caller stdin.
"$@" <&0 &
wait $!
