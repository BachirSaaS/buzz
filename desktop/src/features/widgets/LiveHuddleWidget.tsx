import { Headphones } from "lucide-react";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useHuddle } from "@/features/huddle";
import { HuddleIndicator } from "@/features/huddle/components/HuddleIndicator";
import { buildHuddleChannelName } from "@/features/huddle/lib/huddleChannelName";
import { formatHuddleActionError } from "@/features/huddle/lib/huddleError";
import {
  useManagedAgentsQuery,
  useRelayAgentsQuery,
} from "@/features/agents/hooks";
import { mergeChannelKnownAgentPubkeys } from "@/features/agents/knownAgentPubkeys";
import { useChannelMembersQuery } from "@/features/channels/hooks";
import { getDmHuddleMemberPubkeys } from "@/features/channels/lib/dmHuddleMembers";
import { canStartHuddleInChannel } from "@/features/channels/lib/huddleAvailability";
import { NativeSelect } from "@/shared/blockui/components/native-select";
import type { Channel, UserProfileSummary } from "@/shared/api/types";
import { HuddleWidget } from "./BuzzWidgets";
import { Control, Widget } from "./Widget";

/** Launch or join a real huddle in an existing joined conversation. */
export function LiveHuddleWidget({
  channels,
  profiles,
  currentPubkey,
}: {
  channels: Channel[];
  profiles: Record<string, UserProfileSummary>;
  currentPubkey?: string;
}) {
  const [selected, setSelected] = useState("");
  const eligible = channels.filter(
    (channel) => channel.isMember && !channel.archivedAt && !channel.ttlSeconds,
  );
  const channel =
    eligible.find((item) => item.id === selected) ??
    eligible.find(
      (item) => item.channelType === "dm" && item.participantPubkeys.length > 2,
    ) ??
    eligible[0];
  if (!channel)
    return (
      <Widget title="Huddle">
        <h3 className="section-anchor">Make room for a conversation.</h3>
        <p className="small subtle">
          Join a channel or group conversation to start a huddle.
        </p>
      </Widget>
    );
  return (
    <ChannelHuddle
      key={channel.id}
      channel={channel}
      profiles={profiles}
      currentPubkey={currentPubkey}
      selection={
        <NativeSelect
          className="widget-select"
          aria-label="Huddle conversation"
          value={channel.id}
          onChange={(event) => setSelected(event.target.value)}
        >
          {eligible.map((item) => (
            <option key={item.id} value={item.id}>
              {item.channelType === "dm"
                ? item.participants.join(", ") || "Group conversation"
                : `#${item.name}`}
            </option>
          ))}
        </NativeSelect>
      }
    />
  );
}

function ChannelHuddle({
  channel,
  profiles,
  currentPubkey,
  selection,
}: {
  channel: Channel;
  profiles: Record<string, UserProfileSummary>;
  currentPubkey?: string;
  selection: React.ReactNode;
}) {
  const members = useChannelMembersQuery(channel.id);
  const managed = useManagedAgentsQuery();
  const relay = useRelayAgentsQuery();
  const queryClient = useQueryClient();
  const {
    startHuddle,
    isStarting,
    activeEphemeralChannelId,
    showHuddleInMainApp,
  } = useHuddle();
  const [error, setError] = useState<string | null>(null);
  const agents = mergeChannelKnownAgentPubkeys(
    members.data,
    managed.data,
    relay.data,
  );
  const memberPubkeys = getDmHuddleMemberPubkeys(
    channel,
    agents,
    currentPubkey,
  );
  const pending =
    members.isPending ||
    (channel.channelType === "dm" && (managed.isPending || relay.isPending));
  const failed =
    members.isError ||
    (channel.channelType === "dm" && (managed.isError || relay.isError));
  const canStart = canStartHuddleInChannel({
    channel,
    currentPubkey,
    selfMember:
      members.data?.find((member) => member.pubkey === currentPubkey) ?? null,
  });
  const start = async () => {
    if (pending || failed || !canStart || isStarting) return;
    setError(null);
    try {
      await startHuddle(
        channel.id,
        memberPubkeys,
        buildHuddleChannelName({
          channel,
          currentPubkey,
          members: members.data,
        }),
      );
      void queryClient.invalidateQueries({ queryKey: ["channels"] });
    } catch (cause) {
      setError(formatHuddleActionError(cause, "start"));
    }
  };
  const people = (members.data ?? []).map((member) => ({
    id: member.pubkey,
    name:
      member.pubkey === currentPubkey ? "You" : member.displayName || "Member",
    avatar: profiles[member.pubkey]?.avatarUrl,
  }));
  const action = activeEphemeralChannelId ? (
    <Control
      className="communication-action"
      onClick={() => showHuddleInMainApp(activeEphemeralChannelId)}
    >
      <Headphones aria-hidden="true" />
      Return to huddle
    </Control>
  ) : (
    <HuddleIndicator
      channelId={channel.id}
      renderMode="labeled"
      listenForShortcut={false}
      className="widget-control communication-action"
      onStart={() => void start()}
      startDisabled={pending || failed || !canStart || isStarting}
    />
  );
  return (
    <HuddleWidget
      title={
        channel.channelType === "dm"
          ? channel.participants.join(", ") || "Group conversation"
          : `#${channel.name}`
      }
      people={people}
      active={Boolean(activeEphemeralChannelId)}
      count={members.data?.length ?? channel.memberCount}
      selection={selection}
      error={
        error || (failed ? "Couldn’t load this conversation’s members." : null)
      }
      action={
        <>
          {action}
          {failed && (
            <Control
              onClick={() => {
                void members.refetch();
                void managed.refetch();
                void relay.refetch();
              }}
            >
              Try again
            </Control>
          )}
        </>
      }
    />
  );
}
