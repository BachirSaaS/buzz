import { useMemo, useState } from "react";
import { useRelayAgentsQuery } from "@/features/agents/hooks";
import { useAgentWorking } from "@/features/agents/agentWorkingSignal";
import {
  useObserverEvents,
  useAgentTranscript,
} from "@/features/agents/ui/useObserverEvents";
import { useOpenAgentActivity } from "@/features/agents/useOpenAgentActivity";
import { NativeSelect } from "@/shared/blockui/components/native-select";
import type { Channel, RelayAgent } from "@/shared/api/types";
import { AgentActivityWidget } from "./BuzzWidgets";
import { buildAgentWidgetModel } from "./agentWidgetModel";
import { Control, Widget } from "./Widget";

/** Exact-key agent activity sourced from Buzz's shared observer and liveness stores. */
export function LiveAgentWidget({ channels }: { channels: Channel[] }) {
  const query = useRelayAgentsQuery();
  const [selected, setSelected] = useState("");
  const allowed = useMemo(
    () => new Set(channels.map((channel) => channel.id)),
    [channels],
  );
  const agents = (query.data ?? [])
    .filter((agent) => agent.channelIds.some((id) => allowed.has(id)))
    .slice(0, 100);
  const agent = agents.find((item) => item.pubkey === selected) ?? agents[0];
  if (query.isError)
    return (
      <Widget title="Agent activity">
        <p>Couldn’t load your agents.</p>
        <Control onClick={() => void query.refetch()}>Try again</Control>
      </Widget>
    );
  if (!agent)
    return (
      <Widget title="Agent activity">
        <h3 className="section-anchor">
          {query.isPending ? "Finding your agents…" : "A little help, on hand."}
        </h3>
        <p className="small subtle">
          {query.isPending
            ? "Loading agent activity."
            : "Agents in your joined conversations will appear here."}
        </p>
      </Widget>
    );
  return (
    <ObservedAgent
      key={agent.pubkey}
      agent={agent}
      channels={channels}
      allowed={allowed}
      selection={
        <NativeSelect
          className="widget-select"
          aria-label="Agent to follow"
          value={agent.pubkey}
          onChange={(event) => setSelected(event.target.value)}
        >
          {agents.map((item) => (
            <option value={item.pubkey} key={item.pubkey}>
              {item.name}
            </option>
          ))}
        </NativeSelect>
      }
    />
  );
}

function ObservedAgent({
  agent,
  channels,
  allowed,
  selection,
}: {
  agent: RelayAgent;
  channels: Channel[];
  allowed: Set<string>;
  selection: React.ReactNode;
}) {
  const observer = useObserverEvents(true, agent.pubkey);
  const transcript = useAgentTranscript(true, agent.pubkey);
  const working = useAgentWorking(agent.pubkey);
  const scoped = useMemo(
    () =>
      transcript.filter((item) =>
        Boolean(item.channelId && allowed.has(item.channelId)),
      ),
    [transcript, allowed],
  );
  const channelId =
    working.channels.find((item) => allowed.has(item.channelId))?.channelId ??
    scoped.at(-1)?.channelId ??
    agent.channelIds.find((id) => allowed.has(id));
  const channel = channels.find((item) => item.id === channelId);
  const items = useMemo(
    () => scoped.filter((item) => item.channelId === channelId),
    [scoped, channelId],
  );
  const { openAgentActivity } = useOpenAgentActivity();
  const model = buildAgentWidgetModel({
    name: agent.name,
    channel: channel
      ? channel.channelType === "dm"
        ? "Direct conversation"
        : `#${channel.name}`
      : "Agent activity",
    items,
    working: working.channels.some((item) => item.channelId === channelId),
    connected: observer.connectionState === "open",
  });
  return (
    <AgentActivityWidget
      key={channelId}
      agent={model}
      selection={selection}
      onOpen={
        channelId
          ? () => {
              openAgentActivity(agent.pubkey, { channelId });
            }
          : undefined
      }
    />
  );
}
