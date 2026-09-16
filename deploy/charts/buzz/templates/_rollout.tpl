{{/* Missing rollout values must remain compatible with --reuse-values. */}}
{{- define "buzz.validateRollout" -}}
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
{{- end -}}
