# Optional Argo Rollouts

The chart uses a Kubernetes Deployment by default. Setting `rollout.enabled: true`
adds an Argo `Rollout` in the same namespace. Install the Argo Rollouts controller
and its CRDs separately before enabling it. This configuration targets the
`argoproj.io/v1alpha1` API used by Argo Rollouts v1.8.3.

The Deployment still contains the image, environment variables, probes, volumes,
and other pod settings. The Rollout reads those settings through `workloadRef`
and creates **new pods of its own**. It does not adopt the Deployment's pods.
Both sets use the existing Service and PodDisruptionBudget selectors.

This first version supports fixed replica counts and manual promotion. It does
not add health analyses, automatic abort decisions, traffic routing, or HPA
support. `autoscaling.enabled: true` is rejected while Rollouts are enabled.
Existing installations with Rollouts disabled retain their Deployment/HPA path.

## First handover: two replicas

Keep the relay image, secrets, and pod settings unchanged throughout handover.
Use an immutable image digest. Confirm that both existing pods are healthy and
that the cluster has room for one extra pod. Redis must be configured for the
overlapping pods; all pods must use the same external database, Redis, and storage.

Start with this addition to your existing production values:

```yaml
replicaCount: 2
autoscaling:
  enabled: false
rollout:
  enabled: true
  deploymentReplicas: 2
  replicas: 0
  minReadySeconds: 60
  progressDeadlineSeconds: 900
  weights: [50, 100]
```

The two replica fields are intentionally required. Enabling the feature alone
fails rendering instead of silently scaling down the Deployment. `replicaCount`
remains the desired fleet size; the two explicit counts divide that fleet
between controllers during the handover.

Apply **one row at a time** through your normal Helm or GitOps process:

| Stage | `rollout.deploymentReplicas` | `rollout.replicas` | Action |
|---|---:|---:|---|
| Prepare | 2 | 0 | Create the Rollout with no requested pods. |
| Add first pod | 2 | 1 | Wait for the new Rollout pod to be healthy. |
| Drain first old pod | 1 | 1 | Wait for client reconnections and recovery. |
| Add second pod | 1 | 2 | Wait for the second Rollout pod to be healthy. |
| Finish | 0 | 2 | Drain the last Deployment pod and check recovery. |

Before every drain, verify the replacement has been Ready for at least 60 seconds,
is serving through the Service, and the fleet has recovered: connections,
authenticated sessions, subscriptions, error rates, and database load. Before
each next row, wait for the previous change to finish, including pod termination.
If recovery is incomplete, stop and investigate. Desired counts alone do not prove
healthy capacity. The chart checks only that the desired counts total two or
three and that neither controller requests more than two.

Argo skips canary steps when creating the first revision. **The pauses do not
protect this handover.** The explicit replica changes and checks above do.
`workloadRef.scaleDown: never` ensures Argo does not also scale the Deployment;
your values remain its replica source of truth.

Keep the zero-replica Deployment after handover. Argo still needs its pod
configuration. Argo CD continues applying both the Deployment and the Rollout.
There is no switch that tells Argo CD to stop managing the Deployment.

## Later image updates

Leave the counts at Deployment `0`, Rollout `2`, and change the usual `image.tag`
or `image.digest`. Argo observes the changed Deployment template and manages the
new revision. With `[50, 100]`, the generated steps are:

```yaml
- pause: {}
- setWeight: 50
- pause: {}
- setWeight: 100
- pause: {}
```

Each pause requires an operator to inspect health and promote one step using the
Argo Rollouts UI or `kubectl argo rollouts promote <release-name>`. Do not use
`--full` to bypass the checks. The controller allows one surge pod and requests
zero unavailable pods; this does not guarantee every client has reconnected.
For larger fleets, choose smaller weights before enabling the feature.

The weights approximate the share of Rollout pods running the new revision.
They do not split WebSocket traffic by percentage or move existing connections.
Pauses also do not stop ordinary scaling, pod replacement after failures, or a
direct change to the replica counts.

## Returning to a Deployment

Do not disable Rollouts while they still own serving pods: removing the Rollout
can delete its pods before the Deployment has replaced them. Freeze image and
pod settings, then reverse the table above. Add and verify one Deployment pod
before draining a Rollout pod. Once the Deployment has two healthy pods and the
Rollout has zero remaining pods, set `rollout.enabled: false` and remove the
unused rollout overrides. Leave `replicaCount: 2`.

## What this does not prove

This chart is a prerequisite for a staged migration, not an automatic recovery
system. Enabling it with nonzero replicas affects real pods and traffic. It is
not a report-only or shadow mode. Observation-only health analyses and enforced
recovery checks require a separate change and validation before activation.

See the upstream [migration guide](https://argo-rollouts.readthedocs.io/en/stable/migrating/)
and [canary behavior](https://argo-rollouts.readthedocs.io/en/stable/features/canary/).
