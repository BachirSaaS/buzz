import { CanvasContentHost } from "./CanvasContentHost";
import type { useWindowCatalog } from "../lib/useWindowCatalog";
import {
  useState,
  useRef,
  useCallback,
  useLayoutEffect,
  useMemo,
  type ReactNode,
  type ReactElement,
  type HTMLAttributes,
} from "react";
import { createPortal } from "react-dom";
import { allowNavigation } from "@/app/navigation/navigationGuard";
import type { PulseAppSelection } from "./PulseAppNavigation";
import { WindowViewSwitcher } from "./WindowViewSwitcher";
import { PanelWorkspace } from "./PanelWorkspace";
import { useCanvasMotion } from "../lib/useCanvasMotion";
import { ParentWindow } from "./ParentWindow";
import { canvasWindowView } from "../lib/canvasWindowView";
import { parentWindowIds } from "../lib/parentWindows";
import { toast } from "sonner";
import { insertConnectedPane, fillCanvasSplit } from "../lib/canvasSplit";
import type { LayoutState, Box } from "../lib/panelLayout";
import { Button } from "@/shared/ui/button";
import {
  addCanvasWindows,
  canvasContentIds,
  type CanvasLayout,
  type CanvasView,
} from "../lib/canvasLayout";
import { CanvasViewPicker, CanvasViewSearch } from "./CanvasViewPicker";
import { CanvasWindowContent, type CanvasFeed } from "./CanvasWindowContent";
import "./PulseCanvas.css";
import { useCanvasColumns } from "../lib/useCanvasColumns";
import { useFreeformCanvas } from "../lib/useFreeformCanvas";
import { withoutCanvasWindow, type WindowCorner } from "../lib/freeformCanvas";
import { WorkspaceResizeHandle } from "./WorkspaceResizeHandle";

/** Workspace-owned windows sharing persistent content across scrolling, tiled and freeform layouts. */
export function PulseCanvas({
  children,
  state,
  catalog,
  save: persist,
  feed,
  currentPubkey,
  onOpen,
  picker,
  setPicker,
  mainMaxWidth,
  mainTitle,
  onSelectApp,
  fixedMain,
}: {
  children: ReactNode;
  state: CanvasLayout;
  catalog: ReturnType<typeof useWindowCatalog>;
  save: (state: CanvasLayout) => boolean;
  feed: CanvasFeed;
  currentPubkey?: string;
  onOpen: (view: CanvasView, thread?: string) => void;
  picker: boolean;
  setPicker: (open: boolean) => void;
  mainMaxWidth: number;
  mainTitle: string;
  onSelectApp?: PulseAppSelection;
  fixedMain: boolean;
}) {
  // Window contents are independent of focus, drag previews and layout. Keep
  // their callbacks stable while committing through the latest canvas snapshot.
  const actions = useRef({ state, persist, onOpen });
  useLayoutEffect(() => {
    actions.current = { state, persist, onOpen };
  });
  const saveRoute = useCallback((id: string, route: Record<string, string>) => {
    const { state, persist } = actions.current;
    return persist({ ...state, routes: { ...state.routes, [id]: route } });
  }, []);
  const openView = useCallback(
    (view: CanvasView, thread?: string) => actions.current.onOpen(view, thread),
    [],
  );
  const {
    channels,
    conversations,
    profiles,
    isLoading,
    error,
    retry,
    refresh,
  } = feed;
  const contentFeed = useMemo(
    () => ({
      channels,
      conversations,
      profiles,
      isLoading,
      error,
      retry,
      refresh,
    }),
    [channels, conversations, profiles, isLoading, error, retry, refresh],
  );
  const parentIds = parentWindowIds(state);
  const independent = {
    ...state,
    windows: parentIds.filter((id) => id !== "main"),
  };
  const savePlacement = (next: CanvasLayout) =>
    persist({ ...next, windows: state.windows });
  const columns = useCanvasColumns(independent, savePlacement, mainMaxWidth);
  const { save, mode: motionMode } = useCanvasMotion(
    columns.ref,
    state,
    persist,
  );
  const hosts = useRef(new Map<string, HTMLDivElement>());
  const contentIds = canvasContentIds(state);
  for (const id of contentIds)
    if (!hosts.current.has(id)) {
      const host = document.createElement("div");
      host.className = "canvas-content-host";
      hosts.current.set(id, host);
    }
  for (const [id] of hosts.current)
    if (!contentIds.includes(id)) {
      hosts.current.delete(id);
    }
  const dockKey = `${fixedMain ? "home" : "workspace"}:${state.layout}`;
  const freeform = useFreeformCanvas(
    columns.ref,
    independent,
    savePlacement,
    mainMaxWidth,
    fixedMain,
  );
  const stacked = state.layout === "focus" && !freeform.floating;
  const stackRef = useRef<HTMLElement>(null);
  const previousWindows = useRef(state.windows);
  useLayoutEffect(() => {
    const added = state.windows.some(
      (id) => !previousWindows.current.includes(id),
    );
    previousWindows.current = state.windows;
    if (stacked && added)
      stackRef.current?.scrollTo({ top: 0, behavior: "instant" });
  }, [stacked, state.windows]);
  const docked =
    !stacked &&
    !freeform.floating &&
    independent.windows.length > (fixedMain ? 1 : 0);
  const [announcement, setAnnouncement] = useState("");
  const [newSplit, setNewSplit] = useState<string | null>(null);
  const views = catalog.views;
  const canSplit = true;
  const splitWindow = (
    owner: string,
    source: string,
    layout: LayoutState,
    bounds: Box,
  ) => {
    if (!canSplit) return;
    if (owner === "main" && fixedMain) {
      setPicker(true);
      return;
    }
    const id = `empty:${crypto.randomUUID()}`;
    const connected = insertConnectedPane(layout, source, id, bounds, 0);
    if (!connected) {
      toast.error(
        "There isn’t enough room for another view. Resize this window and try again.",
      );
      return;
    }
    if (
      save({
        ...state,
        windows: [...state.windows, id],
        interiors: { ...state.interiors, [owner]: connected },
      })
    ) {
      setNewSplit(id);
      setAnnouncement("View added inside this window. Choose its content.");
    }
  };
  const closeWindow = (id: string) => {
    if (save(withoutCanvasWindow(state, id))) {
      setAnnouncement("Window closed.");
      requestAnimationFrame(() =>
        document
          .querySelector<HTMLButtonElement>('[data-testid="canvas-add-view"]')
          ?.focus(),
      );
    }
  };
  const viewFor = (id: string) =>
    canvasWindowView(id, views, state.routes?.[id]);
  const titleFor = (id: string) =>
    id === "main"
      ? mainTitle
      : (viewFor(id)?.title ??
        (id.startsWith("empty:") ? "New view" : "Unavailable view"));
  const titles = new Map(contentIds.map((id) => [id, titleFor(id)]));
  const titleControl = (id: string, trigger?: ReactElement, active = true) => {
    if (id === "main")
      return onSelectApp ? (
        <WindowViewSwitcher
          title={mainTitle}
          onSelect={onSelectApp}
          trigger={trigger}
          active={active}
        />
      ) : undefined;
    return (
      <WindowViewSwitcher
        includeHome={false}
        title={titleFor(id)}
        trigger={trigger}
        active={active}
        onSelect={(app, destination) => {
          if (!allowNavigation({ kind: "route", href: `/pulse?window=${id}` }))
            return false;
          return persist({
            ...state,
            routes: {
              ...state.routes,
              [id]: {
                feed:
                  destination?.feed ??
                  (app === "messages" || app === "home" ? "conversation" : app),
                ...(destination?.conversation
                  ? {
                      conversation: destination.conversation,
                      windowView: "conversation",
                    }
                  : {}),
                ...(destination?.projectId
                  ? { projectId: destination.projectId }
                  : {}),
                ...(destination?.compose
                  ? { compose: destination.compose }
                  : {}),
              },
            },
          });
        }}
      />
    );
  };
  const renderWindow = (
    owner: string,
    headerProps?: HTMLAttributes<HTMLElement>,
    tabs?: ReactNode,
  ) => (
    <ParentWindow
      owner={owner}
      saved={state.interiors?.[owner]}
      hosts={hosts.current}
      titles={titles}
      titleTabs={tabs}
      titleControl={titleControl}
      headerProps={headerProps}
      addBeside={owner === "main" && fixedMain}
      canSplit={canSplit}
      split={splitWindow}
      close={closeWindow}
      save={(id, layout) =>
        save({ ...state, interiors: { ...state.interiors, [id]: layout } })
      }
    />
  );
  const corners = (owner: string) =>
    owner === "main" && fixedMain
      ? null
      : (["nw", "ne", "sw", "se"] as WindowCorner[]).map((corner) => (
          <WorkspaceResizeHandle
            key={corner}
            corner={corner}
            aria-label={`Resize ${titleFor(owner)} window ${corner}`}
            {...freeform.gestureProps(owner, "resize", corner)}
          />
        ));
  const primaryWindow = state.main !== false && (!docked || fixedMain) && (
    <div
      className="pulse-canvas-primary"
      {...(fixedMain ? {} : freeform.frameProps("main"))}
    >
      <div
        className="pulse-canvas-main-window relative flex h-full min-h-0 w-full flex-col"
        style={{
          maxWidth: fixedMain
            ? mainMaxWidth
            : `var(--canvas-main-max, ${mainMaxWidth}px)`,
        }}
        data-canvas-frame="main"
      >
        {fixedMain ? (
          <section
            className="pulse-home-surface flex h-full min-h-0 flex-col"
            data-content-id="main"
            aria-label="Home summary"
          >
            <CanvasContentHost host={hosts.current.get("main")} />
          </section>
        ) : (
          <div className="panel-dock-surface">
            {renderWindow("main", freeform.gestureProps("main", "move"))}
          </div>
        )}
        {corners("main")}
      </div>
    </div>
  );
  return (
    <div
      ref={columns.ref}
      className="pulse-canvas"
      data-testid="pulse-canvas"
      data-layout={freeform.floating ? "freeform" : state.layout}
      data-fixed-main={fixedMain || undefined}
      data-window-count={independent.windows.length}
      data-resizing={columns.resizing || undefined}
    >
      {contentIds.length === 0 && (
        <div
          className="absolute inset-0 flex items-center justify-center"
          data-testid="empty-workspace"
        >
          <Button variant="secondary" onClick={() => setPicker(true)}>
            Add your first window
          </Button>
        </div>
      )}
      <section
        ref={stackRef}
        className="pulse-canvas-grid"
        aria-label={stacked ? "Focus windows" : "Workspace windows"}
        tabIndex={stacked ? 0 : undefined}
        style={freeform.floating || fixedMain ? undefined : columns.style}
      >
        {!stacked && primaryWindow}
        {!docked &&
          independent.windows.map((id, index) => {
            const view = viewFor(id);
            const title = titleFor(id);
            return (
              <section
                key={id}
                aria-label={`${title} window`}
                tabIndex={-1}
                className={`pulse-canvas-window relative flex min-h-0 min-w-0 flex-col rounded-blockui-lg ${view?.kind === "channel" || view?.kind === "dm" ? "pulse-workspace-surface" : ""}`}
                data-testid="canvas-window"
                data-view-id={id}
                data-view-kind={view?.kind}
                data-canvas-frame={id}
                {...freeform.frameProps(id)}
                style={
                  fixedMain && !freeform.floating && !stacked
                    ? {
                        gridColumn:
                          state.layout === "focus" || index % 2 === 1 ? 3 : 1,
                        gridRow:
                          state.layout === "focus"
                            ? index + 1
                            : Math.floor(index / 2) + 1,
                      }
                    : freeform.frameProps(id).style
                }
              >
                <div className="panel-dock-surface">
                  {renderWindow(id, freeform.gestureProps(id, "move"))}
                </div>
                {corners(id)}
              </section>
            );
          })}
        {stacked && primaryWindow}
      </section>
      {!docked &&
        !fixedMain &&
        columns.enabled &&
        !freeform.floating &&
        columns.widths
          .slice(1)
          .map((_, index) => (
            <div
              key={independent.windows[index]}
              className="pulse-canvas-divider"
              {...columns.separatorProps(index)}
            />
          ))}
      {docked && (
        <div className="pulse-canvas-docked">
          <PanelWorkspace
            ids={fixedMain ? independent.windows : parentIds}
            saved={state.panels?.[dockKey]}
            preset={state.layout}
            mainWidth={mainMaxWidth}
            titles={new Map(contentIds.map((id) => [id, titleFor(id)]))}
            renderWindow={renderWindow}
            renderTitleControl={titleControl}
            renderCorners={corners}
            save={(next) =>
              save({ ...state, panels: { ...state.panels, [dockKey]: next } })
            }
          />
        </div>
      )}
      {contentIds.map((id) => {
        const view = viewFor(id);
        const host = hosts.current.get(id);
        if (!host) return null;
        host.toggleAttribute(
          "data-scroll",
          id !== "main" &&
            view?.kind !== "channel" &&
            view?.kind !== "dm" &&
            view?.kind !== "app" &&
            view?.kind !== "project",
        );
        return createPortal(
          id === "main" ? (
            children
          ) : id.startsWith("empty:") && !view ? (
            <section
              className="flex min-h-0 flex-1 flex-col gap-4 p-5"
              aria-label="Choose a split view"
              data-testid="empty-split-view"
            >
              <CanvasViewSearch
                views={views}
                selected={state.windows}
                focusOnMount={newSplit === id}
                onAdd={(view) => {
                  const next = fillCanvasSplit(state, id, view.id);
                  if (next && save(next)) {
                    setNewSplit(null);
                    setAnnouncement(`${view.title} opened in split.`);
                    requestAnimationFrame(() => {
                      const el = [
                        ...(columns.ref.current?.querySelectorAll<HTMLElement>(
                          "[data-content-id]",
                        ) ?? []),
                      ].find((el) => el.dataset.contentId === view.id);
                      el?.focus();
                    });
                  }
                }}
              />
            </section>
          ) : view ? (
            <CanvasWindowContent
              id={id}
              views={views}
              feed={contentFeed}
              route={state.routes?.[id]}
              saveRoute={saveRoute}
              currentPubkey={currentPubkey}
              onOpen={openView}
            />
          ) : (
            <div className="p-5 text-sm">
              <p>This view is unavailable.</p>
              <Button
                variant="ghost"
                onClick={() => {
                  void feed.refresh();
                  void catalog.retry();
                }}
              >
                Try again
              </Button>
            </div>
          ),
          host,
          id,
        );
      })}
      <CanvasViewPicker
        open={picker}
        motionMode={motionMode()}
        views={views}
        selected={state.windows}
        onClose={() => setPicker(false)}
        onAdd={(view) => {
          if (state.windows.includes(view.id)) return;
          if (
            save({
              ...state,
              windows: addCanvasWindows(state, [view.id]),
              ...(state.freeform
                ? {
                    freeform: {
                      ...state.freeform,
                      order: [
                        ...new Set([
                          ...state.freeform.order,
                          ...contentIds,
                          view.id,
                        ]),
                      ],
                    },
                  }
                : {}),
            })
          ) {
            setPicker(false);
            setAnnouncement(`${view.title} added to canvas.`);
          }
        }}
      />
      <span role="status" className="sr-only">
        {announcement}
      </span>
    </div>
  );
}
