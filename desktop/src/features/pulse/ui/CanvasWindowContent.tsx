import { CanvasAppWindow } from "./CanvasAppWindow";
import type { CanvasView } from "../lib/canvasLayout";
import type { useUnifiedPulseFeed } from "../useUnifiedPulseFeed";
import { Button } from "@/shared/ui/button";
import { ConversationCard } from "./ConversationCard";
import { CanvasWidgets } from "@/features/widgets/CanvasWidgets";
import { PulseChannelDetail } from "./PulseChannelDetail";

export type CanvasFeed = ReturnType<typeof useUnifiedPulseFeed>;

/** Live companions sharing the main workspace's conversation UI and authorized data. */
export function CanvasWindowContent({
  view,
  feed,
  route,
  saveRoute,
  currentPubkey,
  onOpen,
}: {
  view: CanvasView;
  feed: CanvasFeed;
  route?: Record<string, string>;
  saveRoute: (route: Record<string, string>) => boolean;
  currentPubkey?: string;
  onOpen: (view: CanvasView, thread?: string) => void;
}) {
  if (view.kind === "app" || view.kind === "project")
    return (
      <CanvasAppWindow
        view={view}
        route={route}
        saveRoute={saveRoute}
        feed={feed}
        currentPubkey={currentPubkey}
      />
    );
  if (view.kind === "channel" || view.kind === "dm")
    return (
      <PulseChannelDetail
        independent
        channelId={view.target}
        channel={feed.channels.find((channel) => channel.id === view.target)}
      />
    );
  if (view.kind === "widget")
    return (
      <CanvasWidgets
        target={view.target}
        feed={feed}
        currentPubkey={currentPubkey}
        onOpen={onOpen}
      />
    );
  const conversations = feed.conversations
    .filter((item) =>
      view.kind === "agents" ? item.isAgent : item.channel?.id === view.target,
    )
    .slice(0, 20);
  return (
    <>
      <div className="flex items-center justify-between px-5 py-3 text-xs text-muted-foreground">
        <span>
          {view.kind === "agents"
            ? "Recent agent conversations"
            : "Recent conversations"}
        </span>
        <span>From your feed</span>
      </div>
      {feed.error && (
        <div role="alert" className="px-5 pb-3 text-sm">
          Activity may be incomplete.{" "}
          <Button size="sm" variant="link" onClick={feed.retry}>
            Try again
          </Button>
        </div>
      )}
      {feed.isLoading && !conversations.length ? (
        <p role="status" className="p-5 text-sm text-muted-foreground">
          Loading activity…
        </p>
      ) : conversations.length ? (
        conversations.map((item) => (
          <ConversationCard
            key={item.id}
            item={item}
            profiles={feed.profiles}
            currentPubkey={currentPubkey}
            divider
            onRefresh={() => void feed.refresh()}
            onOpenContext={() => {
              if (item.channel)
                onOpen(
                  {
                    id: `channel:${item.channel.id}`,
                    title: item.channel.name,
                    kind: item.channel.channelType === "dm" ? "dm" : "channel",
                    target: item.channel.id,
                  },
                  item.rootId,
                );
            }}
          />
        ))
      ) : (
        !feed.error && (
          <div className="px-6 py-12 text-center">
            <p className="text-sm font-medium">No recent activity loaded</p>
            <p className="mt-2 text-sm text-muted-foreground">
              Open the full view to explore its history. New conversations
              appear as this feed updates.
            </p>
            <Button
              className="mt-4"
              size="sm"
              variant="outline"
              onClick={() => onOpen(view)}
            >
              Open {view.kind === "agents" ? "agents" : "conversation"}
            </Button>
          </div>
        )
      )}
    </>
  );
}
