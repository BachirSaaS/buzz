import { memo, useMemo, useRef, useState } from "react";
import { MessageCirclePlus, Pin, PinOff, X } from "lucide-react";
import { useChannelsQuery } from "@/features/channels/hooks";
import { buildDirectMessageIntro } from "@/features/channels/lib/dmParticipantDisplay";
import { useUsersBatchQuery } from "@/features/profile/hooks";
import { useIdentityQuery } from "@/shared/api/hooks";
import { useRelayOrigin } from "@/shared/lib/useRelayOrigin";
import { Action } from "@/shared/ui/action";
import { Input } from "@/shared/ui/input";
import { UserAvatar } from "@/shared/ui/UserAvatar";
import { Popover, PopoverContent, PopoverTrigger } from "@/shared/ui/popover";
import {
  MAX_PINNED_DMS,
  usePulsePreferences,
} from "../lib/usePulsePreferences";
import { DockTooltip } from "./DockTooltip";
import type { PulseNavigationLayout } from "../lib/navigationLayout";
import { PulseChannelDetail } from "./PulseChannelDetail";
import { usePulseUnreadChannels } from "./PulseUnreadDot";

/** Pinned DMs are lightweight dropdown conversations, outside the canvas window model. */
export const PulseQuickAccess = memo(function PulseQuickAccess({
  layout = "dock",
}: {
  layout?: PulseNavigationLayout;
}) {
  const identity = useIdentityQuery();
  const pubkey = identity.data?.pubkey;
  const relay = useRelayOrigin();
  const preferences = usePulsePreferences(
    relay && pubkey ? `${relay}:${pubkey}` : null,
  );
  const channels = useChannelsQuery();
  const available = useMemo(
    () =>
      (channels.data ?? [])
        .filter((channel) => channel.isMember && !channel.archivedAt)
        .sort((a, b) =>
          (b.lastMessageAt ?? "").localeCompare(a.lastMessageAt ?? ""),
        ),
    [channels.data],
  );
  const profileKeys = useMemo(
    () => [
      ...new Set(
        available
          .filter((channel) => channel.channelType === "dm")
          .flatMap((channel) => channel.participantPubkeys),
      ),
    ],
    [available],
  );
  const profiles = useUsersBatchQuery(profileKeys, {
    enabled: profileKeys.length > 0,
  });
  const destinations = available.map((channel) => {
    const intro = buildDirectMessageIntro({
      channel,
      currentPubkey: pubkey,
      profiles: profiles.data?.profiles,
    });
    return {
      channel,
      name: intro?.displayName ?? channel.name,
      person: intro?.participants[0],
    };
  });
  const [open, setOpen] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [method, setMethod] = useState("keyboard");
  const pinTrigger = useRef<HTMLButtonElement>(null);
  const unread = usePulseUnreadChannels();
  const pinned = preferences.values.pinnedDms;
  const candidates = destinations.filter(
    ({ channel, name }) =>
      channel.channelType === "dm" &&
      !pinned.includes(channel.id) &&
      `${name} ${channel.name} ${channel.participants.join(" ")}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  const changeOpen = (id: string, next: boolean) => {
    setOpen((current) => (next ? id : current === id ? null : current));
    if (id === "pin" && next) setSearch("");
  };
  const pin = (id: string) => {
    if (
      preferences.update((current) => ({
        ...current,
        pinnedDms: [...new Set([...current.pinnedDms, id])].slice(
          0,
          MAX_PINNED_DMS,
        ),
      }))
    )
      setOpen(id);
  };
  const unpin = (id: string) => {
    if (
      !preferences.update((current) => ({
        ...current,
        pinnedDms: current.pinnedDms.filter((value) => value !== id),
      }))
    )
      return;
    setOpen(null);
    requestAnimationFrame(() => pinTrigger.current?.focus());
  };
  return (
    <nav
      className={`flex shrink-0 items-center gap-2 ${layout === "dock" ? "flex-col" : ""}`}
      aria-label="Pinned chats"
      onPointerDownCapture={() => setMethod("pointer")}
      onKeyDownCapture={() => setMethod("keyboard")}
    >
      {pinned.map((id) => {
        const destination = destinations.find(
          (item) => item.channel.id === id && item.channel.channelType === "dm",
        );
        const name = destination?.name ?? "Unavailable DM";
        return (
          <Popover
            key={id}
            open={open === id}
            onOpenChange={(next) => changeOpen(id, next)}
          >
            <DockTooltip
              label={name}
              side={layout === "dock" ? "right" : "bottom"}
            >
              <PopoverTrigger asChild>
                <Action
                  aria-label={`Open pinned chat with ${name}${unread(id) ? ", unread" : ""}`}
                  className={`${layout === "dock" ? "pulse-dock-icon" : "pulse-top-icon"} pulse-dock-person relative`}
                >
                  <span aria-hidden className="size-full">
                    <UserAvatar
                      avatarUrl={destination?.person?.avatarUrl ?? null}
                      displayName={name}
                      shape={
                        destination?.person?.isAgent ? "squircle" : "circle"
                      }
                      size="md"
                      className="size-full text-sm shadow-none"
                    />
                  </span>
                  {unread(id) && (
                    <span
                      aria-hidden
                      className="absolute right-0 top-0 size-2 rounded-full bg-primary ring-2 ring-background"
                    />
                  )}
                </Action>
              </PopoverTrigger>
            </DockTooltip>
            <PopoverContent
              side={layout === "dock" ? "right" : "bottom"}
              align={layout === "dock" ? "start" : "end"}
              sideOffset={10}
              collisionPadding={16}
              aria-label={`Chat with ${name}`}
              data-open-method={method}
              className="pulse-quick-popover pulse-pinned-chat flex w-[380px] flex-col overflow-hidden p-0"
              onCloseAutoFocus={(event) => {
                if (!pinned.includes(id)) event.preventDefault();
              }}
            >
              <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-3">
                <span className="min-w-0 flex-1 truncate text-sm font-medium">
                  {name}
                </span>
                <Action
                  aria-label={`Unpin ${name}`}
                  title="Unpin chat"
                  className="rounded-md p-1.5 text-muted-foreground hover:bg-muted"
                  onClick={() => unpin(id)}
                >
                  <PinOff aria-hidden className="size-3.5" />
                </Action>
                <Action
                  aria-label="Close pinned chat"
                  className="rounded-md p-1.5 text-muted-foreground hover:bg-muted"
                  onClick={() => setOpen(null)}
                >
                  <X aria-hidden className="size-3.5" />
                </Action>
              </div>
              {destination ? (
                <PulseChannelDetail
                  independent
                  channelId={id}
                  channel={destination.channel}
                />
              ) : (
                <p role="status" className="p-4 text-sm text-muted-foreground">
                  {channels.isPending
                    ? "Loading conversation…"
                    : "This conversation is unavailable. You can unpin it here."}
                </p>
              )}
            </PopoverContent>
          </Popover>
        );
      })}
      <Popover
        open={open === "pin"}
        onOpenChange={(next) => changeOpen("pin", next)}
      >
        <DockTooltip
          label="Pin a DM"
          side={layout === "dock" ? "right" : "bottom"}
        >
          <PopoverTrigger asChild>
            <Action
              ref={pinTrigger}
              aria-label="Pin a DM"
              className={
                layout === "dock"
                  ? "pulse-dock-icon"
                  : "pulse-top-icon pulse-control-surface"
              }
            >
              <MessageCirclePlus aria-hidden className="size-6" />
            </Action>
          </PopoverTrigger>
        </DockTooltip>
        <PopoverContent
          side={layout === "dock" ? "right" : "bottom"}
          align={layout === "dock" ? "start" : "end"}
          sideOffset={10}
          aria-label="Pin a DM"
          data-open-method={method}
          className="pulse-quick-popover w-80 p-3"
          onCloseAutoFocus={(event) => {
            if (open !== null && open !== "pin") event.preventDefault();
          }}
        >
          <h2 className="px-1 pb-3 text-sm font-semibold">
            Pin a conversation
          </h2>
          {pinned.length >= MAX_PINNED_DMS ? (
            <p className="p-1 text-sm text-muted-foreground">
              You have four pinned chats. Unpin one to make room.
            </p>
          ) : (
            <>
              <Input
                aria-label="Search DMs to pin"
                placeholder="Find a person or group…"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                className="h-9 text-sm"
              />
              <div className="mt-2 max-h-72 overflow-y-auto">
                {channels.isPending && (
                  <p role="status" className="p-3 text-sm">
                    Loading conversations…
                  </p>
                )}
                {channels.isError && (
                  <p role="alert" className="p-3 text-sm">
                    Couldn’t load DMs.{" "}
                    <Action
                      className="underline"
                      onClick={() => void channels.refetch()}
                    >
                      Try again
                    </Action>
                  </p>
                )}
                {candidates.map(({ channel, name, person }) => (
                  <Action
                    key={channel.id}
                    aria-label={`Pin ${name}`}
                    disabled={!preferences.ready}
                    className="flex w-full items-center gap-3 rounded-lg px-2 py-2.5 text-left text-sm hover:bg-muted"
                    onClick={() => pin(channel.id)}
                  >
                    <span aria-hidden>
                      <UserAvatar
                        avatarUrl={person?.avatarUrl ?? null}
                        displayName={name}
                        size="md"
                        className="size-full text-sm shadow-none"
                        shape={person?.isAgent ? "squircle" : "circle"}
                      />
                    </span>
                    <span className="min-w-0 flex-1 truncate">{name}</span>
                    <Pin
                      aria-hidden
                      className="size-3.5 text-muted-foreground"
                    />
                  </Action>
                ))}
                {!channels.isPending &&
                  !channels.isError &&
                  !candidates.length && (
                    <p className="p-3 text-sm text-muted-foreground">
                      No matching DMs. Start a conversation in Messages to pin
                      it here.
                    </p>
                  )}
              </div>
            </>
          )}
        </PopoverContent>
      </Popover>
    </nav>
  );
});
