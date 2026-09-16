import { AlarmClock, ArrowUpRight, Reply } from "lucide-react";
import type { UserProfileSummary } from "@/shared/api/types";
import { LinkPreviewStyleContext } from "@/shared/lib/linkPreviewStylePreference";
import { ContentWidget } from "@/shared/ui/content-widget";
import { Button } from "@/shared/ui/button";
import type { BriefingGroup } from "../lib/pulseBriefing";
import type { PulseConversation } from "../lib/unifiedFeed";
import { selectBriefingEvidence } from "../lib/briefingEvidence";
import { HomeParticipants } from "./HomeParticipants";
import { HomeMessageEvidence } from "./HomeMessageEvidence";

/** A topic recap and original evidence, routing back to the conversations it summarizes. */
export function HomeActivityCard({
  group,
  conversations,
  profiles,
  currentPubkey,
  onOpen,
}: {
  group: BriefingGroup;
  conversations: Map<string, PulseConversation>;
  profiles: Record<string, UserProfileSummary>;
  currentPubkey?: string;
  onOpen: () => void;
}) {
  const evidence = selectBriefingEvidence(group, conversations);
  const sources = [...group.ids].flatMap((id) => conversations.get(id) ?? []);
  if (!sources.length) return null;
  return (
    <ContentWidget
      data-testid="pulse-briefing-highlight"
      className="home-activity-card gap-6"
      data-conversation-id={sources[0].id}
      aria-label={
        group.generated ? "Activity summary" : "Channel activity overview"
      }
    >
      <HomeParticipants
        sources={sources}
        evidenceIds={evidence.map(({ message }) => message.id)}
        profiles={profiles}
      />
      <h2
        data-testid="home-activity-summary"
        className="text-base font-medium leading-snug"
      >
        {group.label}
      </h2>
      <LinkPreviewStyleContext.Provider value="rich">
        {evidence.length > 0 && (
          <div
            className="home-activity-evidence grid max-h-[240px] min-w-0 grid-cols-1 items-start gap-4 overflow-hidden sm:grid-cols-2"
            data-testid="home-activity-evidence"
          >
            {evidence.map(({ message }) => (
              <div
                key={message.id}
                data-evidence-message-id={message.id}
                className="min-w-0"
              >
                <div data-testid="home-context-preview" style={{ zoom: 0.5 }}>
                  <HomeMessageEvidence
                    message={message}
                    profiles={profiles}
                    currentPubkey={currentPubkey}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </LinkPreviewStyleContext.Provider>
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
          onClick={onOpen}
          className="ml-auto h-auto max-w-full gap-2 whitespace-normal py-2 text-left"
        >
          {sources.length > 1 ? "Explore threads" : "View conversation"}
          <ArrowUpRight aria-hidden className="size-4 shrink-0" />
        </Button>
      </footer>
    </ContentWidget>
  );
}
