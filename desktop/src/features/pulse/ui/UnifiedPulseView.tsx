import { PulseWorkspaceNavigation } from "./PulseWorkspaceNavigation";
import { usePulseWorkspaces } from "../lib/usePulseWorkspaces";
import { useWindowCatalog } from "../lib/useWindowCatalog";
import { WORKSPACE_ROUTE_KEYS } from "../lib/pulseWorkspaces";
import { PulseCanvasControls } from "./PulseCanvasControls";
import { ArrowUp, Inbox, Search } from "lucide-react";
import * as React from "react";
import { TerminalSurfaceContext } from "@/features/terminal/TerminalSurfaceContext";
import { useTerminalPanel } from "@/features/terminal/terminalPanelStore";
import { useUnifiedPulseFeed } from "@/features/pulse/useUnifiedPulseFeed";
import {
  matchesPulseFilter,
  type PulseConversation,
} from "@/features/pulse/lib/unifiedFeed";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Skeleton } from "@/shared/ui/skeleton";
import { VirtualizedList } from "@/shared/ui/VirtualizedList";
import { ConversationCard } from "./ConversationCard";
import {
  isPulseWorkspacePage,
  type PulseView,
  CLEAR_WORKSPACE_PANELS,
} from "../lib/workspaceNavigation";
import type {
  PulseApp,
  PulseNavigationDestination,
} from "./PulseAppNavigation";
import { PulseWorkspaceFrame } from "./PulseWorkspaceFrame";
import { PulseWorkspacePage } from "./PulseWorkspacePage";
import { PulseCombinedView } from "./PulseCombinedView";
import { CLEAR_CONVERSATION_PANELS } from "../lib/pulsePanelState";
import { useHistorySearchState } from "@/shared/hooks/useHistorySearchState";
import { allowNavigation } from "@/app/navigation/navigationGuard";
import { useAppShell } from "@/app/AppShellContext";
import { buildHomeBriefing, type BriefingKind } from "../lib/pulseBriefing";
import { PulseBriefing } from "./PulseBriefing";
import { buildSummaryInput } from "../lib/pulseSummary";
import { usePulseSummary } from "../usePulseSummary";
import { useRelayOrigin } from "@/shared/lib/useRelayOrigin";
import type { CanvasView } from "../lib/canvasLayout";
import { PulseCanvas } from "./PulseCanvas";

const FEED_SEARCH_KEYS = ["workspace", ...WORKSPACE_ROUTE_KEYS] as const;
const NO_CONVERSATIONS: PulseConversation[] = [];

export function UnifiedPulseView({
  currentPubkey,
}: {
  currentPubkey?: string;
}) {
  const feed = useUnifiedPulseFeed(currentPubkey);
  // Catalog subscriptions and metadata survive canvas remounts on space changes.
  const catalog = useWindowCatalog();
  const relayOrigin = useRelayOrigin();
  const canvasScope =
    relayOrigin && currentPubkey ? `${relayOrigin}:${currentPubkey}` : null;
  const [canvasPicker, setCanvasPicker] = React.useState(false);
  const reads = useAppShell();
  const [briefingFilter, setBriefingFilter] =
    React.useState<BriefingKind | null>(null);
  const { values, applyPatch } = useHistorySearchState(FEED_SEARCH_KEYS);
  const workspaces = usePulseWorkspaces(canvasScope, values, applyPatch);
  const canvas = {
    state: workspaces.active.canvas,
    save: workspaces.saveCanvas,
  };
  // biome-ignore lint/correctness/useExhaustiveDependencies: A picker belongs to the workspace that opened it.
  React.useEffect(() => {
    setCanvasPicker(false);
  }, [workspaces.active.id]);
  const terminal = React.useContext(TerminalSurfaceContext);
  const terminalPanel = useTerminalPanel();
  const expanded =
    terminalPanel.mode !== "closed" ||
    Boolean(
      values.channelManagement ||
        values.profile ||
        values.profilePersona ||
        values.agentSession,
    );
  const filter: PulseView =
    workspaces.active.id === "home"
      ? "home"
      : isPulseWorkspacePage(values.feed)
        ? values.feed
        : values.feed === "search"
          ? "search"
          : values.feed && values.feed !== "all" && values.feed !== "home"
            ? "conversation"
            : "home";
  React.useEffect(() => {
    if (values.feed === "dm" || values.feed === "channel") {
      applyPatch(
        {
          feed: "conversation",
          conversation: values.feed === "dm" ? values.dm : values.channel,
          dm: null,
          channel: null,
        },
        { replace: true },
      );
    }
  }, [values.feed, values.dm, values.channel, applyPatch]);
  const setFilter = (next: PulseView) => {
    if (!allowNavigation({ kind: "route", href: `/pulse?feed=${next}` }))
      return false;
    applyPatch({
      ...CLEAR_CONVERSATION_PANELS,
      ...CLEAR_WORKSPACE_PANELS,
      feed: next,
    });
    setBriefingFilter(null);
    return true;
  };
  const activeApp: PulseApp = isPulseWorkspacePage(filter)
    ? filter
    : filter === "home"
      ? "home"
      : "messages";
  const selectApp = (
    app: PulseApp,
    destination?: PulseNavigationDestination,
  ) => {
    const next =
      destination?.feed ?? (app === "messages" ? "conversation" : app);
    if (!setFilter(next)) return false;
    applyPatch({
      conversation:
        destination?.conversation ??
        (destination?.compose ? null : values.conversation),
      projectId: destination?.projectId ?? null,
      compose: destination?.compose ?? null,
    });
    return true;
  };
  const [search, setSearch] = React.useState("");
  const [scrollElement, setScrollElement] =
    React.useState<HTMLDivElement | null>(null);
  // Split views replace the scroll host. Notify the virtualizer after the new
  // host attaches, including when cached feed content mounts in the same commit.
  const scrollRef = React.useMemo(
    () => ({ current: scrollElement }),
    [scrollElement],
  );
  // Freeze order, not content: edits/deletions update, new conversations wait.
  const [accepted, setAccepted] = React.useState<{
    scope: string;
    ids: string[];
  } | null>(null);
  const ids = React.useMemo(
    () => feed.conversations.map((item) => item.id),
    [feed.conversations],
  );
  const acceptedIds = accepted?.scope === feed.scope ? accepted.ids : ids;
  React.useEffect(() => {
    if (feed.query.isSuccess && accepted?.scope !== feed.scope)
      setAccepted({
        scope: feed.scope,
        ids: feed.conversations.map((item) => item.id),
      });
  }, [accepted?.scope, feed.scope, feed.query.isSuccess, feed.conversations]);
  const newCount = React.useMemo(() => {
    const acceptedSet = new Set(acceptedIds);
    return ids.filter((id) => !acceptedSet.has(id)).length;
  }, [ids, acceptedIds]);
  React.useEffect(() => {
    if (newCount > 0 && (!scrollElement || scrollElement.scrollTop <= 24)) {
      setAccepted({
        scope: feed.scope,
        ids: feed.conversations.map((item) => item.id),
      });
    }
  }, [feed.conversations, feed.scope, newCount, scrollElement]);
  const byId = React.useMemo(
    () => new Map(feed.conversations.map((item) => [item.id, item])),
    [feed.conversations],
  );
  const acceptedConversations = React.useMemo(
    () =>
      acceptedIds
        .map((id) => byId.get(id))
        .filter((item): item is PulseConversation => Boolean(item)),
    [acceptedIds, byId],
  );
  // The feed's focused poll supplies time updates; geometry/focus changes do
  // not need to rescan every message or reconstruct a model request.
  const minute = Math.floor(Date.now() / 60_000);
  const viewerName =
    feed.profiles[currentPubkey ?? ""]?.displayName ?? undefined;
  const needsBriefing =
    canvas.state.main !== false &&
    (filter === "home" || (filter === "search" && briefingFilter !== null));
  const briefingConversations = needsBriefing
    ? feed.conversations
    : NO_CONVERSATIONS;
  const summaryInput = React.useMemo(
    () =>
      buildSummaryInput(
        briefingConversations,
        currentPubkey ?? "",
        reads,
        `${currentPubkey}:${feed.scope}`,
        minute * 60,
        viewerName,
      ),
    [
      briefingConversations,
      currentPubkey,
      reads,
      feed.scope,
      minute,
      viewerName,
    ],
  );
  const summary = usePulseSummary(
    summaryInput,
    canvas.state.main !== false &&
      filter === "home" &&
      !feed.isLoading &&
      Boolean(currentPubkey),
  );
  const generatedBriefing = React.useMemo(
    () =>
      (summary.data ?? []).filter((group) =>
        [...group.ids].every((id) => byId.has(id)),
      ),
    [summary.data, byId],
  );
  const briefing = React.useMemo(
    () =>
      generatedBriefing.length
        ? generatedBriefing
        : buildHomeBriefing(
            briefingConversations,
            currentPubkey,
            reads,
            minute * 60,
          ),
    [generatedBriefing, briefingConversations, currentPubkey, reads, minute],
  );
  const focusedIds = briefing.find(
    (group) => group.kind === briefingFilter,
  )?.ids;
  const visible = React.useMemo(
    () =>
      acceptedConversations
        .filter((item) => filter !== "conversation" || Boolean(item.channel))
        .filter((item) =>
          matchesPulseFilter(
            item,
            "all",
            false,
            false,
            filter === "search" ? search : "",
          ),
        )
        .filter(
          (item) =>
            filter !== "search" || !briefingFilter || focusedIds?.has(item.id),
        ),
    [acceptedConversations, filter, search, briefingFilter, focusedIds],
  );
  const showLatest = () => {
    setAccepted({ scope: feed.scope, ids });
    scrollRef.current?.scrollTo({ top: 0 });
  };
  const refresh = async () => {
    const result = await feed.query.refetch();
    if (result.isSuccess) setAccepted(null);
  };
  const feedContent = (
    <>
      {newCount > 0 && (
        <div className="sticky top-16 z-10 flex justify-center py-3">
          <Button
            className="gap-2 rounded-full shadow-lg"
            size="sm"
            onClick={showLatest}
          >
            <ArrowUp aria-hidden className="size-3.5" />
            {newCount} new conversations
          </Button>
        </div>
      )}
      {feed.isLoading ? (
        <div role="status" aria-label="Loading feed" className="space-y-8 p-7">
          {[0, 1, 2].map((id) => (
            <div key={id} className="flex gap-3">
              <Skeleton className="size-9 rounded-full" />
              <div className="flex-1 space-y-3">
                <Skeleton className="h-3 w-32" />
                <Skeleton className="h-16 w-full" />
              </div>
            </div>
          ))}
        </div>
      ) : visible.length ? (
        <VirtualizedList
          items={visible}
          getItemKey={(item) => item.id}
          estimateSize={260}
          scrollRef={scrollRef}
          renderItem={(item) => (
            <ConversationCard
              item={item}
              divider={filter === "conversation"}
              currentPubkey={currentPubkey}
              profiles={feed.profiles}
              onRefresh={() => void refresh()}
            />
          )}
        />
      ) : (
        !feed.error && (
          <div className="px-6 py-20 text-center">
            <Inbox
              aria-hidden
              className="mx-auto mb-4 size-7 text-muted-foreground/60"
            />
            <h2 className="text-base font-medium">A little quiet here</h2>
            <p className="mx-auto mt-2 max-w-xs text-sm text-muted-foreground">
              {search || filter !== "home" || briefingFilter
                ? "No conversations match these filters. Try another view or search term."
                : "Messages from your selected channels, DMs, and people you follow will appear here."}
            </p>
            {(search || filter !== "home" || briefingFilter) && (
              <Button
                variant="outline"
                size="sm"
                className="mt-5 rounded-full"
                onClick={() => {
                  setFilter("search");
                  setSearch("");
                }}
              >
                Clear filters
              </Button>
            )}
          </div>
        )
      )}
      <footer className="px-6 py-7 text-center text-2xs text-muted-foreground">
        Recent activity · Updates live while focused
        <br />
        Private conversations stay private. Replies go to their original thread.
      </footer>
    </>
  );
  const content = (
    <>
      {filter === "search" && (
        <div className="px-5 py-5 sm:px-7">
          <div className="relative w-full">
            <Search
              aria-hidden
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              type="search"
              aria-label="Search loaded feed"
              placeholder="Search this feed"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-11 w-full rounded-xl border-0 bg-muted/30 pl-10 text-sm shadow-none"
            />
          </div>
          {briefingFilter && (
            <Button
              variant="ghost"
              size="sm"
              className="mt-2"
              onClick={() => setBriefingFilter(null)}
            >
              Show all activity
            </Button>
          )}
        </div>
      )}
      {filter === "home" && (
        <PulseBriefing
          groups={briefing}
          conversations={byId}
          profiles={feed.profiles}
          currentPubkey={currentPubkey}
          onSelect={(kind) => {
            if (!setFilter("search")) return;
            setBriefingFilter(kind);
            setAccepted({ scope: feed.scope, ids });
            setSearch("");
            scrollRef.current?.scrollTo({ top: 0 });
          }}
          loading={feed.isLoading && !briefing.length}
          hasError={Boolean(feed.error)}
          summaryError={Boolean(summary.error)}
          summarizing={summary.isFetching}
          onRetrySummary={() => void summary.refetch()}
          onRetry={() => {
            feed.retry();
          }}
        />
      )}
      {filter !== "home" && feed.error && (
        <div
          role="alert"
          className="m-5 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm"
        >
          <p>Some activity couldn’t be loaded. Your feed may be out of date.</p>
          <Button
            size="sm"
            variant="outline"
            className="mt-2"
            onClick={feed.retry}
          >
            Try again
          </Button>
        </div>
      )}
      {filter !== "home" ? feedContent : null}
    </>
  );
  return (
    <PulseWorkspaceNavigation>
      <PulseWorkspaceFrame
        active={activeApp}
        workspaces={workspaces}
        expanded={expanded}
        testId="unified-pulse"
        viewControls={
          <PulseCanvasControls
            key={`${canvasScope}:${workspaces.active.id}`}
            state={canvas.state}
            save={canvas.save}
            onAdd={() => setCanvasPicker(true)}
            canAdd={Boolean(currentPubkey)}
          />
        }
        renderCanvas={(main) => (
          <PulseCanvas
            key={`${canvasScope}:${workspaces.active.id}`}
            mainMaxWidth={activeApp === "home" ? 720 : 960}
            fixedMain={activeApp === "home" && canvas.state.main !== false}
            onSelectApp={
              workspaces.active.id === "home" ? undefined : selectApp
            }
            mainTitle={activeApp.charAt(0).toUpperCase() + activeApp.slice(1)}
            state={canvas.state}
            catalog={catalog}
            save={canvas.save}
            feed={feed}
            currentPubkey={currentPubkey}
            picker={canvasPicker}
            setPicker={setCanvasPicker}
            onOpen={(view: CanvasView, thread) => {
              if (
                !setFilter(
                  view.kind === "project"
                    ? "projects"
                    : view.kind === "agents"
                      ? "agents"
                      : "conversation",
                )
              )
                return;
              applyPatch(
                view.kind === "project"
                  ? { projectId: view.target ?? null }
                  : view.kind === "agents"
                    ? {}
                    : {
                        conversation: view.target ?? null,
                        thread: thread ?? null,
                      },
              );
            }}
          >
            {main}
          </PulseCanvas>
        )}
      >
        <div className="pulse-conversation-workspace flex min-h-0 flex-1">
          <div
            className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
            data-testid="pulse-scroll-area"
          >
            {isPulseWorkspacePage(filter) ? (
              <PulseWorkspacePage page={filter} />
            ) : filter === "home" ? (
              <div
                ref={setScrollElement}
                className="pulse-home-scroll min-h-0 flex-1 overflow-y-auto"
                data-testid="pulse-home"
              >
                {content}
              </div>
            ) : (
              <PulseCombinedView
                channels={feed.channels}
                conversations={feed.conversations}
                currentPubkey={currentPubkey}
                scrollRef={setScrollElement}
                view={filter}
                onSelectView={setFilter}
              >
                {content}
              </PulseCombinedView>
            )}
          </div>
          <div
            className="pulse-terminal-side-host"
            data-testid="pulse-terminal-panel"
          >
            {terminal}
          </div>
        </div>
      </PulseWorkspaceFrame>
    </PulseWorkspaceNavigation>
  );
}
