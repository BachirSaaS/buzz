import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { Button } from "@/shared/ui/button";
import type { UserProfileSummary } from "@/shared/api/types";
import { HomeFeedCard } from "@/features/pulse/ui/HomeFeedCard";
import {
  HomeEvidenceGrid,
  HomeEvidencePreview,
} from "@/features/pulse/ui/HomeEvidenceGrid";
import { HomeMessageEvidence } from "@/features/pulse/ui/HomeMessageEvidence";
import type { ChiefRequest, OpenSource } from "./BriefingSources";
import { sourceMessage } from "./BriefingSources";
import { briefingPresentation } from "./briefingPresentation";
import type { Artifact, SourceEvent } from "./types";

type Props = {
  artifact: Artifact;
  title: string;
  request: ChiefRequest;
  scopeKey: string;
  profiles: Record<string, UserProfileSummary>;
  pubkey: string;
  onOpen: OpenSource;
};

/** Each explicit takeaway becomes a normal Home card with its own cited evidence. */
export function BriefingArtifact(props: Props) {
  const items = briefingPresentation(
    props.artifact.output,
    props.artifact.shown_ids,
  );
  const [limit, setLimit] = useState(12);
  return (
    <>
      {items.slice(0, limit).map((item) => (
        <BriefingTakeaway key={item.key} {...props} item={item} />
      ))}
      {items.length > limit && (
        <Button variant="ghost" onClick={() => setLimit((count) => count + 12)}>
          More takeaways
        </Button>
      )}
    </>
  );
}

function BriefingTakeaway({
  item,
  title,
  request,
  scopeKey,
  profiles,
  pubkey,
  onOpen,
}: Props & {
  item: ReturnType<typeof briefingPresentation>[number];
}) {
  const [selected, setSelected] = useState(0);
  const id = item.sources[selected];
  const event = useQuery({
    queryKey: ["chief", scopeKey, "event", id],
    queryFn: () => request<SourceEvent>(`/events/${id}`),
    enabled: Boolean(id),
    retry: false,
  });
  const message = event.data ? sourceMessage(event.data, profiles) : null;
  return (
    <HomeFeedCard
      data-testid="chief-takeaway"
      aria-label="Saved activity summary"
      messages={message ? [message] : []}
      evidenceIds={id ? [id] : []}
      profiles={profiles}
      summary={item.text || "Source message"}
      context={title}
      onOpen={
        event.data?.channel
          ? () => {
              if (event.data) onOpen(event.data);
            }
          : undefined
      }
    >
      {message && (
        <HomeEvidenceGrid>
          <div className="min-w-0" data-evidence-message-id={message.id}>
            <HomeEvidencePreview>
              <HomeMessageEvidence
                message={message}
                profiles={profiles}
                currentPubkey={pubkey}
              />
            </HomeEvidencePreview>
          </div>
        </HomeEvidenceGrid>
      )}
      {id && event.isPending && (
        <p role="status" className="text-sm text-muted-foreground">
          Loading source message…
        </p>
      )}
      {event.isError && (
        <div role="alert" className="text-sm">
          <p>This source message couldn’t be loaded.</p>
          <Button variant="ghost" onClick={() => void event.refetch()}>
            Retry source
          </Button>
        </div>
      )}
      {(!id || item.unavailable) && (
        <p className="text-xs text-muted-foreground">
          {item.unavailable
            ? "A cited message is unavailable in this version."
            : "No source message was cited for this takeaway."}
        </p>
      )}
      {item.sources.length > 1 && (
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            aria-label="Previous message"
            disabled={selected === 0}
            onClick={() => setSelected((index) => index - 1)}
          >
            <ArrowLeft aria-hidden className="size-4" />
          </Button>
          <span className="text-xs text-muted-foreground" aria-live="polite">
            Source {selected + 1} of {item.sources.length}
          </span>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Next message"
            disabled={selected === item.sources.length - 1}
            onClick={() => setSelected((index) => index + 1)}
          >
            <ArrowRight aria-hidden className="size-4" />
          </Button>
        </div>
      )}
    </HomeFeedCard>
  );
}
