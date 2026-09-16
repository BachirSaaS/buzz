import { useAppShell } from "@/app/AppShellContext";
import { useCommunities } from "@/features/communities/useCommunities";
import { useChannelSections } from "@/features/sidebar/lib/useChannelSections";
import { useChannelSortPreference } from "@/features/sidebar/lib/useChannelSortPreference";
import { useFeatureEnabled } from "@/shared/features";
import { classicSidebarGroups } from "../lib/classicSidebarGroups";
import { useMessagesSidebarLayout } from "../lib/useMessagesSidebarLayout";
import { MessagesSidebarHeader } from "./MessagesSidebarHeader";
import { MessagesSidebarSection } from "./MessagesSidebarSection";
import { WorkspaceSidebarButton } from "@/shared/ui/workspace-sidebar-button";
import * as React from "react";
import { useWorkingChannels } from "@/features/agents/agentWorkingSignal";
import { TypingDots } from "@/features/messages/ui/TypingDots";
import {
  PULSE_WORKSPACE_KEYS,
  CLEAR_WORKSPACE_PANELS,
  type PulseView,
} from "../lib/workspaceNavigation";
import { Search, MessageCircle, Users } from "lucide-react";
import { allowNavigation } from "@/app/navigation/navigationGuard";
import { buildDirectMessageIntro } from "@/features/channels/lib/dmParticipantDisplay";
import { useUsersBatchQuery } from "@/features/profile/hooks";
import type { Channel } from "@/shared/api/types";
import { useHistorySearchState } from "@/shared/hooks/useHistorySearchState";
import { usePresenceQuery } from "@/features/presence/hooks";
import {
  DEFAULT_HOVER_PROFILE_STATUS_GEOMETRY,
  ProfileAvatarWithStatus,
  scaleProfileAvatarStatusGeometry,
} from "@/features/profile/ui/ProfileAvatarWithStatus";
import { normalizePubkey } from "@/shared/lib/pubkey";

import { PulseChannelAvatar, PulseSidebarIcon } from "./PulseChannelAvatar";
import { PulseChannelDetail } from "./PulseChannelDetail";
import {
  PULSE_STATUS_DOT_CLASS,
  PulseUnreadDot,
  usePulseUnreadChannels,
} from "./PulseUnreadDot";
import {
  PULSE_CONVERSATION_KEYS,
  CLEAR_CONVERSATION_PANELS,
} from "../lib/pulsePanelState";

const EMPTY_STARRED_IDS = new Set<string>();
const AVATAR_SIZE = 28;
const AVATAR_STATUS_GEOMETRY = scaleProfileAvatarStatusGeometry(
  DEFAULT_HOVER_PROFILE_STATUS_GEOMETRY,
  AVATAR_SIZE,
);

const SPLIT_VIEW_SEARCH_KEYS = [
  "feed",
  ...PULSE_CONVERSATION_KEYS,
  ...PULSE_WORKSPACE_KEYS,
] as const;

export function PulseConversationSplitView({
  channels,
  currentPubkey,
  search = "",
  selectionKey,
  label,
  testPrefix,
  allMessages,
  navigation,
}: {
  channels: Channel[];
  currentPubkey?: string;
  search?: string;
  selectionKey: "dm" | "conversation";
  label: string;
  testPrefix: string;
  allMessages?: {
    content: React.ReactNode;
    scrollRef: React.RefCallback<HTMLDivElement>;
  };
  navigation?: {
    view: PulseView;
    onSelectView: (view: PulseView) => void;
  };
}) {
  const { activeCommunity } = useCommunities();
  const { starredChannelIds = EMPTY_STARRED_IDS } = useAppShell();
  const { sections, assignments } = useChannelSections(
    currentPubkey,
    activeCommunity?.relayUrl,
  );
  const sectionIds = React.useMemo(
    () => sections.map((section) => section.id),
    [sections],
  );
  const { sortModeFor } = useChannelSortPreference(
    currentPubkey,
    activeCommunity?.relayUrl,
    sectionIds,
  );
  const [layout, setLayout] = useMessagesSidebarLayout(
    currentPubkey,
    activeCommunity?.relayUrl,
  );
  const showForums = useFeatureEnabled("forum");
  const isUnread = usePulseUnreadChannels();
  const workingChannels = useWorkingChannels();
  const workingAgents = React.useMemo(
    () =>
      new Set(
        workingChannels.flatMap((channel) =>
          channel.agentPubkeys.map(normalizePubkey),
        ),
      ),
    [workingChannels],
  );
  const { values, applyPatch } = useHistorySearchState(SPLIT_VIEW_SEARCH_KEYS);
  const pubkeys = React.useMemo(
    () => [
      ...new Set(
        channels
          .filter((c) => c.channelType === "dm")
          .flatMap((c) => c.participantPubkeys),
      ),
    ],
    [channels],
  );
  const profiles = useUsersBatchQuery(pubkeys, { enabled: pubkeys.length > 0 });
  const presence = usePresenceQuery(pubkeys, { enabled: pubkeys.length > 0 });
  const rows = React.useMemo(() => {
    return channels.map((channel) => {
      const intro =
        channel.channelType === "dm"
          ? buildDirectMessageIntro({
              channel,
              currentPubkey,
              profiles: profiles.data?.profiles,
            })
          : null;
      return {
        channel,
        name: intro?.displayName || channel.name,
        participants: intro?.participants ?? [],
      };
    });
  }, [channels, currentPubkey, profiles.data]);
  const query = search.trim().toLocaleLowerCase();
  const visibleRows = rows.filter(
    (row) => !query || row.name.toLocaleLowerCase().includes(query),
  );
  const selected =
    navigation && navigation.view !== "conversation"
      ? null
      : (channels.find((channel) => channel.id === values[selectionKey]) ??
        (allMessages ? null : visibleRows[0]?.channel) ??
        null);
  const selectedId =
    navigation && navigation.view !== "conversation"
      ? undefined
      : (values[selectionKey] ?? selected?.id);
  React.useEffect(() => {
    if (!values[selectionKey] && selectedId) {
      applyPatch({ [selectionKey]: selectedId }, { replace: true });
    }
  }, [values[selectionKey], selectedId, applyPatch, selectionKey]);
  const selectConversation = (channel: Channel | null) => {
    const channelId = channel?.id ?? null;
    if (
      (!navigation || navigation.view === "conversation") &&
      channelId === (selected?.id ?? null) &&
      values[selectionKey] === channelId
    )
      return;
    if (
      !allowNavigation({
        kind: "route",
        href: `/pulse?feed=${selectionKey}&${selectionKey}=${channelId ?? ""}`,
      })
    )
      return;
    applyPatch({
      ...CLEAR_CONVERSATION_PANELS,
      ...CLEAR_WORKSPACE_PANELS,
      [selectionKey]: channelId,
      ...(navigation ? { feed: "conversation" } : {}),
    });
  };

  const renderRow = (row: (typeof rows)[number]) => {
    const participant = row.participants[0];
    const working =
      row.channel.channelType === "dm" &&
      row.participants.some((person) =>
        workingAgents.has(normalizePubkey(person.pubkey)),
      );
    const unread = isUnread(row.channel.id);
    return (
      <WorkspaceSidebarButton
        type="button"
        key={row.channel.id}
        active={selected?.id === row.channel.id}
        data-testid={`${testPrefix}-${row.channel.id}`}
        data-channel-name={row.channel.name}
        aria-description={
          [working && "Agent working", unread && "Unread messages"]
            .filter(Boolean)
            .join(". ") || undefined
        }
        aria-label={
          row.channel.channelType === "dm"
            ? `Open DM with ${row.name}`
            : `Open channel ${row.name}`
        }
        aria-current={selected?.id === row.channel.id ? "true" : undefined}
        onClick={() => selectConversation(row.channel)}
        className="mb-2"
      >
        {row.channel.channelType !== "dm" ? (
          <PulseChannelAvatar channel={row.channel} />
        ) : row.participants.length > 1 ? (
          <PulseSidebarIcon icon={Users} />
        ) : (
          <ProfileAvatarWithStatus
            avatarUrl={participant?.avatarUrl ?? null}
            label={row.name}
            avatarClassName="text-xs"
            className="size-7 shrink-0"
            geometry={AVATAR_STATUS_GEOMETRY}
            size={AVATAR_SIZE}
            status={presence.data?.[normalizePubkey(participant?.pubkey ?? "")]}
            statusTestId="pulse-conversation-presence"
            shape={participant?.isAgent ? "squircle" : "circle"}
          />
        )}
        <span className="min-w-0 truncate text-sm">{row.name}</span>
        {working ? (
          <span
            aria-hidden="true"
            data-testid="pulse-working-dots"
            className="ml-auto flex shrink-0 items-center"
          >
            <TypingDots
              className="gap-[3px] [--typing-dot-lift:-2px]"
              dotClassName={`${PULSE_STATUS_DOT_CLASS} ${selected?.id === row.channel.id ? "bg-primary-foreground" : ""}`}
            />
          </span>
        ) : unread ? (
          <PulseUnreadDot active={selected?.id === row.channel.id} />
        ) : null}
      </WorkspaceSidebarButton>
    );
  };

  const rowsById = new Map(visibleRows.map((row) => [row.channel.id, row]));
  const groups = classicSidebarGroups({
    channels: visibleRows.map((row) => row.channel),
    sections,
    assignments,
    starredIds: starredChannelIds,
    sortModeFor,
    labels: Object.fromEntries(rows.map((row) => [row.channel.id, row.name])),
    showForums,
  });

  return (
    <div
      className="flex min-h-0 min-w-0 flex-1"
      data-testid={`${testPrefix}-view`}
    >
      <nav
        aria-label={layout === "classic" ? "Conversations by section" : label}
        className="w-[220px] min-w-0 shrink-0 overflow-y-auto border-r border-border bg-muted/30 p-4"
        data-testid={`${testPrefix}-list`}
        data-sidebar-layout={layout}
      >
        <MessagesSidebarHeader layout={layout} onLayoutChange={setLayout} />
        {navigation &&
          ([{ id: "search", label: "Search", icon: Search }] as const).map(
            ({ id, label, icon: Icon }) => (
              <WorkspaceSidebarButton
                key={id}
                active={navigation.view === id}
                type="button"
                aria-current={navigation.view === id ? "true" : undefined}
                onClick={() => navigation.onSelectView(id)}
                className="mb-2"
              >
                <PulseSidebarIcon icon={Icon} />
                {label}
              </WorkspaceSidebarButton>
            ),
          )}
        {allMessages && (
          <>
            <WorkspaceSidebarButton
              active={
                !selectedId &&
                (!navigation || navigation.view === "conversation")
              }
              type="button"
              aria-current={
                !selectedId &&
                (!navigation || navigation.view === "conversation")
                  ? "true"
                  : undefined
              }
              onClick={() => selectConversation(null)}
              className="mb-2"
            >
              <PulseChannelAvatar />
              All messages
            </WorkspaceSidebarButton>
            <div className="my-2 border-t border-border/40" />
          </>
        )}
        {visibleRows.length ? (
          layout === "classic" ? (
            groups
              .filter((section) => !query || section.channels.length > 0)
              .map((section) => (
                <MessagesSidebarSection
                  key={section.id}
                  id={section.id}
                  name={section.name}
                  icon={section.icon}
                >
                  {section.channels.map((channel) => {
                    const row = rowsById.get(channel.id);
                    return row ? renderRow(row) : null;
                  })}
                </MessagesSidebarSection>
              ))
          ) : (
            visibleRows.map(renderRow)
          )
        ) : (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">
            {query ? "No matching conversations" : "No conversations yet"}
          </p>
        )}
      </nav>
      {!selectedId && allMessages ? (
        <div
          ref={allMessages.scrollRef}
          className="min-h-0 min-w-0 flex-1 overflow-y-auto"
          data-testid={
            navigation?.view === "search"
              ? "pulse-search-feed"
              : "pulse-all-messages-feed"
          }
        >
          {allMessages.content}
        </div>
      ) : (
        <div
          className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
          data-testid={`${testPrefix}-detail`}
          data-channel-id={selectedId}
        >
          {selectedId ? (
            <PulseChannelDetail
              channel={selected ?? undefined}
              channelId={selectedId}
            />
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
              <MessageCircle aria-hidden className="size-6" />
              <p>Select a conversation</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
