import type { ComponentProps } from "react";
import { hasLinkPreviewSuppression } from "@/features/messages/lib/formatTimelineMessages";
import { extractSupportedLinkPreviews } from "@/shared/lib/linkPreview";
import { parseLinkPreviewSnapshots } from "@/shared/lib/linkPreviewSnapshot";
import { useRelayOrigin } from "@/shared/lib/useRelayOrigin";
import { LinkPreviewList } from "@/shared/ui/link-preview-list";
import { LinkPreviewImageLightbox } from "@/shared/ui/markdown";
import { PulseMessagePreview } from "./PulseMessagePreview";

/** Original message content plus URL-derived cards for older links without snapshots. */
export function HomeMessageEvidence(
  props: ComponentProps<typeof PulseMessagePreview>,
) {
  const origin = useRelayOrigin();
  const { message } = props;
  const snapshots = new Set(
    parseLinkPreviewSnapshots(message.tags, message.body, origin).map(
      (preview) => preview.href,
    ),
  );
  // No metadata fetch: derive only repository/provider identity from the original URL.
  const previews = hasLinkPreviewSuppression(message.tags)
    ? []
    : extractSupportedLinkPreviews(message.body, origin)
        .filter(
          (preview) =>
            !snapshots.has(preview.href) && preview.kind.startsWith("github-"),
        )
        .slice(0, 2)
        .map((preview) => ({ ...preview, imageState: "none" as const }));
  return (
    <div className="min-w-0 space-y-4" data-image-gallery-scope="">
      <PulseMessagePreview {...props} />
      <LinkPreviewList
        previews={previews}
        ImageLightbox={LinkPreviewImageLightbox}
      />
    </div>
  );
}
