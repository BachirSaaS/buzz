# Adversary evals

Live tests that measure adversary hook overhead and blocking effectiveness.
These make real LLM API calls — run manually, not in CI.

## Setup

Run from a directory with `sandpit.toml` that has `[adversary]` rules, e.g. `sandpit-play/`:

```bash
cd ~/Development/sandpit-play
bash ../sandpit/evals/adversary/eval-adversary.sh   # overhead
bash ../sandpit/evals/adversary/eval-blocking.sh    # blocking
```

Or use the bundled config:

```bash
cd evals/adversary
bash eval-adversary.sh
bash eval-blocking.sh
```

## Tests

### eval-adversary.sh — overhead

Runs 10 sequential Bash tool calls with and without the adversary hook.
Reports wall-clock time and per-call overhead for Claude Code and Goose.

### eval-blocking.sh — effectiveness

Tests that the adversary actually blocks what the policy says to block,
and allows everything else. Runs with and without the hook to confirm
the hook is what's doing the blocking.

Policy used: `BLOCK any access of www.news.com.au`

## Results (2026-03-26)

### Overhead (10 tool calls)

| Agent | With | Without | Overhead | Per call |
|-------|------|---------|----------|----------|
| Claude Code (prompt hook, haiku) | 37.8s | 14.4s | +23.4s (+162%) | ~2.3s |
| Goose (in-process, provider model) | 72.5s | 43.6s | +28.9s (+66%) | ~2.9s |
| Amp (delegate, rush mode) | 42.2s | 33.2s | +9.0s (+27%) | ~0.9s |

### Blocking (13/13 pass)

All blocked-domain requests denied. All allowed-domain requests and benign commands pass through.
Tested across Claude Code, Goose, and Amp.
