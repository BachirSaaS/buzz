import { useMemo, useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, PanelsTopLeft, X } from "lucide-react";
import { useProjectsQuery } from "@/features/projects/hooks";
import { buildDirectMessageIntro } from "@/features/channels/lib/dmParticipantDisplay";
import { useUsersBatchQuery } from "@/features/profile/hooks";
import { useFeatureEnabled } from "@/shared/features";
import { Button } from "@/shared/ui/button";
import {
  MAX_CANVAS_WINDOWS,
  type CanvasLayout,
  type CanvasView,
} from "../lib/canvasLayout";
import { CanvasViewPicker, canvasViewIcons } from "./CanvasViewPicker";
import { CanvasWindowContent, type CanvasFeed } from "./CanvasWindowContent";
import "./PulseCanvas.css";
import { canvasWidgets } from "@/features/widgets/CanvasWidgets";
import { buzzWidgetCatalog } from "@/features/widgets/BuzzCanvasWidgets";
import { useCanvasColumns } from "../lib/useCanvasColumns";
import { useFreeformCanvas } from "../lib/useFreeformCanvas";
import { withoutCanvasWindow } from "../lib/freeformCanvas";
import { WorkspaceResizeHandle } from "./WorkspaceResizeHandle";
import { WorkspaceMoveHandle } from "./WorkspaceMoveHandle";

/** A main workspace with up to three independently scrollable companion windows. */
export function PulseCanvas({
  children,
  state,
  save,
  feed,
  currentPubkey,
  onOpen,
  picker,
  setPicker,
  mainMaxWidth,
  mainTitle,
  fixedMain,
}: {
  children: ReactNode;
  state: CanvasLayout;
  save: (state: CanvasLayout) => boolean;
  feed: CanvasFeed;
  currentPubkey?: string;
  onOpen: (view: CanvasView, thread?: string) => void;
  picker: boolean;
  setPicker: (open: boolean) => void;
  mainMaxWidth: number;
  mainTitle: string;
  fixedMain: boolean;
}) {
  const columns = useCanvasColumns(state, save, mainMaxWidth);
  const freeform = useFreeformCanvas(
    columns.ref,
    state,
    save,
    mainMaxWidth,
    fixedMain,
  );
  const [announcement, setAnnouncement] = useState("");
  const projectsEnabled = useFeatureEnabled("projects");
  const projects = useProjectsQuery(projectsEnabled);
  const pubkeys = useMemo(
    () => [
      ...new Set(
        feed.channels
          .filter((channel) => channel.channelType === "dm")
          .flatMap((channel) => channel.participantPubkeys),
      ),
    ],
    [feed.channels],
  );
  const profiles = useUsersBatchQuery(pubkeys, { enabled: pubkeys.length > 0 });
  const views: CanvasView[] = [
    { id: "agents", kind: "agents", title: "Agent activity" },
    { id: "widget:all", kind: "widget", title: "All widgets", target: "all" },
    {
      id: "widget:buzz",
      kind: "widget",
      title: "Buzz widgets",
      target: "buzz",
    },
    ...[...buzzWidgetCatalog, ...canvasWidgets].map(
      (widget): CanvasView => ({
        id: `widget:${widget.id}`,
        kind: "widget",
        title: widget.title,
        target: widget.id,
      }),
    ),
    ...feed.channels.map((channel): CanvasView => {
      const dm = channel.channelType === "dm";
      const name = dm
        ? buildDirectMessageIntro({
            channel,
            currentPubkey,
            profiles: profiles.data?.profiles,
          })?.displayName
        : channel.name;
      return {
        id: `${dm ? "dm" : "channel"}:${channel.id}`,
        kind: dm ? "dm" : "channel",
        title: dm ? name || channel.name : `#${channel.name}`,
        target: channel.id,
      };
    }),
    ...(projectsEnabled ? (projects.data ?? []) : []).map(
      (project): CanvasView => ({
        id: `project:${project.id}`,
        kind: "project",
        title: project.name,
        target: project.id,
      }),
    ),
  ];
  const move = (index: number, offset: number) => {
    const windows = [...state.windows];
    [windows[index], windows[index + offset]] = [
      windows[index + offset],
      windows[index],
    ];
    if (save({ ...state, windows })) setAnnouncement("Window moved.");
  };
  return (
    <div
      ref={columns.ref}
      className="pulse-canvas"
      data-testid="pulse-canvas"
      data-layout={freeform.floating ? "freeform" : state.layout}
      data-fixed-main={fixedMain || undefined}
      data-window-count={state.windows.length}
      data-resizing={columns.resizing || undefined}
    >
      <div
        className="pulse-canvas-grid"
        style={freeform.floating || fixedMain ? undefined : columns.style}
      >
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
            {!fixedMain && (
              <WorkspaceMoveHandle
                aria-label={`Move ${mainTitle} window`}
                {...freeform.gestureProps("main", "move")}
              />
            )}
            <div className="flex min-h-0 flex-1 flex-col">{children}</div>
            {!fixedMain && (
              <WorkspaceResizeHandle
                aria-label="Resize main window"
                {...freeform.gestureProps("main", "resize")}
              />
            )}
          </div>
        </div>
        {state.windows.map((id, index) => {
          const view = views.find((view) => view.id === id);
          const Icon = view ? canvasViewIcons[view.kind] : PanelsTopLeft;
          const title = view?.title ?? "Unavailable view";
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
                fixedMain && !freeform.floating
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
              <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-blockui-lg bg-background shadow-sm">
                <header className="flex min-h-12 shrink-0 flex-wrap items-center gap-1 border-b border-border/50 px-3 py-2">
                  <Icon
                    aria-hidden
                    className="mr-1 size-4 shrink-0 text-muted-foreground"
                  />
                  <h2 className="min-w-0 flex-1 truncate text-sm font-medium">
                    {title}
                  </h2>
                  <div className="ml-auto flex">
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label={`Move ${title} earlier`}
                      title="Move earlier"
                      disabled={index === 0}
                      onClick={() => move(index, -1)}
                    >
                      <ArrowUp aria-hidden className="size-3.5" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label={`Move ${title} later`}
                      title="Move later"
                      disabled={index === state.windows.length - 1}
                      onClick={() => move(index, 1)}
                    >
                      <ArrowDown aria-hidden className="size-3.5" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label={`Close ${title} window`}
                      title="Close window"
                      onClick={() => {
                        if (save(withoutCanvasWindow(state, id))) {
                          setAnnouncement(`${title} closed.`);
                          requestAnimationFrame(() =>
                            document
                              .querySelector<HTMLButtonElement>(
                                '[data-testid="canvas-add-view"]',
                              )
                              ?.focus(),
                          );
                        }
                      }}
                    >
                      <X aria-hidden className="size-4" />
                    </Button>
                  </div>
                </header>
                <div
                  className={
                    view?.kind === "channel" || view?.kind === "dm"
                      ? "flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
                      : "min-h-0 flex-1 overflow-y-auto"
                  }
                >
                  {view ? (
                    <CanvasWindowContent
                      view={view}
                      feed={feed}
                      projects={projects.data ?? []}
                      currentPubkey={currentPubkey}
                      onOpen={onOpen}
                    />
                  ) : (
                    <div className="space-y-3 p-5 text-sm text-muted-foreground">
                      <p>
                        This view is loading, no longer available, or disabled
                        in Settings. You can close it and add another view.
                      </p>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          feed.retry();
                          if (projectsEnabled) void projects.refetch();
                        }}
                      >
                        Try again
                      </Button>
                    </div>
                  )}
                </div>
              </div>
              <WorkspaceMoveHandle
                aria-label={`Move ${title} window`}
                {...freeform.gestureProps(id, "move")}
              />
              <WorkspaceResizeHandle
                aria-label={`Resize ${title} window`}
                {...freeform.gestureProps(id, "resize")}
              />
            </section>
          );
        })}
      </div>
      {!fixedMain &&
        columns.enabled &&
        !freeform.floating &&
        columns.widths
          .slice(1)
          .map((_, index) => (
            <div
              key={state.windows[index]}
              className="pulse-canvas-divider"
              {...columns.separatorProps(index)}
            />
          ))}
      {picker && (
        <CanvasViewPicker
          views={views}
          selected={state.windows}
          onClose={() => setPicker(false)}
          onAdd={(view) => {
            if (
              state.windows.length >= MAX_CANVAS_WINDOWS ||
              state.windows.includes(view.id)
            )
              return;
            if (
              save({
                ...state,
                windows: [...state.windows, view.id],
                ...(state.freeform
                  ? {
                      freeform: {
                        ...state.freeform,
                        order: [
                          ...new Set([
                            ...state.freeform.order,
                            "main",
                            ...state.windows,
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
      )}
      <span role="status" className="sr-only">
        {announcement}
      </span>
    </div>
  );
}
