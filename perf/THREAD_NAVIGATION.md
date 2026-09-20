# Thread navigation: abandon obsolete history, fetch fresh on return

## Behavior and scope

Leaving a thread previously left its history request running. A return before
that request finished reused its old snapshot. Replies committed while the
channel was closed could be newer than that snapshot but older than the returning
live subscription's `since`, so the thread never displayed them. Abandoned
queries also kept dispatching serial history pages after navigation.

Consume TanStack Query's existing AbortSignal in both single-root and multi-root
thread hooks. Check cancellation before and after each page. The last observer
leaving cancels the query; a remaining observer keeps its pagination alive.
An already-dispatched Tauri invoke cannot be canceled: its result is discarded,
and further pages stop. Returning starts fresh without waiting for the old IPC.
No new timers, caches, schedulers, transport contracts, page sizes, or loading UI.
Production diff: `useThreadReplies.ts`, 20 additions / 2 deletions.

## Before/after evidence (2026-09-20)

Control thread implementation: `9fff1acca9b357b1209532de3c502e5d402a3484`
(and identical at `9e5a9518e7f3fb62cdf14dc735d1092ed5844a85`).
Control source SHA-256: `353bcf814d462b50ba9459d43dd082b7bb92e1e7e5c58cbb727a5a05478becfe`.
Candidate source SHA-256: `97b46bc7ba48b237585615554d6d73555dbbd6e82577ef428f62d4b00b8b0cea`.
Dependency inspected: actual installed `@tanstack/query-core` 5.100.14,
`src/query.ts:362-375` (last-observer handling).

| Controlled workflow | Before | After |
| --- | --- | --- |
| Return while obsolete snapshot remains pending | Reuses old request; latest reply missing | Fresh request completes independently; latest reply present |
| Leave after dispatching page 1 of a five-page thread | 5 history reads | 1 history read |
| Leave multi-root reader after page 1 of two | 2 history reads | 1 history read |
| Another reader remains | All pages delivered | All pages delivered |
| Cancel refresh after live cache update | Replies retained | Replies retained |

The six new real-hook tests use QueryClient, RelayClient, channel subscription,
and Tauri API adapter with controlled IPC responses. Both return tests explicitly
assert that the returning live filter starts at 202 and the missing reply is at
201. Four fail on the control for the expected fresh-fetch / page-count
assertions; all six pass on the candidate. Nine existing thread tests pass too,
including missing-target retries and cold-fetch target changes. Existing tests
emit React act warnings. A first negative-control cleanup leaked a timer after
an assertion failure; cleanup now flushes the held response before clearing the
client. The final negative control terminates with four failures and two passes.

The new Playwright regression drives the full rendered app: open thread, hold
its IPC snapshot, switch channels, commit reply, return, release snapshots,
assert reply text in the panel. It fails on the isolated old build because the
reply element is absent, and passes on the candidate. It uses the existing mock
bridge gate, not new production test hooks. The old source/build directory has
separate dependencies and outputs and no shared Git metadata.

Candidate browser run: 129 passed, 1 skipped across navigation, messaging,
thread unread/error/edits, project conversation failures, Huddle thread failures,
and the new regression. The existing skipped case is direct forum thread links
in navigation.spec.ts. Desktop lint/format checks and both E2E and production
frontend builds passed, with existing style/bundle-size warnings.

## Reproduce

Activate repo Hermit, then from `desktop/`:

```sh
node --import ./test-loader.mjs --experimental-strip-types --test \
  src/features/messages/threadNavigationFreshness.test.mjs \
  src/features/messages/useThreadReplies.test.mjs
pnpm test:e2e:smoke thread-navigation-freshness.spec.ts \
  thread-head-stale-edit.spec.ts thread-unread.spec.ts thread-load-failure.spec.ts \
  project-conversation-load-failure.spec.ts huddle-thread-load-failure.spec.ts \
  navigation.spec.ts messaging.spec.ts
```

For a negative control, copy only the new tests / Playwright registration into
an isolated old-code checkout; rebuild its E2E bundle. Verify port 4173 isn't
serving another checkout. Do not change a live application or its caches.

## Boundaries

This demonstrates missing-message recovery and less obsolete work, **not** a
measured startup/channel-switch latency improvement or a diagnosis of a specific
live session. Active long threads still load serially oldest-first. The initial
startup subscription workload is unchanged. Transport errors retain existing
retry/error UI. The abort primitive matches the existing channel-history path;
this work does not establish compatibility on every supported native WebKit.
No native launch, live-relay navigation run, or repository-wide `just ci` has been
claimed. Package-wide tests run through the normal push hook, separately from
the focused evidence above. Nothing is merged or deployed by these checks.
