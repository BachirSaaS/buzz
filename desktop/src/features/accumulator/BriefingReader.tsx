import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/shared/ui/button";
import type { UserProfileSummary } from "@/shared/api/types";
import type { ChiefRequest, OpenSource } from "./BriefingSources";
import type { Artifact, Fold, Preflight, RunOutcome } from "./types";

import { BriefingArtifact } from "./BriefingArtifact";

export function BriefingReader({
  fold,
  request,
  scopeKey,
  profiles,
  pubkey,
  onOpen,
  ready,
}: {
  fold: Fold;
  request: ChiefRequest;
  scopeKey: string;
  profiles: Record<string, UserProfileSummary>;
  pubkey: string;
  onOpen: OpenSource;
  ready: boolean;
}) {
  const client = useQueryClient();
  const path = `/folds/${encodeURIComponent(fold.name)}`;
  const selectedVersion = fold.latest_version;
  const recoveryKey = `chief-recovery:${scopeKey}:${fold.name}`;
  const [recovery, setRecovery] = useState<RunOutcome | null>(null);
  const [recoveryError, setRecoveryError] = useState<string | null>(null);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(recoveryKey);
      if (raw) {
        const value = JSON.parse(raw) as RunOutcome;
        if (
          value.status !== "unpublished" ||
          typeof value.model_output !== "string"
        )
          throw new Error("Invalid recovery record");
        setRecovery(value);
      }
    } catch {
      setRecoveryError(
        "A saved recovery result could not be read. The local record has been retained.",
      );
    }
  }, [recoveryKey]);
  const artifact = useQuery({
    queryKey: ["chief", scopeKey, fold.name, selectedVersion],
    queryFn: () => request<Artifact>(`${path}/artifacts/${selectedVersion}`),
    enabled: selectedVersion !== null,
    retry: false,
  });
  const preflight = useQuery({
    queryKey: ["chief", scopeKey, fold.name, "preflight", fold.latest_version],
    queryFn: () =>
      request<Preflight>(`${path}/preflight`, "POST", { include_input: true }),
    retry: false,
    refetchOnWindowFocus: false,
  });
  const run = useMutation({
    mutationFn: () => request<RunOutcome>(`${path}/run`, "POST", {}),
    retry: false,
    onSuccess: async (outcome) => {
      if (outcome.status === "unpublished") {
        setRecovery(outcome);
        try {
          localStorage.setItem(recoveryKey, JSON.stringify(outcome));
        } catch {
          setRecoveryError(
            "This result could not be saved for recovery. Copy it before leaving this page.",
          );
        }
      }
      await client.invalidateQueries({ queryKey: ["chief", scopeKey] });
    },
  });
  const coverage = preflight.data?.coverage;
  const error = run.error ?? preflight.error ?? artifact.error;
  return (
    <div data-testid="chief-briefing" className="space-y-1">
      {artifact.isFetching && <p role="status">Loading saved briefing…</p>}
      {artifact.data && (
        <BriefingArtifact
          key={artifact.data.version}
          artifact={artifact.data}
          title={fold.spec.meta?.title || fold.name}
          request={request}
          scopeKey={scopeKey}
          profiles={profiles}
          pubkey={pubkey}
          onOpen={onOpen}
        />
      )}
      {coverage && !coverage.complete && (
        <p role="status" className="text-sm text-muted-foreground">
          {coverage.processed} messages processed · {coverage.pending} pending
        </p>
      )}
      {preflight.isPending && <p role="status">Preparing free preflight…</p>}
      {preflight.data?.plan === "ready" && (
        <div className="space-y-3 border-t border-border pt-4">
          <p className="text-sm">
            Next pass: {preflight.data.shown} messages · about{" "}
            {preflight.data.estimate?.est_input_tokens.toLocaleString()} input
            tokens.
          </p>
          <p className="text-xs text-muted-foreground">
            Preflight is free. Run uses your signed-in model account. Each pass
            saves a new version; nothing is published to Buzz.
          </p>
          <Button
            disabled={!ready || run.isPending}
            onClick={() => run.mutate()}
          >
            {run.isPending ? "Processing this pass…" : "Run next pass"}
          </Button>
        </div>
      )}
      {preflight.data?.plan === "stalled" && (
        <p role="alert">{preflight.data.reason}</p>
      )}
      {run.data?.status === "stalled" && <p role="alert">{run.data.reason}</p>}
      {recovery?.status === "unpublished" && (
        <div role="alert">
          <p>
            The model returned a result, but it could not be saved:{" "}
            {recovery.reason}
          </p>
          <pre className="max-h-80 overflow-auto whitespace-pre-wrap">
            {recovery.model_output}
          </pre>
          <p>
            {recoveryError ??
              "This result is saved locally for recovery. Copy it before discarding it."}
          </p>
        </div>
      )}
      {recoveryError && !recovery && <p role="alert">{recoveryError}</p>}
      {(error || fold.last_error) && (
        <div role="alert" className="space-y-2 text-sm">
          <p>
            {error instanceof Error
              ? error.message
              : (fold.last_error ?? String(error))}
          </p>
          <Button
            variant="secondary"
            onClick={() =>
              void client.invalidateQueries({ queryKey: ["chief", scopeKey] })
            }
          >
            Refresh briefing
          </Button>
        </div>
      )}
    </div>
  );
}
