# Owner deletion automatic preparation

## Goal

Extend the existing one-shot `buzz-admin deletions drain` command so it can
prepare authenticated owner-origin deletion requests before handing them to
the unchanged approved-request executor.

## Invariants

- Owner admission remains a fast PostgreSQL-only `submitted` write.
- Only structured `request_origin = 'owner'` rows may progress automatically.
- Operator-origin requests retain explicit inventory and approval semantics.
- One durable generation lease spans inventory, automatic approval, and
  execution; PostgreSQL remains the only retry and checkpoint authority.
- Inventory freeze and `owner_automatic` approval commit atomically.
- Automatic preparation adds no lifecycle stage, command, worker, schedule,
  credential, or generic job abstraction.
- Privileged abort is reversible only at `submitted`, `inventoried`,
  `approved`, or `fenced`; owner submission has no owner cancellation path or
  grace period.

## TDD sequence

1. Add migration/schema contract tests, then add bounded approval provenance,
   submitted retry support, and the owner-preparation candidate index.
2. Add PostgreSQL tests for owner-only lease claim, concurrency, expiry,
   heartbeat, stale ownership, atomic completion, replay convergence, retries,
   permanent blocks, and privileged recovery abort.
3. Add engine tests for drain priority, owner-only preparation, inventory
   cancellation, failure persistence, and successful execution eligibility.
4. Update architecture and operator documentation after behavior is pinned.
5. Run focused package suites, PostgreSQL integration tests, schema checks,
   formatting, all-target Clippy, `just test`, and `just ci` where practical.
