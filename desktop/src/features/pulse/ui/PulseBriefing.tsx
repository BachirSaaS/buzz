import { Action } from "@/shared/ui/action";
import type { UserProfileSummary } from "@/shared/api/types";
import { Skeleton } from "@/shared/ui/skeleton";
import type { BriefingGroup, BriefingKind } from "../lib/pulseBriefing";
import type { PulseConversation } from "../lib/unifiedFeed";
import { HomeActivityCard } from "./HomeActivityCard";

export function PulseBriefing({
  groups,
  conversations,
  profiles,
  currentPubkey,
  onSelect,
  loading,
  hasError,
  onRetry,
  summaryError = false,
  summarizing = false,
  onRetrySummary,
}: {
  groups: BriefingGroup[];
  conversations: Map<string, PulseConversation>;
  profiles: Record<string, UserProfileSummary>;
  currentPubkey?: string;
  onSelect: (kind: BriefingKind) => void;
  loading: boolean;
  hasError: boolean;
  onRetry: () => void;
  summaryError?: boolean;
  summarizing?: boolean;
  onRetrySummary?: () => void;
}) {
  return (
    <section aria-label="Your catch-up" data-testid="pulse-briefing">
      <h1 className="sr-only">Home</h1>
      <p className="sr-only">Your catch-up · Past 48 hours</p>
      {summarizing && !summaryError && (
        <p role="status" className="px-6 py-4 text-sm text-muted-foreground">
          Summarizing recent threads…
        </p>
      )}
      {summaryError && !hasError && (
        <div
          role="status"
          className="flex flex-wrap items-center gap-2 border-b border-border/50 px-6 py-4 text-sm text-muted-foreground"
        >
          <p>Showing channel overviews. Generated summaries are unavailable.</p>
          <Action
            type="button"
            onClick={onRetrySummary}
            className="rounded-sm underline underline-offset-4 focus-visible:ring-2 focus-visible:ring-ring"
          >
            Retry highlights
          </Action>
        </div>
      )}
      {loading ? (
        <div
          role="status"
          aria-label="Finding what needs your attention"
          className="space-y-6 px-6 py-6"
        >
          <Skeleton className="size-12 rounded-full" />
          <Skeleton className="h-5 w-4/5" />
          <Skeleton className="h-5 w-3/5" />
          <span className="sr-only">Finding what needs your attention…</span>
        </div>
      ) : groups.length ? (
        <div className="mx-auto grid w-full max-w-[640px] gap-1">
          {groups.map((group) => (
            <HomeActivityCard
              key={group.kind}
              group={group}
              conversations={conversations}
              profiles={profiles}
              currentPubkey={currentPubkey}
              onOpen={() => onSelect(group.kind)}
            />
          ))}
        </div>
      ) : !hasError ? (
        <p className="px-6 py-10 text-sm text-muted-foreground">
          No recent conversations to recap yet.
        </p>
      ) : null}
      {hasError && !loading && (
        <div role="alert" className="px-6 py-6 text-sm text-muted-foreground">
          <p>Your catch-up is incomplete. Some activity couldn’t be loaded.</p>
          <Action
            type="button"
            onClick={onRetry}
            className="mt-3 rounded-sm underline underline-offset-4 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
          >
            Try again
          </Action>
        </div>
      )}
    </section>
  );
}
