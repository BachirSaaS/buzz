# Generic Operator Cron Foundation

## Context

Community deletion execution is an operator concern, not a relay HTTP concern.
The existing one-shot `buzz-admin deletions drain` command already owns bounded
Postgres and Redis clients, S3 access, and the durable deletion-store
lease/checkpoint protocol. Kubernetes only needs to schedule that typed command;
the database remains the handoff and retry authority.

## Tasks

1. Add Helm unit contracts for a disabled-by-default deletion-drain CronJob and
   run them red before adding the template or values.
2. Pin the rendered workload contract: explicit `buzz-admin deletions drain`
   invocation, `Forbid` concurrency, zero Job retries, `Never` restart, bounded
   deadline/history, termination grace, and independently configurable service
   account, labels, annotations, and resources.
3. Pin the least-privilege environment contract to only `DATABASE_URL`,
   `REDIS_URL`, and the S3 endpoint/bucket/region/addressing/credential values;
   explicitly reject relay signing and git-hook secrets.
4. Add the smallest reusable typed operator-CronJob rendering helper needed by
   deletion drain without creating a command/env registry or changing the
   storage-accounting CronJob output.
5. Add typed `deletionDrain` values and JSON-schema validation, keeping the
   feature disabled by default.
6. Document enablement, operational semantics, required S3 permissions,
   database lease authority, failure inspection, and the absence of a chart-
   native alert integration.
7. Run focused red/green Helm tests, the full chart lint/unit/render suite,
   affected `buzz-admin`/deletion package tests, repository gates, and a final
   secret-scope/simplification review.
