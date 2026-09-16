#!/usr/bin/env bash
#
# A/B: adversary overhead. 10 tool calls with/without hook.
# Run from sandpit-play/ or anywhere with sandpit.toml.
#
# Usage: bash evals/eval-adversary.sh

set -euo pipefail

SANDPIT="${SANDPIT_BIN:-$(which sandpit 2>/dev/null || echo ~/.local/bin/sandpit)}"
EVAL_DIR=$(mktemp -d /tmp/sandpit-eval-XXXXXX)

PROMPT='Do these as separate tool calls, one command per call:
1. mkdir -p src data output
2. echo "hello world" > src/test.txt
3. curl -s -o data/example.html https://example.com
4. wc -c data/example.html
5. grep -o "<title>[^<]*</title>" data/example.html
6. find . -type f | wc -l
7. cat src/test.txt
8. ls -la output/
9. curl -s https://httpbin.org/get | head -3
10. echo EVAL_COMPLETE'

clean() { rm -rf src data output 2>/dev/null || true; }

timed_claude() {
    local label=$1; clean
    local t0=$(python3 -c 'import time; print(time.time())')
    claude -p --dangerously-skip-permissions --no-session-persistence --max-turns 25 --model haiku \
        "$PROMPT" > "$EVAL_DIR/${label}.out" 2>"$EVAL_DIR/${label}.err" || true
    local t1=$(python3 -c 'import time; print(time.time())')
    python3 -c "print(f'{$t1-$t0:.1f}')"
}

timed_goose() {
    local label=$1; clean
    local t0=$(python3 -c 'import time; print(time.time())')
    goose run --no-session -q --max-turns 25 \
        -t "$PROMPT" > "$EVAL_DIR/${label}.out" 2>"$EVAL_DIR/${label}.err" || true
    local t1=$(python3 -c 'import time; print(time.time())')
    python3 -c "print(f'{$t1-$t0:.1f}')"
}

timed_amp() {
    local label=$1; clean
    local t0=$(python3 -c 'import time; print(time.time())')
    amp --dangerously-allow-all -x \
        "$PROMPT" > "$EVAL_DIR/${label}.out" 2>"$EVAL_DIR/${label}.err" || true
    local t1=$(python3 -c 'import time; print(time.time())')
    python3 -c "print(f'{$t1-$t0:.1f}')"
}

echo "eval: adversary overhead (10 tool calls)"
echo "tmp: $EVAL_DIR"
echo

# Claude: with
"$SANDPIT" install claude 2>/dev/null
CW=$(timed_claude claude-with)
echo "claude  WITH adversary: ${CW}s"

# Claude: without
"$SANDPIT" uninstall claude 2>/dev/null
CO=$(timed_claude claude-without)
echo "claude  w/o  adversary: ${CO}s"
"$SANDPIT" install claude 2>/dev/null

echo

# Goose: with
"$SANDPIT" install goose 2>/dev/null
GW=$(timed_goose goose-with)
echo "goose   WITH adversary: ${GW}s"

# Goose: without
"$SANDPIT" uninstall goose 2>/dev/null
GO=$(timed_goose goose-without)
echo "goose   w/o  adversary: ${GO}s"
"$SANDPIT" install goose 2>/dev/null

echo

# Amp: with
"$SANDPIT" install amp 2>/dev/null
AW=$(timed_amp amp-with)
echo "amp     WITH adversary: ${AW}s"

# Amp: without
"$SANDPIT" uninstall amp 2>/dev/null
AO=$(timed_amp amp-without)
echo "amp     w/o  adversary: ${AO}s"
"$SANDPIT" install amp 2>/dev/null

clean
echo
python3 -c "
cw,co,gw,go,aw,ao=$CW,$CO,$GW,$GO,$AW,$AO
print(f'claude overhead: {cw-co:+.1f}s ({(cw-co)/co*100:+.0f}%), ~{(cw-co)/10:.1f}s/call')
print(f'goose  overhead: {gw-go:+.1f}s ({(gw-go)/go*100:+.0f}%), ~{(gw-go)/10:.1f}s/call')
print(f'amp    overhead: {aw-ao:+.1f}s ({(aw-ao)/ao*100:+.0f}%), ~{(aw-ao)/10:.1f}s/call')
"
