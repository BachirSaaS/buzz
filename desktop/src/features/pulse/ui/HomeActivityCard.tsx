import type { UserProfileSummary } from "@/shared/api/types";
import { HomeEvidenceGrid, HomeEvidencePreview } from "./HomeEvidenceGrid";
import type { BriefingGroup } from "../lib/pulseBriefing";
import type { PulseConversation } from "../lib/unifiedFeed";
import { selectBriefingEvidence } from "../lib/briefingEvidence";
import { HomeFeedCard } from "./HomeFeedCard";
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
    <HomeFeedCard
      data-testid="pulse-briefing-highlight"
      messages={sources.flatMap((source) => source.messages)}
      evidenceIds={evidence.map(({ message }) => message.id)}
      profiles={profiles}
      summary={group.label}
      onOpen={onOpen}
      openLabel={sources.length > 1 ? "Explore threads" : "View conversation"}
      data-conversation-id={sources[0].id}
      aria-label={
        group.generated ? "Activity summary" : "Channel activity overview"
      }
    >
      {evidence.length > 0 && (
        <HomeEvidenceGrid>
          {evidence.map(({ message }) => (
            <div
              key={message.id}
              data-evidence-message-id={message.id}
              className="min-w-0"
            >
              <HomeEvidencePreview>
                <HomeMessageEvidence
                  message={message}
                  profiles={profiles}
                  currentPubkey={currentPubkey}
                />
              </HomeEvidencePreview>
            </div>
          ))}
        </HomeEvidenceGrid>
      )}
    </HomeFeedCard>
  );
}
