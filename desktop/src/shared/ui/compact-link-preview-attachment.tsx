import type { ComponentProps } from "react";
import { LinkPreviewWidget } from "./link-preview-widget";

export function CompactLinkPreviewAttachment(
  props: Omit<
    ComponentProps<typeof LinkPreviewWidget>,
    "compact" | "ImageLightbox"
  >,
) {
  return <LinkPreviewWidget {...props} compact />;
}
