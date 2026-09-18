import {
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointer,
  type RefObject,
} from "react";
import {
  measureLayout,
  fitsLayout,
  splitPane,
  type Edge,
  resizeSplit,
  type Box,
  type LayoutState,
  type SplitBox,
} from "./panelLayout";
import { panelDropTarget, type PanelDrop } from "./panelDropTarget";

type Drag = {
  pointer: number;
  handle: HTMLElement;
  source: string;
  tab?: string;
  startX: number;
  startY: number;
  offsetX: number;
  offsetY: number;
  original: LayoutState;
  start: Box;
  moved: boolean;
  proposal?: PanelDrop;
  lastSwap?: string;
};
type Resize = {
  pointer: number;
  handle: HTMLElement;
  split: SplitBox;
  start: number;
  original: LayoutState;
};
/** Ref-driven gesture previews; only completed semantic changes reach persistence/React. */
export function usePanelGestures(
  root: RefObject<HTMLDivElement | null>,
  layout: LayoutState,
  commit: (next: LayoutState) => boolean,
  gap = 8,
) {
  const [bounds, setBounds] = useState<Box>({
    x: 0,
    y: 0,
    width: 0,
    height: 0,
  });
  const [announcement, announce] = useState("");
  const state = useRef(layout),
    committed = useRef(layout);
  const geometry = useRef(bounds);
  const elements = useRef(new Map<string, HTMLElement>());
  const separators = useRef(new Map<string, HTMLElement>());
  const boxes = useRef(new Map<string, Box>());
  const ghost = useRef<HTMLDivElement>(null),
    marker = useRef<HTMLDivElement>(null),
    edgeCue = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null),
    resize = useRef<Resize | null>(null);
  const bodyStyle = useRef<{ cursor: string; userSelect: string } | null>(null);
  const suppressClick = useRef(false);
  const focusFrame = useRef<number | undefined>(undefined);
  const clickTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const callbacks = useRef({
    cancel: (_silent = false) => {},
    paint: (_instant = false) => {},
    move: (_event: PointerEvent) => {},
    finish: (_event: PointerEvent) => {},
    lost: (_event: PointerEvent) => {},
  });
  committed.current = layout;

  function paint(instant = false) {
    const result = measureLayout(state.current.root, geometry.current, gap);
    boxes.current = result.panes;
    for (const [id, box] of result.panes) {
      const el = elements.current.get(id);
      if (!el) continue;
      if (instant) el.style.transition = "none";
      el.style.width = `${box.width}px`;
      el.style.height = `${box.height}px`;
      if (
        !drag.current?.moved ||
        drag.current.source !== id ||
        drag.current.tab
      )
        el.style.transform = `translate(${box.x}px, ${box.y}px)`;
    }
    for (const split of result.splits) {
      const el = separators.current.get(split.id);
      if (!el) continue;
      Object.assign(el.style, separatorStyle(split, gap));
      el.setAttribute("aria-valuenow", String(Math.round(split.ratio * 100)));
      el.setAttribute(
        "aria-valuetext",
        `${Math.round(split.ratio * 100)} percent`,
      );
      el.setAttribute(
        "aria-valuemin",
        String(Math.round(split.minRatio * 100)),
      );
      el.setAttribute(
        "aria-valuemax",
        String(Math.round(split.maxRatio * 100)),
      );
    }
    if (instant && root.current) {
      void root.current.offsetWidth;
      for (const el of elements.current.values())
        el.style.removeProperty("transition");
    }
  }
  function lock(cursor: string) {
    bodyStyle.current ??= {
      cursor: document.body.style.cursor,
      userSelect: document.body.style.userSelect,
    };
    document.body.style.cursor = cursor;
    document.body.style.userSelect = "none";
  }
  function clean() {
    for (const signal of [ghost, marker, edgeCue])
      if (signal.current) signal.current.hidden = true;
    if (root.current) {
      delete root.current.dataset.dragging;
      delete root.current.dataset.resizing;
    }
    for (const el of elements.current.values()) {
      delete el.dataset.dragging;
      delete el.dataset.frontmost;
    }
    if (bodyStyle.current)
      Object.assign(document.body.style, bodyStyle.current);
    bodyStyle.current = null;
  }
  function release(active: Drag | Resize) {
    if (active.handle.hasPointerCapture(active.pointer))
      active.handle.releasePointerCapture(active.pointer);
  }
  function cancel(silent = false) {
    const active = drag.current ?? resize.current;
    if (!active) return;
    state.current = active.original;
    drag.current = null;
    resize.current = null;
    clean();
    release(active);
    paint(!!("split" in active));
    if (!silent) announce("Layout change cancelled.");
  }
  function save(next: LayoutState, message: string) {
    state.current = commit(next) ? next : committed.current;
    paint(true);
    if (state.current === next) announce(message);
  }
  function finish(event: PointerEvent) {
    const active = drag.current ?? resize.current;
    if (!active || active.pointer !== event.pointerId) return;
    const moving = drag.current,
      resizing = resize.current;
    drag.current = null;
    resize.current = null;
    clean();
    release(active);
    if (resizing) {
      if (state.current !== resizing.original)
        save(state.current, "Split resized.");
      return;
    }
    if (!moving) return;
    if (!moving.moved) {
      if (moving.tab) select(moving.source, moving.tab);
      return;
    }
    suppressClick.current = true;
    clearTimeout(clickTimer.current);
    clickTimer.current = setTimeout(() => {
      suppressClick.current = false;
    }, 0);
    const next = moving.proposal?.next ?? state.current;
    if (next !== moving.original)
      save(
        next,
        moving.proposal?.type === "combine"
          ? "Tab combined."
          : moving.proposal?.type === "split"
            ? "Pane split."
            : "Panes swapped.",
      );
    else paint(false);
    if (moving.tab) {
      cancelAnimationFrame(focusFrame.current ?? 0);
      focusFrame.current = requestAnimationFrame(() => {
        const tab = [
          ...(root.current?.querySelectorAll<HTMLElement>("[data-tab-id]") ??
            []),
        ].find(
          (el) =>
            el.dataset.tabId === moving.tab && el.getClientRects().length > 0,
        );
        tab?.focus({ preventScroll: true });
      });
    }
  }
  function move(event: PointerEvent) {
    const resizing = resize.current;
    if (resizing?.pointer === event.pointerId) {
      const s = resizing.split;
      const delta =
        (s.axis === "horizontal" ? event.clientX : event.clientY) -
        resizing.start;
      const extent = (s.axis === "horizontal" ? s.width : s.height) - gap;
      const ratio =
        extent > 0
          ? Math.max(s.minRatio, Math.min(s.maxRatio, s.ratio + delta / extent))
          : s.ratio;
      state.current = {
        ...resizing.original,
        root: resizeSplit(resizing.original.root, s.id, ratio),
      };
      paint(true);
      return;
    }
    const active = drag.current,
      container = root.current;
    if (!active || !container || active.pointer !== event.pointerId) return;
    const dx = event.clientX - active.startX,
      dy = event.clientY - active.startY;
    if (!active.moved && Math.hypot(dx, dy) < 6) return;
    active.moved = true;
    if (!active.handle.hasPointerCapture(active.pointer))
      active.handle.setPointerCapture(active.pointer);
    lock("grabbing");
    container.dataset.dragging = "true";
    const origin = container.getBoundingClientRect(),
      x = event.clientX - origin.left,
      y = event.clientY - origin.top;
    if (marker.current) marker.current.hidden = true;
    if (edgeCue.current) edgeCue.current.hidden = true;
    if (active.tab && ghost.current) {
      ghost.current.hidden = false;
      ghost.current.style.transform = `translate(${x - active.offsetX}px, ${y - active.offsetY}px)`;
    } else {
      const el = elements.current.get(active.source);
      if (el) {
        el.dataset.dragging = "true";
        el.dataset.frontmost = "true";
        el.style.transform = `translate(${active.start.x + dx}px, ${active.start.y + dy}px)`;
      }
    }
    const headers = new Map(
      [...elements.current].map(([id, el]) => [
        id,
        el.querySelector(".panel-dock-header")?.getBoundingClientRect()
          .height ?? 0,
      ]),
    );
    const proposal = panelDropTarget(
      state.current,
      boxes.current,
      headers,
      geometry.current,
      active.source,
      active.tab,
      x,
      y,
      dx,
      dy,
      active.lastSwap,
    );
    active.proposal = proposal?.type === "swap" ? undefined : proposal;
    if (!proposal) {
      active.lastSwap = undefined;
      return;
    }
    if (proposal.type === "swap") {
      active.lastSwap = proposal.target;
      state.current = proposal.next;
      paint();
      return;
    }
    const target = boxes.current.get(proposal.target);
    if (!target) return;
    if (proposal.type === "combine" && marker.current) {
      const tab = elements.current
        .get(proposal.target)
        ?.querySelector('[role="tab"]:last-child')
        ?.getBoundingClientRect();
      marker.current.hidden = false;
      marker.current.style.left = `${tab ? tab.right - origin.left + 3 : target.x + 16}px`;
      marker.current.style.top = `${target.y + 8}px`;
      marker.current.style.height = "24px";
    } else if (edgeCue.current && proposal.edge) {
      const e = proposal.edge;
      edgeCue.current.hidden = false;
      edgeCue.current.dataset.edge = e;
      edgeCue.current.style.left = `${e === "left" ? target.x : e === "right" ? target.x + target.width : target.x + target.width / 2}px`;
      edgeCue.current.style.top = `${e === "top" ? target.y : e === "bottom" ? target.y + target.height : target.y + target.height / 2}px`;
    }
  }
  callbacks.current = {
    cancel,
    paint,
    move,
    finish,
    lost: (event) => {
      const active = drag.current ?? resize.current;
      if (active?.pointer === event.pointerId && event.target === active.handle)
        cancel();
    },
  };
  useLayoutEffect(() => {
    callbacks.current.cancel();
    state.current = layout;
    callbacks.current.paint(true);
  }, [layout]);
  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    const measure = () => {
      const next = {
        x: 0,
        y: 0,
        width: el.clientWidth,
        height: el.clientHeight,
      };
      if (
        next.width === geometry.current.width &&
        next.height === geometry.current.height
      )
        return;
      callbacks.current.cancel();
      geometry.current = next;
      setBounds(next);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    measure();
    const cancel = () => callbacks.current.cancel();
    const pointerCancel = (event: PointerEvent) => {
      if ((drag.current ?? resize.current)?.pointer === event.pointerId)
        cancel();
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape" && (drag.current || resize.current)) {
        event.preventDefault();
        cancel();
      }
    };
    const move = (event: PointerEvent) => callbacks.current.move(event),
      up = (event: PointerEvent) => callbacks.current.finish(event),
      lost = (event: PointerEvent) => callbacks.current.lost(event);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", pointerCancel);
    window.addEventListener("lostpointercapture", lost);
    window.addEventListener("blur", cancel);
    window.addEventListener("keydown", key);
    return () => {
      observer.disconnect();
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", pointerCancel);
      window.removeEventListener("lostpointercapture", lost);
      window.removeEventListener("blur", cancel);
      window.removeEventListener("keydown", key);
      callbacks.current.cancel(true);
      clearTimeout(clickTimer.current);
      cancelAnimationFrame(focusFrame.current ?? 0);
    };
  }, [root]);
  useLayoutEffect(() => {
    geometry.current = bounds;
    callbacks.current.paint(true);
  }, [bounds]);
  function begin(
    source: string,
    event: ReactPointer<HTMLElement>,
    tab?: string,
    exterior = false,
  ) {
    if (
      event.button !== 0 ||
      !event.isPrimary ||
      drag.current ||
      resize.current
    )
      return;
    const box = boxes.current.get(source),
      el = elements.current.get(source);
    if (!box || !el || !root.current) return;
    const target = event.target instanceof Element ? event.target : null;
    if (
      !tab &&
      !exterior &&
      target?.closest("button,select,input,a,summary,[role=tab]")
    )
      return;
    const tabBox = tab
      ? target?.closest("[data-tab-id]")?.getBoundingClientRect()
      : undefined;
    drag.current = {
      pointer: event.pointerId,
      handle: event.currentTarget,
      source,
      tab,
      startX: event.clientX,
      startY: event.clientY,
      offsetX: tabBox ? event.clientX - tabBox.left : 0,
      offsetY: tabBox ? event.clientY - tabBox.top : 0,
      original: state.current,
      start: box,
      moved: false,
    };
    if (tab && tabBox && ghost.current) {
      ghost.current.textContent = target?.textContent ?? "";
      ghost.current.style.width = `${tabBox.width}px`;
      ghost.current.style.height = `${tabBox.height}px`;
    }
  }
  function select(id: string, tab: string) {
    if (drag.current || resize.current) return;
    if (state.current.groups.find((g) => g.id === id)?.selected === tab) return;
    save(
      {
        ...state.current,
        groups: state.current.groups.map((g) =>
          g.id === id && g.tabs.includes(tab) ? { ...g, selected: tab } : g,
        ),
      },
      "Tab selected.",
    );
    // Each mounted panel owns a toolbar; move focus into the newly visible copy.
    const selected = state.current.groups.find(
      (group) => group.id === id,
    )?.selected;
    cancelAnimationFrame(focusFrame.current ?? 0);
    focusFrame.current = requestAnimationFrame(() => {
      const target = [
        ...(elements.current
          .get(id)
          ?.querySelectorAll<HTMLElement>("[data-tab-id]") ?? []),
      ].find(
        (el) => el.dataset.tabId === selected && el.getClientRects().length > 0,
      );
      target?.focus({ preventScroll: true });
    });
  }
  return {
    bounds,
    announcement,
    elements,
    separators,
    ghost,
    marker,
    edgeCue,
    begin,
    select,
    moveKey(source: string, event: React.KeyboardEvent) {
      if (
        drag.current ||
        resize.current ||
        event.altKey ||
        event.metaKey ||
        event.ctrlKey
      )
        return;
      const edge = (
        {
          ArrowLeft: "left",
          ArrowRight: "right",
          ArrowUp: "top",
          ArrowDown: "bottom",
        } as Record<string, Edge>
      )[event.key];
      if (!edge) return;
      event.preventDefault();
      const own = boxes.current.get(source);
      if (!own) return;
      const neighbors = [...boxes.current]
        .filter(([id]) => id !== source)
        .sort(
          ([, a], [, b]) =>
            Math.hypot(a.x - own.x, a.y - own.y) -
            Math.hypot(b.x - own.x, b.y - own.y),
        );
      const target = neighbors[0]?.[0];
      if (!target) return;
      const next = splitPane(state.current, source, target, edge);
      if (next && fitsLayout(next, geometry.current, gap))
        save(next, "Pane moved.");
    },
    onClickCapture(event: React.MouseEvent) {
      if (suppressClick.current) {
        event.preventDefault();
        event.stopPropagation();
      }
    },
    separatorProps(split: SplitBox) {
      return {
        onPointerDown(event: ReactPointer<HTMLElement>) {
          if (
            event.button !== 0 ||
            !event.isPrimary ||
            drag.current ||
            resize.current
          )
            return;
          event.preventDefault();
          event.currentTarget.focus();
          resize.current = {
            pointer: event.pointerId,
            handle: event.currentTarget,
            split,
            start: split.axis === "horizontal" ? event.clientX : event.clientY,
            original: state.current,
          };
          if (root.current) root.current.dataset.resizing = "true";
          lock(split.axis === "horizontal" ? "col-resize" : "row-resize");
          event.currentTarget.setPointerCapture(event.pointerId);
        },
        onKeyDown(event: React.KeyboardEvent) {
          if (
            drag.current ||
            resize.current ||
            event.altKey ||
            event.metaKey ||
            event.ctrlKey
          )
            return;
          const decrease =
              split.axis === "horizontal" ? "ArrowLeft" : "ArrowUp",
            increase = split.axis === "horizontal" ? "ArrowRight" : "ArrowDown";
          if (![decrease, increase, "Home", "End"].includes(event.key)) return;
          event.preventDefault();
          const ratio =
            event.key === "Home"
              ? split.minRatio
              : event.key === "End"
                ? split.maxRatio
                : split.ratio +
                  (event.key === decrease ? -1 : 1) *
                    (event.shiftKey ? 0.1 : 0.03);
          save(
            {
              ...state.current,
              root: resizeSplit(
                state.current.root,
                split.id,
                Math.max(split.minRatio, Math.min(split.maxRatio, ratio)),
              ),
            },
            "Split resized.",
          );
        },
      };
    },
  };
}
/** Split geometry is authoritative for both hit areas and visible dividers. */
export function separatorStyle(split: SplitBox, gap = 8) {
  return split.axis === "horizontal"
    ? {
        left: `${split.x + Math.max(0, split.width - gap) * split.ratio + gap / 2}px`,
        top: `${split.y}px`,
        height: `${split.height}px`,
      }
    : {
        left: `${split.x}px`,
        top: `${split.y + Math.max(0, split.height - gap) * split.ratio + gap / 2}px`,
        width: `${split.width}px`,
      };
}
