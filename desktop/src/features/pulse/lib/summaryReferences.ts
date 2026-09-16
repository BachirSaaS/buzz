import type { buildSummaryInput } from "./pulseSummary";

/** Short, request-local references reduce token cost and prevent long event-ID transcription errors. */
export function summaryReferences(input: ReturnType<typeof buildSummaryInput>) {
  const conversations = new Map<string, string>();
  const messages = new Map<string, string>();
  const alias = (map: Map<string, string>, id: string, prefix: string) => {
    const existing = map.get(id);
    if (existing) return existing;
    const key = `${prefix}${map.size + 1}`;
    map.set(id, key);
    return key;
  };
  const payload = {
    asOf: Math.floor(Date.now() / 1000),
    timezone: input.timezone,
    viewer: input.viewer,
    conversations: input.conversations.map((item) => ({
      ...item,
      id: alias(conversations, item.id, "c"),
      messages: item.messages.map((message) => ({
        ...message,
        id: alias(messages, message.id, "m"),
        conversationId: alias(conversations, message.conversationId, "c"),
      })),
    })),
  };
  const reverse = (map: Map<string, string>) =>
    new Map([...map].map(([id, key]) => [key, id]));
  const conversationIds = reverse(conversations);
  const messageIds = reverse(messages);
  const resolve = (value: unknown, map: Map<string, string>) => {
    if (!Array.isArray(value)) return value;
    return value.map((key) => {
      const id = map.get(key);
      if (!id)
        throw new Error(
          "Summary contains an unavailable source reference. Try again.",
        );
      return id;
    });
  };
  return {
    payload,
    decode(value: unknown): unknown {
      if (
        !value ||
        typeof value !== "object" ||
        !("highlights" in value) ||
        !Array.isArray(value.highlights)
      )
        return value;
      return {
        highlights: value.highlights.map((entry) => {
          if (!entry || typeof entry !== "object") return entry;
          return {
            ...entry,
            conversationIds: resolve(entry.conversationIds, conversationIds),
            messageIds: resolve(entry.messageIds, messageIds),
          };
        }),
      };
    },
  };
}
