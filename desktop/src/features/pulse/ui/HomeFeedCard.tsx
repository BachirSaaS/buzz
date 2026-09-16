import type { ComponentProps, ReactNode } from "react";
import { AlarmClock, ArrowUpRight, Reply } from "lucide-react";
import type { TimelineMessage } from "@/features/messages/types";
import type { UserProfileSummary } from "@/shared/api/types";
import { ContentWidget } from "@/shared/ui/content-widget";
import { Button } from "@/shared/ui/button";
import { HomeParticipants } from "./HomeParticipants";

/** The shared presentation and actions for every recap in the Home feed. */
export function HomeFeedCard({
  messages,
  evidenceIds,
  profiles,
  summary,
  context,
  children,
  onOpen,
  openLabel = "View conversation",
  ...props
}: {
  messages: TimelineMessage[];
  evidenceIds: string[];
  profiles: Record<string, UserProfileSummary>;
  summary: string;
  context?: string;
  children?: ReactNode;
  onOpen?: () => void;
  openLabel?: string;
} & Omit<ComponentProps<"div">, "children">) {
  return (
    <ContentWidget {...props} className="home-activity-card gap-6">
      <HomeParticipants
        messages={messages}
        evidenceIds={evidenceIds}
        profiles={profiles}
      />
      {context && <p className="text-xs text-muted-foreground">{context}</p>}
      <h2
        data-testid="home-activity-summary"
        className="text-base font-medium leading-snug"
      >
        {summary}
      </h2>
      {children}
      <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-4">
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="secondary"
            size="icon"
            aria-label="Snooze"
            aria-disabled="true"
            title="Snooze (coming soon)"
          >
            <AlarmClock aria-hidden className="size-4" />
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="icon"
            aria-label="Reply directly"
            aria-disabled="true"
            title="Reply directly (coming soon)"
          >
            <Reply aria-hidden className="size-4" />
          </Button>
        </div>
        <Button
          variant="secondary"
          size="sm"
          aria-label="Open conversation"
          disabled={!onOpen}
          onClick={onOpen}
          className="ml-auto h-auto max-w-full gap-2 whitespace-normal py-2 text-left"
        >
          {openLabel}
          <ArrowUpRight aria-hidden className="size-4 shrink-0" />
        </Button>
      </footer>
    </ContentWidget>
  );
}
