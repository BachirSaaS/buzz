import type { PulseConversation } from "./unifiedFeed";
import type { BriefingGroup, ReadSignals } from "./pulseBriefing";

/** Supply conversation context and explicit viewer relevance, bounded for a short briefing. */
export function buildSummaryInput(
  conversations: PulseConversation[],
  me: string,
  reads: ReadSignals,
  scope: string,
  now: number,
) {
  const eligible = conversations.filter(
    (item) =>
      Boolean(item.channel) &&
      !reads.isThreadMuted(item.rootId) &&
      item.latestAt >= now - 48 * 3600,
  );
  const selected = [...eligible].sort(
    (a, b) =>
      Number(b.channel?.channelType === "dm" || b.isMention) -
        Number(a.channel?.channelType === "dm" || a.isMention) ||
      b.latestAt - a.latestAt,
  );
  const messageSources = new Map(
    eligible.flatMap((item) =>
      item.messages.map((message) => [message.id, item.id] as const),
    ),
  );
  const perSource = new Map<string, number>();
  return {
    scope,
    asOf: Math.floor(now / 60) * 60,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    conversations: selected
      .filter((item) => {
        const source = item.channel?.id ?? "notes";
        const count = perSource.get(source) ?? 0;
        perSource.set(source, count + 1);
        return count < 3;
      })
      .slice(0, 30)
      .map((item) => {
        const context =
          item.channel?.channelType === "dm"
            ? eligible
                .filter((other) => other.channel?.id === item.channel?.id)
                .flatMap((other) => other.messages)
            : item.messages;
        const messages = [
          ...new Map(
            context.filter((m) => !m.pending).map((m) => [m.id, m]),
          ).values(),
        ]
          .sort((a, b) => a.createdAt - b.createdAt)
          .slice(-8);
        return {
          id: item.id,
          channelId: item.channel?.id,
          source: item.channel?.name ?? "Public notes",
          isDm: item.channel?.channelType === "dm",
          followed: reads.isFollowingThread(item.rootId),
          messages: messages.map((m) => ({
            id: m.id,
            conversationId: messageSources.get(m.id) ?? item.id,
            author: m.author,
            isViewer: m.pubkey?.toLowerCase() === me.toLowerCase(),
            isAgent: Boolean(m.isAgent),
            createdAt: m.createdAt,
            body: m.body.slice(0, 650),
          })),
        };
      }),
  };
}

/** Reject ungrounded source links and malformed model responses. */
export function parsePulseSummary(
  value: unknown,
  allowed: Set<string>,
  messageSources: Map<string, string> = new Map(),
  channels: Map<string, string> = new Map(),
): BriefingGroup[] {
  const data = value as { highlights?: unknown[] };
  if (!data || !Array.isArray(data.highlights) || data.highlights.length > 10)
    throw new Error("Invalid briefing response");
  const used = new Set<string>();
  return data.highlights.map((entry) => {
    const item = entry as {
      summary?: string;
      conversationIds?: string[];
      messageIds?: string[];
    };
    if (
      !item ||
      typeof item.summary !== "string" ||
      !item.summary.trim() ||
      item.summary.length > 240 ||
      !Array.isArray(item.conversationIds) ||
      !item.conversationIds.length ||
      item.conversationIds.length > 6 ||
      item.conversationIds.some((id) => used.has(id)) ||
      new Set(item.conversationIds.map((id) => channels.get(id))).size > 1 ||
      item.conversationIds.some(
        (id) => typeof id !== "string" || !allowed.has(id),
      )
    )
      throw new Error("Briefing references unavailable conversations");
    if (
      item.messageIds !== undefined &&
      (!Array.isArray(item.messageIds) ||
        item.messageIds.length < 1 ||
        item.messageIds.length > 2 ||
        new Set(item.messageIds).size !== item.messageIds.length ||
        item.messageIds.some(
          (id) => !item.conversationIds?.includes(messageSources.get(id) ?? ""),
        ))
    )
      throw new Error(
        "Briefing evidence does not belong to its source conversations",
      );
    for (const id of item.conversationIds) used.add(id);
    return {
      kind: `recent:${item.conversationIds[0]}`,
      label: item.summary.trim(),
      evidenceIds: item.messageIds,
      generated: true,
      ids: new Set(item.conversationIds),
    };
  });
}
