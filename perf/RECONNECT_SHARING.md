# Reconnect repair sharing: measured first slice

## Scope and recommendation

Share **only identical outstanding native repair pages within one reconnect
pass**. Keep this as a small work-reduction change, not an app-wide latency claim.
Production diff: 22 added lines, one replacement in
`desktop/src/shared/api/relayReconnectReplay.ts`. No changed timers, concurrency,
transport choice, native code, server policy, or retained response cache.

The active channel's window subscription and the background unread subscription
can request the same fixed-kind channel repair page. The key includes channel,
lower bound, limit, upper bound, and event-id cursor. Entries disappear on
success or rejection. Every subscriber retains delivery, dedupe, pinned retry
floor, cancellation, and generation checks. Memory is scoped to outstanding
reads in this replay pass, bounded by the existing four repair workers.

## Matched measurements

Baseline: `ef2aa1ae38fadcc0bc22b8bf6ed96b35933146be`.
The production source hashes are:

- Before: `930e8f214ecf0000be0c14081e0100f75f32e8517b36d1a81557d5d0574262e4`
- After: `9a4962c36f5c10c50155833f83a19b130b2c24fa73fd68482251a24214b174e1`

Node v24.15.0, macOS arm64; five alternating before/after pairs per case,
medians below. Final measurement ran without concurrent build/test jobs. Real-clock runs of
the production replay module; **synthetic 20 ms upstream reads** with a modeled
capacity of two or four. The replay worker count stays at its production default
of four in every case. Upstream slots are a workload model, not a claim that the
native HTTP client has a two-slot semaphore. Existing live-REQ batch delays remain.

Each channel contains 520 rows in relay order (`created_at DESC, id ASC`),
requiring two pages. Every subscriber's exact delivered ID sequence, uniqueness,
and completed repair state are asserted. One overlapping foreground subscription
adds no new channel, but it independently receives all 520 rows.

| Channels | Overlap | Upstream slots | Repair reads | Foreground callbacks complete, ms | All repair complete, ms | Deliveries, both arms |
|---:|:---:|---:|---:|---:|---:|---:|
| 1 | yes | 2 | 4 → 2 | 42.36 → 42.90 | 42.40 → 42.94 | 1040 |
| 12 | yes | 2 | 26 → 24 | 114.54 → 93.91 | 346.57 → 324.26 | 6760 |
| 32 | yes | 2 | 66 → 64 | 267.86 → 246.92 | 918.31 → 896.38 | 17160 |
| 12 | no | 2 | 24 → 24 | 114.12 → 114.32 | 302.13 → 302.38 | 6240 |
| 12 | yes | 4 | 26 → 24 | 93.10 → 93.12 | 220.15 → 220.45 | 6760 |

Raw samples: [RECONNECT_SHARING_RESULTS_2026_09_20.json](RECONNECT_SHARING_RESULTS_2026_09_20.json).
The earlier scratch fixture used the wrong event-id tie direction; this report
and the checked-in harness use the relay's actual order and supersede that run.

**Interpretation:** 26 → 24 reads is a 7.7% work reduction for the 12-channel
fixture. Roughly one modeled 20 ms service interval is saved when two upstream
slots are contended. With four upstream slots or just one channel, timing is
essentially unchanged. The negative control (no overlap) saves no requests.
These results do not establish native app paint latency, a deployed speedup,
or how often the exact-page overlap occurs in real sessions.

## Why exact matching matters

Production callers are `useLiveChannelUpdates.ts` (background) and
`relayClientSession.ts::subscribeToChannelLive` via `messages/hooks.ts`
(foreground). Both constrain history to their own subscription-start second.
If those floors differ, this optimization intentionally does not combine the
reads. Older subscriptions can converge once their common last-seen cursor
minus the 1,865-second replay lookback exceeds both initial floors.

The native command is `get_channel_reconnect_repair`, whose fixed kind list
already includes channel events independent of the live filter; differing live
filter kinds are therefore not part of the native repair key. No cross-session
or cross-community map is introduced.

## Regression evidence

- 17 new Node tests: actual replay and actual RelayClient → native invoke seam;
  dense-second pagination, per-subscriber live dedupe, different channel/floor/
  upper-bound/event-id cursor, settled-entry eviction, async failures and retry
  exhaustion, synchronous throws, disposal/replacement, stale generations,
  separate sessions, and one consumer callback failure.
- Exact baseline source substituted through an isolated Node module loader:
  **10 tests fail / 7 controls pass**; patched source: **17 pass**. Production
  files were never overwritten for the baseline check. This also falsifies the
  real RelayClient wiring, not merely an exported helper.
- Desktop pre-push hook lanes passed: full desktop Node suite (**6,525/6,525**), lint/static guards, and TypeScript.
- Browser reconnect file: **17/17 passed**, including a new real UI workflow
  with a fixed clock and delayed mocked native repair command. The test seeds a
  cursor, disconnects, inserts 521 offline events, reconnects, and asserts two
  repair reads, all 522 distinct returned IDs including the cursor seed across
  the dense-second boundary, and newest-message visibility.
- Production frontend/protected-artifact build and E2E build passed. Build emits
  chunk-size and mixed static/dynamic-import warnings; no bundling changes here.

The browser uses mocked transport; native Rust, a live relay, and native frame
paint were **not** measured. The existing browser history-CLOSED injection does
not intercept the newer native repair path, so its green result is not counted
as native repair-rejection evidence; the new Node failures exercise the current
native boundary/replay path instead. Full repository `just ci` was not run;
repository-wide Rust/mobile/server checks are not certified by desktop checks.

## Reproduce

```bash
. ./bin/activate-hermit
mkdir -p .scratch/reconnect-sharing
git show ef2aa1ae38fadcc0bc22b8bf6ed96b35933146be:desktop/src/shared/api/relayReconnectReplay.ts \
  > .scratch/reconnect-sharing/baseline.ts
cd desktop
node --import ./test-loader.mjs scripts/benchmark-reconnect-sharing.mjs \
  ../.scratch/reconnect-sharing/baseline.ts > ../.scratch/reconnect-sharing/results.json
node --import ./test-loader.mjs --experimental-strip-types --test \
  src/shared/api/relayReconnectSharing.test.mjs \
  src/shared/api/relayClientReconnectSharing.test.mjs
pnpm build:e2e
pnpm exec playwright test --project=smoke tests/e2e/relay-reconnect.spec.ts
```

Do not reuse another worktree's browser server or build output. No native or
relay deployment is necessary for these fixtures. A broader performance phase
should start with real session traces, not extrapolate this modeled gain into
ordinary sends, navigation, startup, or paint.
