import { useMemo, useRef, type ReactNode, type HTMLAttributes } from "react";
import { Separator } from "@base-ui/react/separator";
import {
  initialLayout,
  measureLayout,
  type LayoutState,
  type Box,
} from "../lib/panelLayout";
import { usePanelGestures, separatorStyle } from "../lib/usePanelGestures";
import { WindowToolbar } from "./WindowToolbar";
import { CanvasContentHost } from "./CanvasContentHost";

/** A parent owns one continuous surface and any number of flush internal views. */
export function ParentWindow({
  owner,
  saved,
  hosts,
  titles,
  titleTabs,
  titleControl,
  headerProps,
  canSplit,
  addBeside,
  split,
  close,
  save,
}: {
  owner: string;
  saved?: LayoutState;
  hosts: Map<string, HTMLDivElement>;
  titles: Map<string, string>;
  titleTabs?: ReactNode;
  titleControl?: (id: string) => ReactNode;
  headerProps?: HTMLAttributes<HTMLElement>;
  canSplit: boolean;
  addBeside?: boolean;
  split: (
    owner: string,
    source: string,
    layout: LayoutState,
    bounds: Box,
  ) => void;
  close: (id: string) => void;
  save: (owner: string, layout: LayoutState) => boolean;
}) {
  const root = useRef<HTMLDivElement>(null);
  const layout = useMemo(() => saved ?? initialLayout([owner]), [saved, owner]);
  const gestures = usePanelGestures(
    root,
    layout,
    (next) => save(owner, next),
    0,
  );
  const measured = measureLayout(layout.root, gestures.bounds, 0);
  return (
    <div
      ref={root}
      className="parent-window-interior"
      data-parent-interior={owner}
    >
      {layout.groups.map((group) => {
        const id = group.selected,
          title = titles.get(id) ?? "Unavailable view";
        return (
          <section
            key={group.id}
            className="parent-window-view"
            data-content-id={id}
            tabIndex={-1}
            aria-label={`${title} view`}
            ref={(el) => {
              if (el) gestures.elements.current.set(group.id, el);
              else gestures.elements.current.delete(group.id);
            }}
          >
            <WindowToolbar
              title={title}
              canSplit={canSplit}
              addBeside={addBeside}
              onSplit={() => split(owner, group.id, layout, gestures.bounds)}
              onClose={id === "main" ? undefined : () => close(id)}
              {...headerProps}
            >
              {(id === owner ? titleTabs : undefined) ?? titleControl?.(id)}
            </WindowToolbar>
            <CanvasContentHost host={hosts.get(id)} />
          </section>
        );
      })}
      {measured.splits.map((s, index) => (
        <Separator
          key={s.id}
          className="panel-dock-divider parent-window-divider"
          data-axis={s.axis}
          orientation={s.axis === "horizontal" ? "vertical" : "horizontal"}
          tabIndex={0}
          aria-label={`Resize connected views ${index + 1}`}
          aria-valuemin={Math.round(s.minRatio * 100)}
          aria-valuemax={Math.round(s.maxRatio * 100)}
          aria-valuenow={Math.round(s.ratio * 100)}
          style={separatorStyle(s, 0)}
          ref={(el) => {
            if (el) gestures.separators.current.set(s.id, el);
            else gestures.separators.current.delete(s.id);
          }}
          {...gestures.separatorProps(s)}
        />
      ))}
      <span role="status" className="sr-only">
        {gestures.announcement}
      </span>
    </div>
  );
}
