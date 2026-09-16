import type { BriefingGroup } from "./pulseBriefing";
import type { PulseConversation } from "./unifiedFeed";

/** Select source-backed context, preferring shared artifacts over acknowledgements. */
export function selectBriefingEvidence(
  group: BriefingGroup,
  conversations: Map<string, PulseConversation>,
) {
  const items = [...group.ids].flatMap((id) => conversations.get(id) ?? []);
  const messages = [
    ...new Map(
      items.flatMap((item) =>
        item.messages
          .filter((m) => !m.pending)
          .map((message) => [message.id, { message, item }] as const),
      ),
    ).values(),
  ];
  if (group.evidenceIds?.length)
    return group.evidenceIds
      .flatMap(
        (id) => messages.find((source) => source.message.id === id) ?? [],
      )
      .slice(0, 2);
  const score = (body: string) =>
    /https?:\/\/[^\s]*(?:github\.com|\.(?:png|jpe?g|webp|gif))/i.test(body)
      ? 3
      : body.length > 60
        ? 2
        : 1;
  return messages
    .filter(
      ({ message }) =>
        message.body.trim() &&
        !/^(?:hi|hey|hello|sup+|wow|oops|thanks|thank you|love this|yes|no|ok|okay|lol)[!.\s]*$/i.test(
          message.body.trim(),
        ),
    )
    .sort(
      (a, b) =>
        score(b.message.body) - score(a.message.body) ||
        b.message.createdAt - a.message.createdAt,
    )
    .slice(0, 2)
    .sort((a, b) => a.message.createdAt - b.message.createdAt);
}
