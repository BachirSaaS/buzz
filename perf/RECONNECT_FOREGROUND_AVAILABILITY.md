# Authenticated foreground availability during reconnect

## Change

Base: `564a7da84e7d7096649bc22126ca86354fa81437`.

`RelayClient.ensureConnected()` previously kept its shared promise pending until
all retained live subscriptions and their native HTTP history repairs finished.
Even after successful socket AUTH, new live subscriptions, finite WS reads and
plain-text sends inherited that unrelated wait.

Keep authentication as the availability boundary, but run recovery as an
observed generation-fenced continuation. Retain history repair, visible-first
replay ordering, batching, readiness timers, server cooldowns and post-recovery
reconnect callbacks. New subscription admission and reconnect send retries check
the existing WS cooldown, then revalidate session ownership/generation. Queued
repair workers must be current before mutating repair floors.

Production scope: three files, +70/-29 lines. No new scheduler, transport,
loading-state changes or timeout reductions.

## Controlled browser evidence

A production E2E bundle with the existing mock native bridge:

1. Warm random, return to general, deliver a general event to establish a cursor.
2. Disconnect; inject an offline random message; hold native reconnect repair.
3. Reconnect successfully, wait until repair is in flight, then navigate to random.
4. Observe a **new foreground REQ containing kind 39005**, not background cache
   delivery, and a subsequent random channel-window request while repair is held.
5. Release repair and require all held repair requests to finish.

The strict regression fails on the original bundle (no foreground REQ while
repair is held), passes the candidate, and is registered in the existing smoke
`relay-reconnect.spec.ts`. Merely asserting visible message content was rejected:
background subscriptions can merge that content into the cache without this fix.
Window requests before the foreground REQ are also excluded from the assertion.

Two controlled timing runs each, with repair released five seconds after the
measurement starts immediately before navigation:

| Bundle | New foreground REQ | First window request after that REQ |
| --- | ---: | ---: |
| Original, run 1 | 5,004ms | 5,006ms |
| Original, run 2 | 5,003ms | 5,005ms |
| Candidate, run 1 | 41ms | 41ms |
| Candidate, run 2 | 40ms | 40ms |

These timings prove removal of the injected dependency, **not measured savings
in the live native app**. They are not a benchmark of total channel rendering.

## Correctness gates

- 14 new tests bind the real RelayClient connection owner, AUTH and native repair
  seam: before/after AUTH availability, finite-read EOSE and accepted-send OK,
  rejected AUTH, current/stale replay failures, community replacement, cooldown
  admission and retry ownership, and queued six-subscription recovery overlap.
- Removing each new subscription gate, retry gate, publisher retry gate or queued
  worker fence in an isolated source copy makes its regression fail. Clean control
  and restored control pass; the candidate working tree was not mutated.
- Full desktop suite: **6,545 passing** through the standard pre-push test lane.
- All **18 reconnect browser tests** pass, including dense missed-history replay
  and shared repair reads; the final stricter window assertion also passes in
  standard smoke discovery and fails the original bundle.
- Desktop check, TypeScript, production artifact matrix and file-size check pass.
- Independent read-only lifecycle review found two issues in the first slice;
  cooldown admission and queued-worker ownership were fixed and re-reviewed.

Run the regression with the repository Hermit environment activated:

```sh
cd desktop
node --import ./test-loader.mjs --experimental-strip-types --test \
  src/shared/api/relayClientRecoveryAvailability.test.mjs
pnpm test:e2e:smoke relay-reconnect.spec.ts
```

## Boundaries

- Fresh cold startup has no retained subscriptions; its native freeze is not
  explained by this mechanism.
- Initial channel windows and thread pages use native HTTP directly. Their
  latency is not removed here; the request-size cliff is a separate lead.
- Existing-channel refresh listeners still run after recovery, intentionally.
- Real relay/native UI timing and repository CI remain separate validation gates.
- No live cache edits, deployment or relay changes are part of this patch.
