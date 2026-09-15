import type { ComponentProps, ComponentType, ReactNode } from "react";
import { LinkPreviewWidget } from "./link-preview-widget";

export type LinkPreviewImageLightboxProps = {
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
