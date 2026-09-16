import { Hash, Layers, LockKeyhole, type LucideIcon } from "lucide-react";
import type { Channel } from "@/shared/api/types";

/** Channel identity at the DM avatar size; omitting a channel renders the aggregate icon. */
export function PulseChannelAvatar({
  channel,
}: {
  channel?: Pick<Channel, "name" | "visibility">;
}) {
  const Icon = !channel
    ? Layers
    : channel.visibility === "private"
      ? LockKeyhole
      : Hash;
  return <PulseSidebarIcon icon={Icon} />;
}

/** Shared circular identity container for conversation navigation and channels. */
export function PulseSidebarIcon({ icon: Icon }: { icon: LucideIcon }) {
  return (
    <span
      aria-hidden
      className="flex size-7 shrink-0 items-center justify-center rounded-full bg-blockui-surface-standard text-foreground"
    >
      <Icon className="size-4" />
    </span>
  );
}
