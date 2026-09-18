import { useCallback, useMemo, useState } from "react";
import {
  NavigationHandlerContext,
  type AppNavigationTarget,
} from "@/app/navigation/NavigationTargetContext";
import { allowNavigation } from "@/app/navigation/navigationGuard";
import { LocalHistorySearchContext } from "@/shared/hooks/LocalHistorySearchProvider";
import { VirtualizedList } from "@/shared/ui/VirtualizedList";
import { matchesPulseFilter } from "../lib/unifiedFeed";
import { Input } from "@/shared/ui/input";
import { Button } from "@/shared/ui/button";
import { workspaceRoute } from "../lib/pulseWorkspaces";
import {
  isPulseWorkspacePage,
  workspaceNavigationTarget,
  CLEAR_WORKSPACE_PANELS,
} from "../lib/workspaceNavigation";
import { CLEAR_CONVERSATION_PANELS } from "../lib/pulsePanelState";
import type { CanvasView } from "../lib/canvasLayout";
import type { CanvasFeed } from "./CanvasWindowContent";
import { PulseWorkspacePage } from "./PulseWorkspacePage";
import { PulseCombinedView } from "./PulseCombinedView";
import { ConversationCard } from "./ConversationCard";

/** Full app surfaces with navigation and selected content owned by this window. */
export function CanvasAppWindow({
  view,
  route,
  saveRoute,
  feed,
  currentPubkey,
}: {
  view: CanvasView;
  route?: Record<string, string>;
  saveRoute: (route: Record<string, string>) => boolean;
  feed: CanvasFeed;
  currentPubkey?: string;
}) {
  const [scrollElement, setScrollElement] = useState<HTMLDivElement | null>(
    null,
  );
  const scrollRef = useMemo(
    () => ({ current: scrollElement }),
    [scrollElement],
  );
  const values =
    route ??
    (view.kind === "project"
      ? { feed: "projects", projectId: view.target ?? "" }
      : { feed: view.target ?? "conversation" });
  const applyPatch = useCallback(
    (patch: Partial<Record<string, string | null>>) => {
      const next = { ...values };
      for (const [key, value] of Object.entries(patch)) {
        if (value === null) delete next[key];
        else if (value !== undefined) next[key] = value;
      }
      return saveRoute(next);
    },
    [values, saveRoute],
  );
  const local = useMemo(() => ({ values, applyPatch }), [values, applyPatch]);
  const navigate = useCallback(
    (target: AppNavigationTarget) => {
      const next = workspaceNavigationTarget(
        target,
        values.conversation ?? null,
      );
      if (next.to !== "/pulse") return undefined;
      if (!allowNavigation({ kind: "route", href: `/pulse?window=${view.id}` }))
        return false;
      const patch = workspaceRoute(next.search ?? {});
      return applyPatch({
        ...CLEAR_CONVERSATION_PANELS,
        ...CLEAR_WORKSPACE_PANELS,
        ...patch,
      });
    },
    [values.conversation, view.id, applyPatch],
  );
  const page = values.feed ?? "conversation";
  const query = values.windowSearch ?? "";
  const conversations = feed.conversations.filter(
    (item) =>
      Boolean(item.channel) &&
      matchesPulseFilter(
        item,
        "all",
        false,
        false,
        page === "search" ? query : "",
      ),
  );
  return (
    <LocalHistorySearchContext.Provider value={local}>
      <NavigationHandlerContext.Provider value={navigate}>
        {isPulseWorkspacePage(page) ? (
          <PulseWorkspacePage page={page} />
        ) : (
          <PulseCombinedView
            channels={feed.channels}
            conversations={feed.conversations}
            currentPubkey={currentPubkey}
            scrollRef={setScrollElement}
            view={page === "search" ? "search" : "conversation"}
            onSelectView={(next) =>
              applyPatch({ ...CLEAR_CONVERSATION_PANELS, feed: next })
            }
          >
            {page === "search" && (
              <div className="p-4">
                <Input
                  aria-label="Search this window"
                  placeholder="Search messages…"
                  value={query}
                  onChange={(event) =>
                    applyPatch({ windowSearch: event.target.value })
                  }
                />
              </div>
            )}
            {feed.error && (
              <div role="alert" className="p-4 text-sm">
                Activity couldn’t be loaded.{" "}
                <Button variant="link" onClick={feed.retry}>
                  Try again
                </Button>
              </div>
            )}
            {feed.isLoading && !conversations.length && (
              <p role="status" className="p-5 text-sm text-muted-foreground">
                Loading messages…
              </p>
            )}
            {
              <VirtualizedList
                items={conversations}
                getItemKey={(item) => item.id}
                estimateSize={260}
                scrollRef={scrollRef}
                renderItem={(item) => (
                  <ConversationCard
                    item={item}
                    profiles={feed.profiles}
                    currentPubkey={currentPubkey}
                    divider
                    onRefresh={() => void feed.refresh()}
                    onOpenContext={() =>
                      item.channel &&
                      navigate({
                        to: "/channels/$channelId",
                        params: { channelId: item.channel.id },
                        search: { thread: item.rootId },
                      })
                    }
                  />
                )}
              />
            }
            {!feed.isLoading && !feed.error && !conversations.length && (
              <p className="p-5 text-sm text-muted-foreground">
                No messages found.
              </p>
            )}
          </PulseCombinedView>
        )}
      </NavigationHandlerContext.Provider>
    </LocalHistorySearchContext.Provider>
  );
}
