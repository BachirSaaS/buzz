import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/shared/ui/button";
import { useContentWidth } from "@/shared/lib/contentWidthPreference";
import { cn } from "@/shared/lib/cn";
import type { UserProfileSummary } from "@/shared/api/types";
import { chiefApi } from "./api";
import { BriefingReader } from "./BriefingReader";
import { NewBriefing } from "./NewBriefing";
import type { OpenSource } from "./BriefingSources";
import type { ChiefScope, ChiefStatus, Fold } from "./types";

export function SavedBriefings({
  scope,
  profiles,
  onOpen,
}: {
  scope: ChiefScope;
  profiles: Record<string, UserProfileSummary>;
  onOpen: OpenSource;
}) {
  const scopeKey = `${scope.relay}:${scope.pubkey}`;
  const request = useMemo(
    () => chiefApi({ relay: scope.relay, pubkey: scope.pubkey }),
    [scope.relay, scope.pubkey],
  );
  const client = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [page, setPage] = useState(0);
  const [createdName, setCreatedName] = useState<string | null>(null);
  const fullWidth = useContentWidth() !== "standard";
  const status = useQuery({
    queryKey: ["chief", scopeKey, "status"],
    queryFn: () => request<ChiefStatus>("/status"),
    retry: false,
    refetchInterval: (q) => (q.state.error ? false : 10_000),
  });
  const folds = useQuery({
    queryKey: ["chief", scopeKey, "folds"],
    queryFn: () => request<{ folds: Fold[] }>("/folds"),
    enabled: status.isSuccess && !status.isError,
    retry: false,
    refetchInterval: (q) => (q.state.error ? false : 10_000),
  });
  const items = [...(folds.data?.folds ?? [])].sort(
    (a, b) => Number(b.name === createdName) - Number(a.name === createdName),
  );
  const currentPage = Math.min(
    page,
    Math.max(0, Math.ceil(items.length / 5) - 1),
  );
  if (status.isPending)
    return (
      <p role="status" className="p-6 text-sm text-muted-foreground">
        Connecting to your local briefings…
      </p>
    );
  if (status.isError || folds.isError)
    return (
      <div role="alert" className="space-y-3 p-6 text-sm">
        <p>{String((status.error ?? folds.error)?.message)}</p>
        <p className="text-muted-foreground">
          Start your local Accumulator, then reconnect.
        </p>
        <Button
          variant="secondary"
          onClick={() =>
            void client.invalidateQueries({ queryKey: ["chief", scopeKey] })
          }
        >
          Reconnect
        </Button>
      </div>
    );
  const ready =
    status.data.backfill_complete && status.data.connection === "connected";
  return (
    <section
      aria-label="Private briefings"
      className={cn("mx-auto w-full space-y-1", !fullWidth && "max-w-[640px]")}
    >
      <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-4">
        <div>
          <p className="text-sm font-medium">Your Home</p>
          <p className="text-xs text-muted-foreground">
            Recent activity and the longer view
          </p>
        </div>
        <Button size="sm" disabled={!ready} onClick={() => setCreating(true)}>
          New briefing
        </Button>
      </div>
      {folds.isPending && (
        <p role="status" className="px-6 text-sm">
          Loading briefings…
        </p>
      )}
      {items.slice(currentPage * 5, currentPage * 5 + 5).map((fold) => (
        <BriefingReader
          key={fold.name}
          fold={fold}
          request={request}
          scopeKey={scopeKey}
          profiles={profiles}
          pubkey={scope.pubkey}
          onOpen={onOpen}
          ready={ready}
        />
      ))}
      {items.length > 5 && (
        <div className="flex items-center gap-2 px-6 py-3">
          <Button
            variant="ghost"
            disabled={currentPage === 0}
            onClick={() => setPage(currentPage - 1)}
          >
            Previous briefings
          </Button>
          <span className="text-xs">
            {currentPage + 1} / {Math.ceil(items.length / 5)}
          </span>
          <Button
            variant="ghost"
            disabled={(currentPage + 1) * 5 >= items.length}
            onClick={() => setPage(currentPage + 1)}
          >
            More briefings
          </Button>
        </div>
      )}
      {creating && (
        <NewBriefing
          request={request}
          scopeKey={scopeKey}
          onClose={() => setCreating(false)}
          onCreated={(name) => {
            setCreatedName(name);
            setCreating(false);
            setPage(0);
            void client.invalidateQueries({ queryKey: ["chief", scopeKey] });
          }}
        />
      )}
    </section>
  );
}
