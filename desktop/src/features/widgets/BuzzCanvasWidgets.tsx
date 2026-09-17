import type { CanvasFeed } from "@/features/pulse/ui/CanvasWindowContent";
import type { CanvasView } from "@/features/pulse/lib/canvasLayout";
import type { PulseConversation } from "@/features/pulse/lib/unifiedFeed";
import { CommunicationWidget, type CommunicationRow } from "./BuzzWidgets";
import { LiveAgentWidget } from "./LiveAgentWidget";
import { LiveHuddleWidget } from "./LiveHuddleWidget";

/** Communication widget IDs share the existing canvas persistence contract. */
export const buzzWidgetCatalog = [
  { id: "agent-activity", title: "Agent activity" },
  { id: "huddle", title: "Huddle" },
  { id: "mentions", title: "Mentions" },
  { id: "conversations", title: "Conversations" },
  { id: "channels", title: "Active channels" },
] as const;

/** Live adapters use the authorized Pulse feed; no fixture fallback enters the app. */
export function BuzzCanvasWidget({
  id,
  feed,
  currentPubkey,
  onOpen,
}: {
  id: string;
  feed: CanvasFeed;
  currentPubkey?: string;
  onOpen: (view: CanvasView, thread?: string) => void;
}) {
  if (id === "agent-activity")
    return <LiveAgentWidget channels={feed.channels} />;
  if (id === "huddle")
    return (
      <LiveHuddleWidget
        channels={feed.channels}
        currentPubkey={currentPubkey}
      />
    );
  const open = (item: PulseConversation) => {
    if (item.channel)
      onOpen(
        {
          id: `${item.channel.channelType === "dm" ? "dm" : "channel"}:${item.channel.id}`,
          kind: item.channel.channelType === "dm" ? "dm" : "channel",
          title: item.channel.name,
          target: item.channel.id,
        },
        item.rootId,
      );
  };
  const channelTitle = (item: PulseConversation) =>
    item.channel?.channelType === "dm"
      ? "Direct conversation"
      : `#${item.channel?.name ?? ""}`;
  const row = (
    item: PulseConversation,
    isChannel = false,
  ): CommunicationRow => {
    const message =
      id === "mentions"
        ? [...item.messages]
            .reverse()
            .find((message) =>
              message.tags?.some(
                (tag) =>
                  tag[0] === "p" &&
                  tag[1]?.toLowerCase() === currentPubkey?.toLowerCase(),
              ),
            )
        : item.messages.at(-1);
    return {
      id: item.id,
      title: isChannel ? channelTitle(item) : message?.author || "Conversation",
      context: isChannel
        ? `${item.channel?.memberCount ?? 0} members`
        : channelTitle(item),
      body: message?.body.slice(0, 200) || "Open conversation",
      avatar: isChannel ? null : message?.avatarUrl,
      initials: isChannel ? "#" : undefined,
      onOpen: () => open(item),
    };
  };
  const conversations = feed.conversations.filter((item) => item.channel);
  const common = {
    loading: feed.isLoading,
    error: Boolean(feed.error),
    onRetry: feed.retry,
  };
  if (id === "mentions")
    return (
      <CommunicationWidget
        title="Mentions"
        headline="You’re in the conversation."
        rows={conversations
          .filter((item) => item.isMention)
          .slice(0, 3)
          .map((item) => row(item))}
        empty="No mentions in your recent conversations."
        {...common}
      />
    );
  if (id === "conversations")
    return (
      <CommunicationWidget
        title="Conversations"
        headline="Pick up where you left off."
        rows={conversations.slice(0, 3).map((item) => row(item))}
        empty="Your recent conversations will appear here."
        {...common}
      />
    );
  const seen = new Set<string>();
  const channelRows = conversations
    .filter((item) => {
      if (
        !item.channel ||
        item.channel.channelType === "dm" ||
        seen.has(item.channel.id)
      )
        return false;
      seen.add(item.channel.id);
      return true;
    })
    .slice(0, 3)
    .map((item) => row(item, true));
  return (
    <CommunicationWidget
      title="Active channels"
      headline="Around your workspace."
      rows={channelRows}
      empty="No recent channel conversations."
      {...common}
    />
  );
}
