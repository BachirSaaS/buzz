import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowUpRight } from "lucide-react";
import { allowNavigation } from "@/app/navigation/navigationGuard";
import {
  useManagedAgentsQuery,
  useRelayAgentsQuery,
} from "@/features/agents/hooks";
import { useAgentWorking } from "@/features/agents/agentWorkingSignal";
import { useAgentAvailabilityLookup } from "@/features/agents/lib/useAgentAvailability";
import { canonicalRelayUrl } from "@/features/agents/managedAgentRuntimeStatus";
import { useChannelsQuery, useOpenDmMutation } from "@/features/channels/hooks";
import { useUsersBatchQuery } from "@/features/profile/hooks";
import { useIdentityQuery } from "@/shared/api/hooks";
import type { PresenceStatus } from "@/shared/api/types";
import { useCommunities } from "@/features/communities/useCommunities";
import { getPresenceDotClassName } from "@/features/presence/lib/presence";
import { Action } from "@/shared/ui/action";
import { UserAvatar } from "@/shared/ui/UserAvatar";
import type { PulseAppSelection } from "./PulseAppNavigation";

type ShortcutAgent = {
  pubkey: string;
  name: string;
  avatarUrl?: string | null;
  owned: boolean;
};

function AgentChatRow({
  agent,
  status,
  pending,
  onOpen,
}: {
  agent: ShortcutAgent;
  status: PresenceStatus | undefined;
  pending: boolean;
  onOpen: () => void;
}) {
  const { working } = useAgentWorking(agent.pubkey);
  const label = working
    ? "Working"
    : status === "online"
      ? "Online"
      : status === "away"
        ? "Away"
        : status === "offline"
          ? "Offline"
          : "Status unavailable";
  return (
    <Action
      aria-label={`Chat with ${agent.name}`}
      aria-description={label}
      disabled={pending}
      onClick={onOpen}
      className="flex min-h-12 w-full items-center gap-3 rounded-xl px-2 py-2 text-left hover:bg-muted disabled:opacity-50"
    >
      <span aria-hidden>
        <UserAvatar
          displayName={agent.name}
          avatarUrl={agent.avatarUrl ?? null}
          shape="squircle"
          size="sm"
        />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm">{agent.name}</span>
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span
            aria-hidden
            className={`size-1.5 rounded-full ${working ? "bg-primary motion-safe:animate-pulse" : status ? getPresenceDotClassName(status) : "bg-muted-foreground/40"}`}
          />
          {label}
        </span>
      </span>
      <ArrowUpRight
        aria-hidden
        className="size-3.5 shrink-0 text-muted-foreground"
      />
    </Action>
  );
}

/** Live agent availability and direct chats, scoped to the current community. */
export function PulseAgentShortcuts({
  onSelect,
  onClose,
  active,
}: {
  active: boolean;
  onSelect: PulseAppSelection;
  onClose: () => void;
}) {
  const relay = useCommunities().activeCommunity?.relayUrl;
  const identity = useIdentityQuery();
  const managed = useManagedAgentsQuery();
  const directory = useRelayAgentsQuery();
  const channels = useChannelsQuery();
  const openDm = useOpenDmMutation();
  const [error, setError] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);
  const generation = useRef(0);
  const busy = useRef(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: Invalidate pending chat navigation when its community or identity changes.
  useEffect(() => {
    generation.current += 1;
    busy.current = false;
    setOpening(false);
    setError(null);
    return () => {
      generation.current += 1;
    };
  }, [relay, identity.data?.pubkey, active]);
  const agents = useMemo(() => {
    const merged = new Map<string, ShortcutAgent>();
    for (const agent of directory.data ?? []) {
      merged.set(agent.pubkey, {
        ...agent,
        owned: agent.ownerPubkey === identity.data?.pubkey,
      });
    }
    for (const agent of managed.data ?? []) {
      if (
        relay &&
        canonicalRelayUrl(relay) !== null &&
        canonicalRelayUrl(agent.relayUrl) === canonicalRelayUrl(relay)
      )
        merged.set(agent.pubkey, { ...agent, owned: true });
    }
    return [...merged.values()]
      .sort(
        (a, b) =>
          Number(b.owned) - Number(a.owned) || a.name.localeCompare(b.name),
      )
      .slice(0, 8);
  }, [directory.data, managed.data, relay, identity.data?.pubkey]);
  const pubkeys = useMemo(() => agents.map((agent) => agent.pubkey), [agents]);
  const { getAvailability } = useAgentAvailabilityLookup(pubkeys);
  const profiles = useUsersBatchQuery(pubkeys, { enabled: pubkeys.length > 0 });

  async function chat(agent: ShortcutAgent) {
    if (
      !active ||
      busy.current ||
      !allowNavigation({ kind: "route", href: "/pulse?feed=conversation" })
    )
      return;
    const current = generation.current;
    busy.current = true;
    setOpening(true);
    setError(null);
    try {
      const existing = channels.data?.find(
        (channel) =>
          channel.isMember &&
          !channel.archivedAt &&
          channel.channelType === "dm" &&
          channel.participantPubkeys.length === 2 &&
          channel.participantPubkeys.includes(agent.pubkey) &&
          channel.participantPubkeys.includes(identity.data?.pubkey ?? ""),
      );
      const dm =
        existing ?? (await openDm.mutateAsync({ pubkeys: [agent.pubkey] }));
      if (current !== generation.current) return;
      if (onSelect("messages", { conversation: dm.id }) !== false) onClose();
    } catch {
      if (current === generation.current)
        setError(
          `Couldn’t open ${agent.name}’s chat. Select the agent to retry.`,
        );
    } finally {
      if (current === generation.current) {
        busy.current = false;
        setOpening(false);
      }
    }
  }
  return (
    <div className="pt-2">
      <p className="px-2 pb-1 text-2xs text-muted-foreground">
        Agents in this community
      </p>
      {(managed.isError || directory.isError) && (
        <Action
          className="w-full rounded-lg p-2 text-left text-xs text-destructive"
          onClick={() => {
            void managed.refetch();
            void directory.refetch();
          }}
        >
          Couldn’t load all agents. Retry
        </Action>
      )}
      {error && (
        <p role="alert" className="p-2 text-xs text-destructive">
          {error}
        </p>
      )}
      {opening && (
        <p role="status" className="px-2 text-xs text-muted-foreground">
          Opening chat…
        </p>
      )}
      <div className="max-h-80 overflow-y-auto">
        {agents.map((agent) => (
          <AgentChatRow
            key={agent.pubkey}
            agent={{
              ...agent,
              avatarUrl:
                profiles.data?.profiles[agent.pubkey]?.avatarUrl ??
                agent.avatarUrl,
            }}
            status={getAvailability(agent.pubkey)}
            pending={opening}
            onOpen={() => void chat(agent)}
          />
        ))}
      </div>
      {!agents.length && (
        <p role="status" className="p-2 text-xs text-muted-foreground">
          {managed.isPending || directory.isPending
            ? "Loading agents…"
            : managed.isSuccess && directory.isSuccess
              ? "No agents in this community yet."
              : "Agent status is unavailable."}
        </p>
      )}
    </div>
  );
}
