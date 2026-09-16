import type { UserProfileSummary } from "@/shared/api/types";
import {
  AvatarGroup,
  AvatarGroupCount,
} from "@/shared/blockui/components/avatar";
import { UserAvatar } from "@/shared/ui/UserAvatar";
import { UserProfilePopover } from "@/features/profile/ui/UserProfilePopover";
import { normalizePubkey } from "@/shared/lib/pubkey";
import type { PulseConversation } from "../lib/unifiedFeed";

/** Prominent source identities, using Block UI's overlapping group and count composition. */
export function HomeParticipants({
  sources,
  evidenceIds,
  profiles,
}: {
  sources: PulseConversation[];
  evidenceIds: string[];
  profiles: Record<string, UserProfileSummary>;
}) {
  const messages = sources
    .flatMap((source) => source.messages)
    .filter((message) => !message.pending && message.pubkey);
  const ordered = [...messages].sort(
    (a, b) =>
      Number(evidenceIds.includes(b.id)) - Number(evidenceIds.includes(a.id)),
  );
  const participants = [
    ...new Map(
      ordered.map((message) => {
        const pubkey = normalizePubkey(message.pubkey ?? "");
        const profile = profiles[pubkey];
        return [
          pubkey,
          {
            pubkey,
            name: profile?.displayName || message.author,
            avatar: profile?.avatarUrl || message.avatarUrl || null,
            isAgent: profile?.isAgent ?? message.isAgent,
          },
        ];
      }),
    ).values(),
  ];
  if (!participants.length) return null;
  const visible = participants.slice(0, 3);
  const remaining = participants.slice(3);
  return (
    <AvatarGroup
      className="isolate items-center -space-x-4"
      role="group"
      aria-label="People in this conversation"
      data-testid="home-participants"
    >
      {visible.map((person) => (
        <UserProfilePopover
          key={person.pubkey}
          pubkey={person.pubkey}
          role={person.isAgent ? "bot" : undefined}
          triggerAriaLabel={`Open profile for ${person.name}`}
          triggerClassName={`relative bg-card ring-4 ring-card hover:z-10 focus-visible:z-10 focus-visible:outline-hidden focus-visible:ring-ring ${person.isAgent ? "rounded-squircle" : "rounded-full"}`}
        >
          <span aria-hidden="true">
            <UserAvatar
              avatarUrl={person.avatar}
              displayName={person.name}
              shape={person.isAgent ? "squircle" : "circle"}
              className="!h-16 !w-16 text-base"
              fallbackDelayMs={0}
              testId="home-participant-avatar"
            />
          </span>
        </UserProfilePopover>
      ))}
      {remaining.length > 0 && (
        <AvatarGroupCount
          className="size-16 text-base font-medium ring-4 ring-card"
          role="img"
          aria-label={`${remaining.length} more participants: ${remaining.map((person) => person.name).join(", ")}`}
          title={remaining.map((person) => person.name).join(", ")}
        >
          <span aria-hidden="true">+{remaining.length}</span>
        </AvatarGroupCount>
      )}
    </AvatarGroup>
  );
}
