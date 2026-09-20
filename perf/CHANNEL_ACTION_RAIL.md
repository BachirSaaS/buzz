# Warm channel switching: unused action-rail measurement

## Scope

Skip action-rail width measurement only when `MessageRow` has no displayed
header: `enabled: !isDisplayedAsContinuation`. The existing predicate is
`isContinuation && !message.pending`, so pending messages retain measurement.
The existing hook owns observer cleanup, reset, and re-enable.

Action controls remain mounted. Header reservation on hover/keyboard focus,
loading UI, corners, retention, scrolling, subscription freshness reads, and
transport are unchanged. No new scheduler, cache, or lifecycle owner.

This is a modest rendering improvement, **not a resolution of multi-second
native startup, channel switching, or relay waits**.

## Measurement

Baseline: `497e369e75cfa2ed8caeb1204e7233f30c6a7f90`.
Candidate `MessageRow.tsx` SHA-256:
`5ef36df5cfad76887c5a6b1a5ecf0c653e77019067d598b4e15f58f97ce86f27`.

Chromium 148.0.7778.96, production-optimized Vite e2e builds, mock Tauri/relay,
1280x800. Three alternating baseline/candidate context pairs per CPU rate;
two measured warm re-entries per scenario per context: **six samples per cell**.
Date fixed, native timers/rAF preserved; CPU profiling ran separately.

| Scenario | CPU | Visible newest message, median | Max long task, median |
|---|---:|---:|---:|
| Plain, alternating authors | 1x | 88.6 -> 92.2 ms | 0 -> 0 ms |
| Rich, grouped messages | 1x | 178.4 -> 167.4 ms | 105.5 -> 87.0 ms |
| Plain, alternating authors | 4x | 396.0 -> 402.6 ms | 159.5 -> 161.0 ms |
| Rich, grouped messages | 4x | 766.4 -> 689.0 ms | 448.5 -> 373.5 ms |

Rich readiness improved in each of the three pair medians at both rates.
Plain rows show no consistent benefit. This is about 11ms unthrottled in the
rich fixture; 4x throttling is a stress comparison, not a hardware model.

Readiness requires the correct newest message body above the composer, visible
within the timeline, for two native animation frames. One further second counts
deferred work. Mounted rows remain 50 plain / 60 rich. No fresh Markdown parses
occurred; the existing cache already serves warm switches. The intentional
subscription-handoff freshness read remains.

The build-only rail experiment and actual edited-source build contain 547
byte-identical files. Raw samples, source/bundle hash manifest, diagnostic CPU
profiles and harness are retained in the local evidence package
`RESEARCH/OLD_BUZZ_CHANNEL_SWITCH_PROFILE_2026_09_20/` in the agent workspace.
These measurements do not establish native/WebKit paint or live-relay latency.

A smaller initial retention window was rejected because deferred plain-row work
increased. Disabling corners diagnostically left most cost intact; a global
scheduler was not justified. Neither experiment is included in this patch.

## Regression evidence

`desktop/tests/e2e/message-rail-measurement.spec.ts` instruments the real
production caller: displayed header gets an observer; continuation gets neither
an observer nor an initial width read; pending transitions enable/disable/reset
and re-enable it; changing rail width by 40px must update the reservation exactly
and removing that width must restore it. Navigation cleans up. Hover/focus still
reveals continuation controls. Cache-driven pending transitions test presentation,
not send/relay lifecycle; visible controls do not prove every action executes.

The original production build fails at the continuation observer assertion
(expected zero, got one). The candidate passes. The regression is registered in
the regular smoke project, not only a temporary test configuration.

Validation on the candidate:

- Standard command below builds the actual source and passes all four checks in
  the three complete spec files. No retries.
- 6,531 desktop unit tests pass through the existing pre-push desktop-test hook.
- Desktop lint/static checks pass with existing warnings; TypeScript passes.
- Production protected-feature artifact matrix build passes.
- Independent read-only review found no production correctness blocker. Smoke
  registration and exact resize assertion were strengthened after review.

```bash
. ./bin/activate-hermit
cd desktop
pnpm test:e2e:smoke message-rail-measurement.spec.ts \
  message-author-overlap.spec.ts message-feedback-snapshots.spec.ts
```

Full repository CI, complete browser smoke, native/WebKit behavior, and release
readiness are not certified by these checks. No live app was restarted, cache
changed, or relay deployed for this work.
