import {
  getChannelIdFromTags,
  getThreadReference,
} from "@/features/messages/lib/threading";
import {
  PULSE_CHANNEL_KINDS,
  PULSE_CONTENT_KINDS,
  PULSE_SOURCE_LIMIT,
} from "./unifiedFeed";
import { relayClient } from "@/shared/api/relayClient";
import type { RelayEvent } from "@/shared/api/types";

type FetchEvents = typeof relayClient.fetchEvents;

/** Bounded history across selected sources, including roots and structural edits. */
export async function fetchPulseFeed(
  channelIds: string[],
  noteAuthors: string[],
  fetchEvents: FetchEvents = (filter) => relayClient.fetchEvents(filter),
  dmChannelIds: string[] = [],
): Promise<RelayEvent[]> {
  if (channelIds.length > PULSE_SOURCE_LIMIT || noteAuthors.length > 100)
    throw new Error("Too many Pulse sources. Choose fewer sources and retry.");
  const sourceReads: Promise<RelayEvent[]>[] = [];
  // Separate quotas prevent a busy public or channel feed from hiding all DMs.
  const dmIds = channelIds.filter((id) => dmChannelIds.includes(id));
  const otherIds = channelIds.filter((id) => !dmChannelIds.includes(id));
  for (const sourceIds of [dmIds, otherIds]) {
    if (sourceIds.length)
      sourceReads.push(
        fetchEvents({
          kinds: PULSE_CHANNEL_KINDS,
          "#h": sourceIds,
          limit: 100,
        }),
      );
  }
  if (noteAuthors.length)
    sourceReads.push(
      fetchEvents({ kinds: [1], authors: noteAuthors, limit: 50 }),
    );
  // At most three independent reads. Promise.all preserves DM/channel/note
  // quota order even when responses arrive in a different order.
  const events = (await Promise.all(sourceReads)).flat();
  const channels = new Set(channelIds);
  const authors = new Set(noteAuthors);
  const scoped = events
    .filter((event) => {
      const channel = getChannelIdFromTags(event.tags);
      return channel
        ? channels.has(channel)
        : event.kind === 1 && authors.has(event.pubkey);
    })
    .slice(0, 250);
  const ids = new Set(scoped.map((event) => event.id));
  const roots = [
    ...new Set(
      scoped
        .map((event) => getThreadReference(event.tags).rootId)
        .filter((id): id is string => Boolean(id && !ids.has(id))),
    ),
  ].slice(0, 50);
  if (roots.length) {
    const parents = await fetchEvents({
      kinds: PULSE_CONTENT_KINDS,
      ids: roots,
      limit: 50,
    });
    // A referenced root is context, but must stay inside the selected channel.
    scoped.push(
      ...parents.slice(0, 50).filter((event) => {
        const channel = getChannelIdFromTags(event.tags);
        return channel ? channels.has(channel) : event.kind === 1;
      }),
    );
  }
  const messageIds = [...new Set(scoped.map((event) => event.id))];
  const batches: string[][] = [];
  for (let offset = 0; offset < messageIds.length; offset += 100) {
    batches.push(messageIds.slice(offset, offset + 100));
  }
  // Up to 250 source events + 50 parents means at most three concurrent
  // batches. Each batch still awaits edits before reading their retractions.
  const structural = await Promise.all(
    batches.map(async (ids) => {
      const aux = await fetchEvents({
        kinds: [40003, 5, 9005],
        "#e": ids,
        limit: 300,
      });
      const edits = aux
        .filter((event) => event.kind === 40003)
        .map((event) => event.id);
      return edits.length
        ? [
            ...aux,
            ...(await fetchEvents({
              kinds: [5, 9005],
              "#e": edits,
              limit: 300,
            })),
          ]
        : aux;
    }),
  );
  scoped.push(...structural.flat());
  return [...new Map(scoped.map((event) => [event.id, event])).values()];
}
