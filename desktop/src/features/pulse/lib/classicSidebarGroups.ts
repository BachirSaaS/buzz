import type { Channel } from "@/shared/api/types";
import type { ChannelSection } from "@/features/sidebar/lib/channelSectionsStorage";
import {
  sectionSortGroupKey,
  sortChannelsForSidebar,
  type ChannelSortGroupKey,
  type ChannelSortMode,
} from "@/features/sidebar/lib/channelSortPreference";
import { sortDmChannelsForSidebar } from "@/features/sidebar/lib/dmSidebarSort";

/** Project the existing sidebar organization without changing saved assignments. */
export function classicSidebarGroups({
  channels,
  sections,
  assignments,
  starredIds,
  sortModeFor,
  labels,
  showForums,
}: {
  channels: Channel[];
  sections: ChannelSection[];
  assignments: Record<string, string>;
  starredIds: ReadonlySet<string>;
  sortModeFor: (group: ChannelSortGroupKey) => ChannelSortMode;
  labels: Record<string, string>;
  showForums: boolean;
}) {
  const streams = channels.filter(
    (channel) => channel.channelType === "stream",
  );
  const sectionIds = new Set(sections.map((section) => section.id));
  const unstarred = streams.filter((channel) => !starredIds.has(channel.id));
  const group = (
    id: ChannelSortGroupKey,
    name: string,
    items: Channel[],
    icon?: string,
  ) => ({
    id,
    name,
    icon,
    channels: sortChannelsForSidebar(items, sortModeFor(id)),
  });
  return [
    group(
      "starred",
      "Starred",
      streams.filter((channel) => starredIds.has(channel.id)),
    ),
    ...sections
      .slice()
      .sort((a, b) => a.order - b.order)
      .map((section) =>
        group(
          sectionSortGroupKey(section.id),
          section.name,
          unstarred.filter((channel) => assignments[channel.id] === section.id),
          section.icon,
        ),
      ),
    group(
      "channels",
      "Channels",
      unstarred.filter((channel) => !sectionIds.has(assignments[channel.id])),
    ),
    ...(showForums
      ? [
          group(
            "forums",
            "Forums",
            channels.filter((channel) => channel.channelType === "forum"),
          ),
        ]
      : []),
    {
      id: "dms",
      name: "Direct messages",
      icon: undefined,
      channels: sortDmChannelsForSidebar(
        channels.filter((channel) => channel.channelType === "dm"),
        labels,
        sortModeFor("dms"),
      ),
    },
  ].filter(
    (section) => section.id !== "starred" || section.channels.length > 0,
  );
}
