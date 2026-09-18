import {
  useMemo,
  useRef,
  type ReactNode,
  type ReactElement,
  type HTMLAttributes,
} from "react";
import { Tabs } from "@base-ui/react/tabs";
import { Separator } from "@base-ui/react/separator";
import { Action } from "@/shared/ui/action";
import type { LayoutState } from "../lib/panelLayout";
import { measureLayout, reconcilePanels } from "../lib/panelLayout";
import { separatorStyle, usePanelGestures } from "../lib/usePanelGestures";
import "./PanelWorkspace.css";

/** Absolute placements from a nested split tree, with independent tab identities. */
export function PanelWorkspace({
  ids,
  saved,
  preset,
  mainWidth,
  titles,
  renderWindow,
  renderCorners,
  renderTitleControl,
  save,
}: {
  ids: string[];
  saved?: LayoutState;
  preset: string;
  mainWidth: number;
  titles: Map<string, string>;
  renderWindow: (
    owner: string,
    headerProps: HTMLAttributes<HTMLElement>,
    tabs?: ReactNode,
  ) => ReactNode;
  renderCorners: (owner: string) => ReactNode;
  renderTitleControl: (
    id: string,
    trigger: ReactElement,
    active: boolean,
  ) => ReactNode;
  save: (state: LayoutState) => boolean;
}) {
  const root = useRef<HTMLDivElement>(null);
  const identity = JSON.stringify(ids);
  const layout = useMemo(
    () =>
      reconcilePanels(
        saved,
        JSON.parse(identity) as string[],
        preset,
        mainWidth,
        root.current?.clientWidth || window.innerWidth - 32,
      ),
    [saved, identity, preset, mainWidth],
  );
  const gestures = usePanelGestures(root, layout, save);
  const measured = measureLayout(layout.root, gestures.bounds, 8);
  return (
    <div
      ref={root}
      className="panel-dock-stage"
      data-testid="panel-workspace"
      onClickCapture={gestures.onClickCapture}
    >
      {layout.groups.map((group) => (
        <section
          key={group.id}
          data-pane={group.id}
          data-canvas-frame={group.selected}
          data-testid={
            group.tabs.includes("main") ? undefined : "canvas-window"
          }
          data-view-id={group.selected}
          tabIndex={-1}
          aria-label={`${titles.get(group.selected) ?? group.selected} window`}
          className="panel-dock-placement"
          ref={(el) => {
            if (el) gestures.elements.current.set(group.id, el);
            else gestures.elements.current.delete(group.id);
          }}
        >
          <Tabs.Root
            value={group.selected}
            onValueChange={(value) => gestures.select(group.id, String(value))}
            className="panel-dock-surface"
          >
            {group.tabs.map((tab) => (
              <Tabs.Panel
                className="panel-dock-content"
                value={tab}
                key={tab}
                keepMounted
              >
                {renderWindow(
                  tab,
                  {
                    onPointerDown: (event) => gestures.begin(group.id, event),
                    onKeyDown: (event) => {
                      if (event.target === event.currentTarget)
                        gestures.moveKey(group.id, event);
                    },
                  },
                  group.tabs.length > 1 ? (
                    <Tabs.List
                      className="panel-dock-tabs"
                      aria-label="Window tabs"
                      activateOnFocus
                    >
                      {group.tabs.map((id) => {
                        const trigger = (
                          <Tabs.Tab
                            key={id}
                            value={id}
                            className={`panel-dock-tab text-sm${id === group.selected ? " window-view-switch-trigger" : ""}`}
                            data-tab-id={id}
                            onPointerDown={(event) => {
                              event.stopPropagation();
                              gestures.begin(group.id, event, id, true);
                            }}
                          >
                            {titles.get(id) ?? "Unavailable view"}
                          </Tabs.Tab>
                        );
                        return (
                          <span className="contents" key={id}>
                            {renderTitleControl(
                              id,
                              trigger,
                              id === group.selected,
                            ) ?? trigger}
                          </span>
                        );
                      })}
                    </Tabs.List>
                  ) : (
                    renderTitleControl(
                      tab,
                      <Action
                        className="panel-window-title window-view-switch-trigger text-sm font-medium"
                        aria-label={`Switch view, ${titles.get(tab) ?? "Unavailable view"}`}
                        data-tab-id={tab}
                        onPointerDown={(event) => {
                          event.stopPropagation();
                          gestures.begin(group.id, event, tab, true);
                        }}
                      >
                        {titles.get(tab) ?? "Unavailable view"}
                      </Action>,
                      true,
                    )
                  ),
                )}
              </Tabs.Panel>
            ))}
          </Tabs.Root>
          {renderCorners(group.selected)}
        </section>
      ))}
      {measured.splits.map((split, index) => (
        <Separator
          key={split.id}
          ref={(el) => {
            if (el) gestures.separators.current.set(split.id, el);
            else gestures.separators.current.delete(split.id);
          }}
          className="panel-dock-divider"
          data-axis={split.axis}
          orientation={split.axis === "horizontal" ? "vertical" : "horizontal"}
          tabIndex={0}
          aria-label={`Resize split ${index + 1}`}
          aria-valuemin={Math.round(split.minRatio * 100)}
          aria-valuemax={Math.round(split.maxRatio * 100)}
          aria-valuenow={Math.round(split.ratio * 100)}
          aria-valuetext={`${Math.round(split.ratio * 100)} percent`}
          style={separatorStyle(split)}
          {...gestures.separatorProps(split)}
        />
      ))}
      <div
        ref={gestures.ghost}
        className="panel-dock-ghost text-sm"
        hidden
        aria-hidden
        data-testid="panel-tab-ghost"
      />
      <div
        ref={gestures.marker}
        className="panel-dock-marker"
        hidden
        aria-hidden
        data-testid="panel-tab-marker"
      />
      <div
        ref={gestures.edgeCue}
        className="panel-dock-edge"
        hidden
        aria-hidden
        data-testid="panel-edge-cue"
      />
      <span role="status" className="sr-only">
        {gestures.announcement}
      </span>
    </div>
  );
}
