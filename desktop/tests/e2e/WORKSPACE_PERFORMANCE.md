# Workspace performance checks

`workspace-performance.perf.ts` exercises the production E2E bundle with the
mock Tauri bridge. It measures Home/Messages round trips, focusing four populated
windows, and dragging a split divider. A message draft must survive every space
switch. The clock, viewport, content and CPU throttle are fixed across runs.

From the repository root:

```sh
. ./bin/activate-hermit
cd desktop
pnpm build:e2e
pnpm exec playwright test --config=playwright.workspace-perf.config.ts
```

The runner starts its own server on port 4187 and attaches
`workspace-performance.json`. For before/after comparisons, build each revision
into a separate directory with `pnpm exec vite build --mode e2e --outDir <path>`
and select it with `BUZZ_PERF_DIST=<absolute-path>`. Run revisions sequentially,
with DevTools closed and no simultaneous builds or tests. Compare multiple runs
on the same machine. Never serve a normal production build: it lacks the mock
bridge.

The report contains five samples and their medians. CDP durations are milliseconds
of browser main-thread work at 4× CPU throttling; layout/style counters are counts.
These include work during the scenario, including animation frames, and are not
end-to-end interaction latency. Host load can dominate duration differences, so
there are no machine-dependent timing assertions. This Chromium benchmark does
not establish native WKWebView performance.

The mounted regression tests enforce the underlying performance contracts:

- `useHistorySearchState.test.mjs`: unrelated URL keys do not rerender consumers;
  embedded windows retain independent navigation and history still coalesces.
- `usePulseWorkspaces.test.mjs`: atomic snapshot saves retain unchanged references
  without retaining data across community scopes.
- `usePanelGestures.test.mjs`: split previews do not synchronously read layout;
  release, cancellation and keyboard input keep their persistence behavior.
- `fetchPulseFeed.test.mjs`: independent source and structural reads overlap with
  at most three requests in flight; ordering and edit/retraction dependencies hold.

Use the existing workspace, canvas, panel, picker and window-switching smoke specs
to validate interaction behavior. In particular, exercise draft recovery, reload,
history, keyboard navigation, reduced motion, and interrupted gestures.

## Local verification, September 18, 2026

The performance pass preserved CSS, animation durations and workspace mount/unmount
behavior. Its final bundle passed 47 targeted browser tests covering workspace
ownership, drafts, history, reload, window swapping, connected panes, pointer and
keyboard gestures, cancellation, reduced motion, retry affordances, and summary
freshness. The full desktop unit run passed 6,606 tests; eight focused feed/resize
tests passed after the final changes. Typechecking, Biome on changed files, file-size
and text-size guards, and the E2E build passed.

An exploratory broader browser run was not clean: older Pulse navigation and
layout assertions, plus canvas picker-focus and drag-mode assertions, also fail
against the original bundle. All distinct failure classes were checked against
that baseline; the split-resize timeout passed in the final targeted run. The
broader run was stopped once these inherited failures were established.

In a sequential baseline → optimized → baseline measurement, each entry below is
the median of five samples. Baseline ranges show the two bracketing runs. These
are local measurements, not latency promises or cross-machine thresholds.

| Scenario | Baseline JavaScript time | Optimized JavaScript time | Baseline → optimized layout passes |
| --- | ---: | ---: | ---: |
| Home/Messages round trip | 352–388 ms | 298 ms | 30–31 → 24 |
| Focus four windows | 72–88 ms | 33 ms | 5 → 2 |
| Drag a split divider | 318–365 ms | 219 ms | 71–73 → 36 |

Earlier runs under heavier host load had inconsistent total switch-duration
results. The deterministic regression protections (isolated subscriptions,
unchanged content references, no forced layout in resize previews, and bounded
concurrent reads) are stronger evidence than any single timing comparison.
