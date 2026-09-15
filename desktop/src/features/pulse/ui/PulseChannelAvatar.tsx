import { Hash, Layers, LockKeyhole } from "lucide-react";
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
  return (
    <span
      aria-hidden
      className="flex size-7 shrink-0 items-center justify-center rounded-full bg-blockui-surface-standard text-foreground"
    >
      <Icon className="size-4" />
    </span>
  );
}
