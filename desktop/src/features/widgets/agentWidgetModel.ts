import type { TranscriptItem } from "@/features/agents/ui/agentSessionTypes";
import type { AgentWidgetModel, WidgetTool } from "./BuzzWidgets";

/** Reduce an authorized, single-channel transcript to the latest turn only. */
export function buildAgentWidgetModel({
  name,
  channel,
  items,
  working,
  connected,
}: {
  name: string;
  channel: string;
  items: TranscriptItem[];
  working: boolean;
  connected: boolean;
}): AgentWidgetModel {
  const latest = items.at(-1);
  const turn = latest
    ? items.filter(
        (item) =>
          item.sessionId === latest.sessionId && item.turnId === latest.turnId,
      )
    : [];
  const tools = turn.filter(
    (item): item is Extract<TranscriptItem, { type: "tool" }> =>
      item.type === "tool",
  );
  const latestSignal = [...turn]
    .reverse()
    .find(
      (item) =>
        item.type === "thought" ||
        item.type === "message" ||
        item.type === "tool" ||
        (item.type === "lifecycle" &&
          (item.renderClass === "error" || item.renderClass === "permission")),
    );
  const usage = [...turn]
    .reverse()
    .find(
      (item) => item.type === "lifecycle" && item.acpSource === "usage_update",
    );
  const match =
    usage?.type === "lifecycle"
      ? /^Tokens: (\d+)\/(\d+)/.exec(usage.text)
      : null;
  let status = items.length ? "Latest activity" : "Waiting for activity";
  if (working)
    status = tools.some((tool) => tool.status === "executing")
      ? "Using tools"
      : latestSignal?.type === "thought"
        ? "Thinking"
        : latestSignal?.type === "message" && latestSignal.role === "assistant"
          ? "Writing a response"
          : "Working";
  if (
    latestSignal?.renderClass === "permission" &&
    latestSignal.type === "lifecycle" &&
    !latestSignal.outcome
  )
    status = "Needs your approval";
  if (
    latestSignal?.renderClass === "error" ||
    (latestSignal?.type === "tool" && latestSignal.status === "failed")
  )
    status = "Needs attention";
  if (!connected) status = "Reconnecting";
  return {
    name,
    status,
    context: channel,
    active: connected && working,
    tools: tools.slice(-3).map(
      (tool): WidgetTool => ({
        id: tool.id,
        title: tool.descriptor.label || tool.title,
        detail: (tool.descriptor.preview || tool.result || tool.toolName).slice(
          0,
          1200,
        ),
        state: tool.status,
      }),
    ),
    toolCount: tools.length,
    tokens: match ? Number(match[1]) : null,
    capacity: match ? Number(match[2]) : null,
  };
}
