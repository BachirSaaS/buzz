{{/*
Hard fail guards. Included from every rendered template so misconfigs
surface at template time regardless of which manifest helm renders first.
*/}}

{{- define "buzz.validate" -}}

{{/* Missing rollout values must remain compatible with --reuse-values. */}}
{{- $rollout := .Values.rollout | default dict -}}
{{- if $rollout.enabled -}}
  {{- if .Values.autoscaling.enabled -}}
    {{- fail "rollout.enabled requires autoscaling.enabled=false; this chart currently supports fixed-replica Rollouts only" -}}
  {{- end -}}
  {{- if or (not (hasKey $rollout "deploymentReplicas")) (eq $rollout.deploymentReplicas nil) (not (hasKey $rollout "replicas")) (eq $rollout.replicas nil) -}}
    {{- fail "rollout.enabled requires explicit rollout.deploymentReplicas and rollout.replicas; start with replicaCount and 0 for an existing Deployment" -}}
  {{- end -}}
  {{- $deployment := int $rollout.deploymentReplicas -}}
  {{- $replicas := int $rollout.replicas -}}
  {{- $target := int .Values.replicaCount -}}
  {{- if or (lt $deployment 0) (lt $replicas 0) (gt $deployment $target) (gt $replicas $target) (lt (add $deployment $replicas) $target) (gt (add $deployment $replicas) (add $target 1)) -}}
    {{- fail "rollout replica counts must each be between 0 and replicaCount, and their sum must be replicaCount or replicaCount + 1" -}}
  {{- end -}}
  {{- if and (not .Values.redis.enabled) (not .Values.externalRedis.url) (not .Values.secrets.existingSecret) -}}
    {{- fail "rollout.enabled requires Redis for overlapping relay pods; configure redis.enabled, externalRedis.url, or secrets.existingSecret with REDIS_URL" -}}
  {{- end -}}
  {{- if not $rollout.weights -}}
    {{- fail "rollout.weights must contain increasing percentages ending at 100" -}}
  {{- end -}}
  {{- if le (int ($rollout.progressDeadlineSeconds | default 900)) (int ($rollout.minReadySeconds | default 60)) -}}
    {{- fail "rollout.progressDeadlineSeconds must exceed rollout.minReadySeconds" -}}
  {{- end -}}
  {{- $previous := 0 -}}
  {{- range $rollout.weights -}}
    {{- $weight := int . -}}
    {{- if or (le $weight $previous) (gt $weight 100) -}}
      {{- fail "rollout.weights must contain increasing percentages ending at 100" -}}
    {{- end -}}
    {{- $previous = $weight -}}
  {{- end -}}
  {{- if ne $previous 100 -}}
    {{- fail "rollout.weights must contain increasing percentages ending at 100" -}}
  {{- end -}}
{{- end -}}

{{/* relayUrl is required */}}
{{- if not .Values.relayUrl -}}
  {{- fail "relayUrl is required: set --set relayUrl=wss://your.domain" -}}
{{- end -}}

{{/* Multiple replicas require Redis, whether fixed or autoscaled. */}}
{{- $minimumReplicas := include "buzz.minimumReplicas" . | int -}}
{{- if gt $minimumReplicas 1 -}}
  {{- if and (not .Values.redis.enabled) (not .Values.externalRedis.url) (not .Values.secrets.existingSecret) -}}
    {{- fail (printf "minimum replica count %d requires Redis for buzz-pubsub. Enable redis.enabled=true, set externalRedis.url, or provide secrets.existingSecret with key REDIS_URL." $minimumReplicas) -}}
  {{- end -}}
{{- end -}}

{{/* Multiple replicas do NOT require ReadWriteMany git storage.

     Git ref/object state is object-store-backed: every read and write hydrates
     an ephemeral bare repo from S3-compatible storage per request, and writer
     serialization is the object-store pointer CAS
     (docs/git-on-object-storage.md, Inv_NoFork). No persistent git state lives
     on the PVC, so replicas do not need a shared ReadWriteMany volume to agree
     on refs. Repo-name uniqueness — the last shared-state need — now lives in
     Postgres (git_repo_names), not on local disk.

     The prior hard-fail requiring persistence.git.accessMode=ReadWriteMany was
     removed here: its stated reason ("git on-disk state must be shared across
     replicas") is no longer true. Redis (validated above) remains the real
     multi-pod requirement for buzz-pubsub. */}}

{{/* Autoscaling bounds must be coherent. */}}
{{- if .Values.autoscaling.enabled -}}
  {{- if lt (.Values.autoscaling.minReplicas | int) 1 -}}
    {{- fail "autoscaling.minReplicas must be at least 1" -}}
  {{- end -}}
  {{- if lt (.Values.autoscaling.maxReplicas | int) (.Values.autoscaling.minReplicas | int) -}}
    {{- fail "autoscaling.maxReplicas must be greater than or equal to autoscaling.minReplicas" -}}
  {{- end -}}
  {{- if and .Values.autoscaling.websocketMetricEnabled (not .Values.autoscaling.websocketMetricName) -}}
    {{- fail "autoscaling.websocketMetricName is required when WebSocket scaling is enabled" -}}
  {{- end -}}
{{- end -}}

{{/* Owner pubkey required when requireRelayMembership */}}
{{- if .Values.relay.requireRelayMembership -}}
  {{- if not .Values.ownerPubkey -}}
    {{- fail "ownerPubkey is required when relay.requireRelayMembership=true. Set ownerPubkey to the 64-char lowercase hex Nostr pubkey of the relay operator, or set relay.requireRelayMembership=false for an open relay." -}}
  {{- end -}}
{{- end -}}

{{/* ownerPubkey format check */}}
{{- if .Values.ownerPubkey -}}
  {{- if not (regexMatch "^[0-9a-f]{64}$" .Values.ownerPubkey) -}}
    {{- fail (printf "ownerPubkey must be 64 lowercase hex characters (got %d chars; must match ^[0-9a-f]{64}$)." (len .Values.ownerPubkey)) -}}
  {{- end -}}
{{- end -}}

{{/* Pairing relay deployment must have an advertised public URL. */}}
{{- if and .Values.pairingRelay.enabled (not .Values.pairingRelay.url) -}}
  {{- fail "pairingRelay.url is required when pairingRelay.enabled=true" -}}
{{- end -}}

{{/* ingress + httproute mutually exclusive */}}
{{- if and .Values.ingress.enabled .Values.httproute.enabled -}}
  {{- fail "ingress.enabled and httproute.enabled cannot both be true — choose one." -}}
{{- end -}}

{{/* Postgres source must exist somewhere */}}
{{- if not (or .Values.postgresql.enabled .Values.externalPostgresql.url .Values.secrets.existingSecret) -}}
  {{- fail "Postgres source missing: enable postgresql.enabled=true, set externalPostgresql.url, or provide secrets.existingSecret with key DATABASE_URL." -}}
{{- end -}}

{{/* S3 / object-storage source must exist somewhere. With the default
     BUZZ_GIT_CONFORMANCE_PROBE behavior, an unreachable bucket is detected
     before the relay opens its listener; operators can explicitly disable that
     startup gate. */}}
{{- if not (or .Values.minio.enabled .Values.s3.endpoint .Values.secrets.existingSecret) -}}
  {{- fail "S3/object-storage source missing: enable minio.enabled=true (quickstart in-cluster), set s3.endpoint + s3.bucket + credentials, or provide secrets.existingSecret with keys BUZZ_S3_ACCESS_KEY + BUZZ_S3_SECRET_KEY. By default the relay runs a startup S3 conformance probe and exits if storage is unreachable; disabling BUZZ_GIT_CONFORMANCE_PROBE also removes that startup storage check." -}}
{{- end -}}

{{- end -}}
