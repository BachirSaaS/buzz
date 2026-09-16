import type { UserProfileSummary } from "@/shared/api/types";
import type { SourceEvent } from "./types";

export type ChiefRequest = <T>(
  path: string,
  method?: string,
  body?: unknown,
) => Promise<T>;
export type OpenSource = (event: SourceEvent) => void;

/** Adapt original Accumulator events to the same message presentation as Home. */
export function sourceMessage(
  event: SourceEvent,
  profiles: Record<string, UserProfileSummary>,
) {
  return {
    id: event.id,
    pubkey: event.pubkey,
    author:
      profiles[event.pubkey]?.displayName ?? event.author_name ?? "Buzz member",
    avatarUrl: profiles[event.pubkey]?.avatarUrl,
    isAgent: profiles[event.pubkey]?.isAgent,
    body: event.content,
    createdAt: event.created_at,
    time: new Date(event.created_at * 1000).toLocaleTimeString(),
    depth: 0,
    kind: event.kind,
  };
}
