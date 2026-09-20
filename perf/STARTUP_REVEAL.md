# Startup: reveal usable content without a cosmetic hold

## Retained change

Remove the cold-boot overlay and its 1,200 ms hold + 200 ms fade from
`desktop/src/app/App.tsx`. Keep the actual community/identity/permission gate,
animated loading bee, onboarding curtain, community-switch gate, error recovery,
and native first-render/window-geometry reveal unchanged. Fast boots may not show
the bee at all: responsiveness takes precedence over a minimum logo viewing time.

This does **not** make native initialization, relay reads, or the engine faster.
It removes a real input-blocking UI wait after the app has mounted. It applies the
foreground-first/no-unnecessary-waiting lesson without transplanting a transport.
No changes to membership, unread state, recency, subscriptions, or pagination.
The production delta is 69 removed lines and 3 added comment lines in one file.

## Matched browser result — 2026-09-20

Baseline: `9e5a9518e7f3fb62cdf14dc735d1092ed5844a85`.
Candidate: that baseline plus the App.tsx change in this commit.
Candidate App.tsx SHA-256:
`27210160d45b9d61574bb50a8cffec062404d34cae0ba8ed851f72241676f158`.

Five runs per scenario/version, one Chromium worker, same mock native/relay fixture,
Hermit toolchain, E2E build and machine. Each uncached sample uses a fresh browser
context. The cached sample reloads after the app persists its own sidebar snapshot;
the harness asserts snapshot diagnostics are `absent` or `present` respectively.
Old production's 1,200 ms policy is explicitly enabled: ordinary old E2E runs
silently bypassed it. Candidate has no hold policy or E2E exception.

All times are **median milliseconds from browser document navigation**, not process
launch. Raw samples: [STARTUP_REVEAL_RESULTS_2026_09_20.json](STARTUP_REVEAL_RESULTS_2026_09_20.json).

| Scenario / observation | Before | After |
| --- | ---: | ---: |
| No snapshot: sidebar row mounted | 332.1 | 313.8 |
| No snapshot: row accepts pointer hit-test | 1,655.6 | 376.3 |
| No snapshot: actual channel click received | 1,780.5 | 418.6 |
| No snapshot: messages visible and composer filled | 2,145.8 | 786.2 |
| Cached roster: sidebar row mounted | 118.0 | 116.6 |
| Cached roster: row accepts pointer hit-test | 1,486.8 | 156.3 |
| Cached roster: actual channel click received | 1,520.0 | 196.5 |
| Cached roster: messages visible and composer filled | 1,880.7 | 556.6 |

The useful interaction completes about **1.32–1.36 seconds sooner** in this fixture.
The much smaller change in row-mount time separates loading from the input-blocking
cover. Click timestamps include Playwright actionability/retry overhead; the
frame-sampled `elementFromPoint` observation independently establishes obstruction.
The final endpoint includes a visible message and successful composer fill, not
merely a connection badge, overlay removal, or mounted-but-covered element.

## Regression evidence

- Two ready-sidebar tests (cached/uncached) **fail on unchanged baseline** at the
  synchronous pointer hit-test, then pass on the candidate. They explicitly enable
  the legacy production hold to prevent the old E2E bypass hiding its restoration.
- Five startup tests pass: usable cold/warm sidebar; actual permission-trust IPC
  and workspace-apply IPC keep app/data reads gated while unresolved; failed apply
  stays closed and its Retry returns to a usable channel. Loading wings still animate.
- All 10 sidebar snapshot tests pass (including stale/wrong scope and refresh).
- All 72 onboarding tests pass.
- All 25 community-rail tests pass on the final full-file run. **One earlier
  keyboard-reorder test failed** in the combined 40-test run (39 passed). One
  baseline control and five candidate focused repeats passed, then full-file
  baseline and candidate runs both passed 25/25. Root cause of that intermittent
  failure is not established; no unrelated reorder change was made.
- E2E TypeScript/build passed. Full desktop lint/typecheck/unit checks are supplied
  by the standard pre-push hook; see the commit/push report for their result.

## Reproduce

In an isolated candidate checkout, activate Hermit, then:

```sh
cd desktop
pnpm build:e2e
BUZZ_STARTUP_BENCHMARK=1 pnpm exec playwright test   --project=smoke startup-usable.perf.ts --repeat-each=5
pnpm exec playwright test --project=smoke   boot-splash.spec.ts sidebar-snapshot.spec.ts community-rail.spec.ts
pnpm exec playwright test --project=integration onboarding.spec.ts
```

For the baseline, use a separate isolated checkout at the stated revision, copy
only `startup-usable.perf.ts` and its smoke registration into it, then rebuild and
run the same benchmark. Copy the new `boot-splash.spec.ts` there to reproduce the
two ready-sidebar failures. Never use a stale port-4173 server/build from the other
revision. The control used a separate source/dependency/build directory; no peer
worktree or live app storage was altered.

## Evidence boundary / remaining work

This is Chromium UI evidence with mocked native and relay commands. There is no
native WebKit/window-paint or live-relay before/after measurement here. Native
geometry restoration and `initial-render-ready` remain unmodified, but eliminating
the decorative reveal must still be visually checked in a packaged native app.
The old timer starts at CommunityApp mount: if real initialization already exceeds
its deadline, removing it saves little or nothing. These results are not evidence
that backend slowness, channel fan-out, or the entire old/new app gap is solved.

Repository-wide `just ci`, release packaging, native visual validation, PR creation,
merge, and deployment are not certified by this slice.
