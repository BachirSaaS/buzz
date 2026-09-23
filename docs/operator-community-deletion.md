# Community Deletion Operator Job

Buzz executes whole-community deletion through the typed, one-shot
`/usr/local/bin/buzz-admin deletions drain` command. The Helm chart can schedule
that command as a Kubernetes CronJob; it does not call relay HTTP and it does
not add another queue or retry service.

Postgres remains the handoff and source of truth. A run gives already-approved
work priority. When none is ready, it may claim an authenticated owner-origin
request at `submitted`, build the existing bounded inventory, and atomically
freeze that inventory with a digest-bound `owner_automatic` approval. The same
lease then enters the unchanged executor and resumes from durable checkpoints.
Operator-origin requests never auto-progress. `concurrencyPolicy: Forbid` prevents scheduled
pod overlap, `backoffLimit: 0` prevents Kubernetes Job retries, and the deletion
store remains authoritative when a pod exits, reaches its deadline, or is
replaced.

## Enablement

The CronJob is disabled by default. Production deployments should use an
existing Secret and a dedicated service account when their cluster policy
supports one:

```yaml
secrets:
  existingSecret: buzz-operator-secrets

operatorJobs:
  deletionDrain:
    enabled: true
    schedule: "*/5 * * * *"
    activeDeadlineSeconds: 3600
    terminationGracePeriodSeconds: 30
    serviceAccountName: buzz-deletion-drain
    podLabels:
      tags.datadoghq.com/service: buzz-deletion-drain
    podAnnotations:
      sidecar.istio.io/inject: "false"
    resources:
      requests:
        cpu: 100m
        memory: 256Mi
      limits:
        cpu: "1"
        memory: 1Gi
```

Set `s3.endpoint`, `s3.bucket`, `s3.region`, and `s3.addressingStyle` in chart
values. The selected Secret must contain `DATABASE_URL` and `REDIS_URL`; it may
contain `BUZZ_S3_ACCESS_KEY` and `BUZZ_S3_SECRET_KEY` when the object store uses
static credentials. The pod receives only those connection values and the four
non-secret S3 settings. It does not receive `BUZZ_RELAY_PRIVATE_KEY`,
`BUZZ_GIT_HOOK_HMAC_SECRET`, `RELAY_URL`, or the full Secret through `envFrom`.
The pod also disables service-account token automounting and Kubernetes service
link environment injection because the executor does not call the Kubernetes
API or discover cluster Services.

The S3 principal needs the relay's normal object permissions plus bucket-level
`s3:ListBucketVersions` and object-level `s3:DeleteObjectVersion` for every
tenant-owned prefix. This also applies to never-versioned buckets because S3
reports their objects with the `null` version id.

## Runbook

1. Confirm database migrations are current. For operator-origin requests,
   confirm explicit inventory and operator approval with
   `buzz-admin deletions inspect <request-id>`. For owner-origin requests,
   expect the drain to record `approval_origin: owner_automatic`; `approved_by`
   is the immutable mediating operator, not the owner.
2. Confirm the selected Secret contains the required keys and the S3 principal
   has version-list and exact-version delete permissions.
3. Enable the CronJob and inspect its rendered command and environment before
   rollout.
4. Start one staffed manual run with
   `kubectl create job --from=cronjob/<release>-buzz-deletion-drain <job-name>`.
5. Follow pod logs and re-run `buzz-admin deletions inspect <request-id>` to
   verify lease, checkpoint, retry, blocked, and terminal state.
6. If a run fails or times out, fix the recorded dependency or permission
   failure. Do not add Kubernetes retries: the next scheduled drain consults the
   durable retry/checkpoint state and resumes only when the store allows it.
7. Use `buzz-admin deletions abort` as privileged recovery while a request is
   still at `submitted` or `inventoried` when safe preparation cannot continue.
   Abort preserves the archived community and immutable request evidence. An
   operator may also `unblock` a remediated preparation failure.

Owner self-serve relay admission still records only a `submitted` row and does
no inventory, approval, S3 work, or execution synchronously. A successful drain
has no human approval step or cooling-off period: authenticated owner intent is
prepared automatically under privileged policy and becomes immediately
eligible for execution. Transient preparation failures use the existing retry
schedule; permanent or exhausted failures block durably. Owner-facing
admission has no cancellation endpoint.

The chart has no existing PrometheusRule or provider-neutral CronJob alert
integration. Operators must alert on failed/missed Jobs and long-running active
Jobs in their deployment platform. Adding a chart-native alert abstraction is
debt, not part of this job contract.
