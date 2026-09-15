import type { ComponentProps } from "react";
import {
  Avatar,
  AvatarImage as BlockAvatarImage,
  AvatarFallback as BlockAvatarFallback,
} from "@/shared/blockui/components/avatar";
import { cn } from "@/shared/lib/cn";
export { Avatar };
export function AvatarImage({
  className,
  ...props
}: ComponentProps<typeof BlockAvatarImage>) {
  return (
    <BlockAvatarImage
      decoding="async"
      loading="lazy"
      className={cn("avatar-sdr-clamp", className)}
      {...props}
    />
  );
}
export function AvatarFallback({
  delayMs,
  style,
  ...props
}: ComponentProps<typeof BlockAvatarFallback> & { delayMs?: number }) {
  return (
    <BlockAvatarFallback
      delay={delayMs}
      style={{ fontSize: "inherit", ...style }}
      {...props}
    />
  );
}
