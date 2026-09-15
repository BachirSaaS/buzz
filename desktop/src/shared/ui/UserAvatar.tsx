import * as React from "react";

import { avatarSourceUrlForShape } from "@/features/profile/ui/ProfileAvatarEditor.utils";
import { parseAnimatedAvatarUrl } from "@/shared/lib/animatedAvatar";
import { cn } from "@/shared/lib/cn";
import { getInitials } from "@/shared/lib/initials";
import { rewriteRelayUrl } from "@/shared/lib/mediaUrl";
import { Avatar, AvatarFallback, AvatarImage } from "@/shared/ui/avatar";

type UserAvatarSize = "xs" | "sm" | "md";

const sizeClasses: Record<UserAvatarSize, string> = {
  xs: "h-5 w-5 text-3xs",
  sm: "h-6 w-6 text-2xs",
  md: "h-9 w-9 text-xs",
};

type UserAvatarProps = {
  avatarUrl: string | null;
  displayName: string;
  /**
   * Label used to derive fallback initials; defaults to `displayName`.
   *
   * Callers whose `displayName` is a generated role-prefixed key fallback
   * ("Agent npub1abcd…wxyz") pass the unprefixed compact key here:
   * word-initials would collapse every unnamed identity onto "AN"/"PN",
   * while the compact key keeps distinct key-tail initials. Authored
   * display names keep their name initials.
   */
  initialsLabel?: string;
  size?: UserAvatarSize;
  accent?: boolean;
  shape?: "circle" | "squircle";
  className?: string;
  fallbackDelayMs?: number;
  imageDraggable?: boolean;
  testId?: string;
};

export function UserAvatar({
  avatarUrl,
  displayName,
  initialsLabel,
  size = "md",
  accent = false,
  shape,
  className,
  fallbackDelayMs = 200,
  imageDraggable,
  testId,
}: UserAvatarProps) {
  const initials = getInitials(initialsLabel ?? displayName);
  const resolvedShape = shape ?? "circle";
  const shapedAvatarUrl = avatarSourceUrlForShape(avatarUrl, resolvedShape);
  // Animated avatars show their static poster frame until hovered, then play
  // the animation.
  const animated = parseAnimatedAvatarUrl(shapedAvatarUrl);
  const [isHovered, setIsHovered] = React.useState(false);
  const src = animated
    ? rewriteRelayUrl(isHovered ? animated.animationUrl : animated.posterUrl)
    : shapedAvatarUrl
      ? rewriteRelayUrl(shapedAvatarUrl)
      : null;
  const radiusClass =
    resolvedShape === "squircle" ? "rounded-squircle" : "rounded-full";

  return (
    <Avatar
      // Animated avatars carry their own backdrop disc and transparent
      // surroundings — any container fill would flatten the pop-out.
      className={cn(
        sizeClasses[size],
        radiusClass,
        !animated && "shadow-xs",
        className,
      )}
      data-avatar-shape={resolvedShape}
      data-testid={testId}
      onMouseEnter={animated ? () => setIsHovered(true) : undefined}
      onMouseLeave={animated ? () => setIsHovered(false) : undefined}
    >
      {src ? (
        <AvatarImage
          alt={`${displayName} avatar`}
          className={cn("object-cover", !animated && "bg-secondary")}
          data-testid={testId ? `${testId}-image` : undefined}
          draggable={imageDraggable}
          referrerPolicy="no-referrer"
          src={src}
        />
      ) : null}
      <AvatarFallback
        className={cn(
          "font-semibold",
          accent && "bg-primary text-primary-foreground",
        )}
        data-testid={testId ? `${testId}-fallback` : undefined}
        delayMs={fallbackDelayMs}
      >
        {initials}
      </AvatarFallback>
    </Avatar>
  );
}
