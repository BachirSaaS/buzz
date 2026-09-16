import type { ComponentProps, ComponentType, ReactNode, Ref } from "react";
import { LinkPreviewWidget } from "./link-preview-widget";

export type LinkPreviewImageLightboxProps = {
  /** Optional external trigger, used when the card itself navigates to its link. */
  controllerRef?: Ref<{ open: () => void }>;
  alt: string;
  children: ReactNode;
  className?: string;
  src: string;
};
export type LinkPreviewImageLightboxComponent =
  ComponentType<LinkPreviewImageLightboxProps>;

export function RichLinkPreviewAttachment(
  props: Omit<ComponentProps<typeof LinkPreviewWidget>, "compact"> & {
    ImageLightbox: LinkPreviewImageLightboxComponent;
  },
) {
  return <LinkPreviewWidget {...props} />;
}
