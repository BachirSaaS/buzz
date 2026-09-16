#!/usr/bin/env bash
#
# Integration test: adversary hooks are auto-removed on `sandpit run` exit,
# unless they were pre-installed by the user.
#
# Case A (not pre-installed): sandpit auto-installs on enter, auto-removes on
#   exit. After exit, the hook must NOT be present in the agent's config.
# Case B (pre-installed):     user ran `sandpit install <agent>` before
#   `sandpit run`. After exit, the hook MUST still be present — sandpit did
#   not auto-install, so it must not auto-remove either.
#
# Each case runs with HOME pointed at a fresh temp dir so the user's real
# config files are never touched.

set -euo pipefail

SANDPIT="${SANDPIT_BIN:-$(which sandpit 2>/dev/null || echo ./target/debug/sandpit)}"
if [ ! -x "$SANDPIT" ]; then
    echo "sandpit binary not found at $SANDPIT — build it first (cargo build or just build)."
    exit 1
fi

PASS=0
FAIL=0
TOTAL=0

result() {
    TOTAL=$((TOTAL + 1))
    if [ "$1" = "pass" ]; then
        PASS=$((PASS + 1))
        echo "  ✅ $2"
    else
        FAIL=$((FAIL + 1))
        echo "  ❌ $2"
    fi
}

# Returns 0 if the claude PreToolUse hook is present in $HOME/.claude/settings.json.
claude_hook_present() {
    local f="$HOME/.claude/settings.json"
    [ -f "$f" ] || return 1
    # Look for our marker on any PreToolUse entry.
    grep -q '"_sandpit"' "$f" 2>/dev/null
}

# Returns 0 if goose adversary.md is present.
goose_hook_present() {
    [ -f "$HOME/.config/goose/adversary.md" ]
}

# Run a short-lived agent command inside a fresh HOME, return 0/1 based on a
# caller-provided hook check. Usage: run_case <agent> <expect_pre_installed>
#   $1 = agent name (claude|goose)
#   $2 = "pre" to run `sandpit install <agent>` before `sandpit run`,
#        or "fresh" for the auto-install path.
run_case() {
    local agent=$1
    local mode=$2
    local tmp
    tmp=$(mktemp -d /tmp/sandpit-auto-uninstall-XXXXXX)

    # Subshell so HOME/PATH changes don't leak.
    (
        export HOME="$tmp"
        # Keep the existing PATH so we can find sandpit, claude, goose, etc.

        if [ "$mode" = "pre" ]; then
            "$SANDPIT" install "$agent" >/dev/null 2>&1
        fi

        # Run a minimal command. We don't care about the agent's output —
        # we only care about the before/after state of the hook file.
        case "$agent" in
            claude)
                if ! command -v claude >/dev/null 2>&1; then
                    echo "SKIP: claude binary not on PATH"
                    exit 77
                fi
                "$SANDPIT" run -- claude -p "echo done" \
                    --max-turns 1 \
                    --dangerously-skip-permissions \
                    --no-session-persistence \
                    >/dev/null 2>&1 || true
                if claude_hook_present; then
                    echo "present"
                else
                    echo "absent"
                fi
                ;;
            goose)
                if ! command -v goose >/dev/null 2>&1; then
                    echo "SKIP: goose binary not on PATH"
                    exit 77
                fi
                "$SANDPIT" run -- goose run --no-session -q --max-turns 1 -t "echo done" \
                    >/dev/null 2>&1 || true
                if goose_hook_present; then
                    echo "present"
                else
                    echo "absent"
                fi
                ;;
            *)
                echo "unknown agent: $agent" >&2
                exit 2
                ;;
        esac
    )
    local rc=$?
    rm -rf "$tmp"
    return $rc
}

check() {
    # check <agent> <mode> <expected: present|absent> <label>
    local agent=$1 mode=$2 expected=$3 label=$4
    local out
    out=$(run_case "$agent" "$mode") || {
        if [ "$out" = "SKIP: claude binary not on PATH" ] || [ "$out" = "SKIP: goose binary not on PATH" ]; then
            echo "  ⏭  $label — $out"
            return
        fi
        result fail "$label — run failed: $out"
        return
    }
    if [ "$out" = "$expected" ]; then
        result pass "$label"
    else
        result fail "$label — expected $expected, got $out"
    fi
}

echo "integration: adversary auto-uninstall on \`sandpit run\` exit"
echo

echo "── Claude Code ──"
check claude fresh absent  "fresh install: hook absent after \`sandpit run\` exits"
check claude pre    present "pre-installed: hook still present after \`sandpit run\` exits"
echo

echo "── Goose ──"
check goose fresh absent  "fresh install: hook absent after \`sandpit run\` exits"
check goose pre    present "pre-installed: hook still present after \`sandpit run\` exits"
echo

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  $TOTAL tests: $PASS passed, $FAIL failed"
if [ "$FAIL" -eq 0 ]; then
    echo "  ALL PASSED"
    exit 0
else
    echo "  SOME FAILED"
    exit 1
fi
