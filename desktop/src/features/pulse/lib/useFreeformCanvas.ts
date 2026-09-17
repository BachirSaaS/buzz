import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  type RefObject,
} from "react";
import type { CanvasFrame, CanvasLayout } from "./canvasLayout";
import {
  captureCanvasFrames,
  defaultCanvasFrame,
  fitCanvasFrame,
  type CanvasBounds,
} from "./freeformCanvas";

type Gesture = "move" | "resize";
type Placement = NonNullable<CanvasLayout["freeform"]>;
type Drag = {
  key: string;
  id: string;
  kind: Gesture;
  pointerId: number;
  x: number;
  y: number;
  initial: CanvasFrame;
  placement: Placement;
  moved: boolean;
};

/** Independent floating windows; preview gestures immediately and persist once on release. */
export function useFreeformCanvas(
  ref: RefObject<HTMLDivElement | null>,
  state: CanvasLayout,
  save: (next: CanvasLayout) => boolean,
  mainMax: number,
  fixedMain = false,
) {
  const [bounds, setBounds] = useState<CanvasBounds>({ width: 0, height: 0 });
  const [preview, setPreview] = useState<Placement | null>(null);
  const [front, setFront] = useState<{ id: string; windows: string } | null>(
    null,
  );
  const drag = useRef<Drag | null>(null);
  const ids = ["main", ...state.windows];
  const windowKey = state.windows.join(",");
  // A new window must supersede the previous temporary focus order immediately.
  const frontId = front?.windows === windowKey ? front.id : null;
  const bringForward = (id: string) => setFront({ id, windows: windowKey });
  const key = `${fixedMain}:${state.layout}:${state.windows.join(",")}:${mainMax}:${bounds.width}:${bounds.height}`;
  const latestKey = useRef(key);
  latestKey.current = key;
  const floating = state.layout === "freeform" || preview !== null;
  const placement = preview ?? state.freeform;
  const order = [...new Set([...(placement?.order ?? []), ...ids])].filter(
    (id) => ids.includes(id) && id !== frontId,
  );
  if (frontId && ids.includes(frontId)) order.push(frontId);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () =>
      setBounds({ width: element.clientWidth, height: element.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  useEffect(() => {
    if (drag.current && drag.current.key !== key) {
      drag.current = null;
      setPreview(null);
    }
  }, [key]);
  const dragging = preview !== null;
  useEffect(() => {
    if (!dragging) return;
    const cursor = document.body.style.cursor;
    const selection = document.body.style.userSelect;
    document.body.style.cursor =
      drag.current?.kind === "move" ? "grabbing" : "nwse-resize";
    document.body.style.userSelect = "none";
    const cancel = () => {
      drag.current = null;
      setPreview(null);
    };
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        cancel();
      }
    };
    window.addEventListener("blur", cancel);
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.cursor = cursor;
      document.body.style.userSelect = selection;
      window.removeEventListener("blur", cancel);
      window.removeEventListener("keydown", onKey);
    };
  }, [dragging]);

  const fit = (frame: CanvasFrame) => fitCanvasFrame(frame, bounds);
  const frameFor = (id: string) =>
    fit(
      placement?.frames[id] ??
        defaultCanvasFrame(ids.indexOf(id), bounds, mainMax),
    );
  const capture = (id: string): Placement => {
    const frames = captureCanvasFrames(ref.current);
    // Home's fixed frame must never overwrite another app's saved placement.
    if (fixedMain) {
      delete frames.main;
      if (state.freeform?.frames.main) frames.main = state.freeform.frames.main;
    }
    return { frames, order: [...order.filter((window) => window !== id), id] };
  };
  const change = (
    kind: Gesture,
    initial: CanvasFrame,
    dx: number,
    dy: number,
  ) =>
    fit(
      kind === "move"
        ? { ...initial, x: initial.x + dx, y: initial.y + dy }
        : {
            ...initial,
            width: Math.min(bounds.width - initial.x, initial.width + dx),
            height: Math.min(bounds.height - initial.y, initial.height + dy),
          },
    );
  const commit = (next: Placement) =>
    save({ ...state, layout: "freeform", freeform: next });

  function finish(event: PointerEvent<HTMLButtonElement>, cancel = false) {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    drag.current = null;
    if (!cancel && current.moved && current.key === latestKey.current)
      commit(current.placement);
    setPreview(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
  }

  return {
    floating,
    dragging,
    frameProps(id: string) {
      const frame = frameFor(id);
      return {
        style:
          floating && bounds.width > 0
            ? ({
                position: "absolute",
                left: frame.x,
                top: frame.y,
                width: frame.width,
                height: frame.height,
                zIndex: order.indexOf(id) + 1,
              } as CSSProperties)
            : undefined,
        onPointerDownCapture: () => {
          if (floating) bringForward(id);
        },
        onFocusCapture: () => {
          if (floating) bringForward(id);
        },
      };
    },
    gestureProps(id: string, kind: Gesture) {
      return {
        "data-canvas-gesture": kind,
        onPointerDown(event: PointerEvent<HTMLButtonElement>) {
          if (event.button !== 0 || !event.isPrimary) return;
          event.preventDefault();
          event.currentTarget.focus();
          event.currentTarget.setPointerCapture(event.pointerId);
          const next = capture(id);
          const initial = next.frames[id];
          if (!initial) return;
          drag.current = {
            key,
            id,
            kind,
            pointerId: event.pointerId,
            x: event.clientX,
            y: event.clientY,
            initial,
            placement: next,
            moved: false,
          };
          bringForward(id);
          setPreview(next);
        },
        onPointerMove(event: PointerEvent<HTMLButtonElement>) {
          const current = drag.current;
          if (
            !current ||
            current.pointerId !== event.pointerId ||
            current.key !== key
          )
            return;
          const dx = event.clientX - current.x;
          const dy = event.clientY - current.y;
          if (!current.moved && Math.hypot(dx, dy) < 3) return;
          current.moved = true;
          current.placement = {
            ...current.placement,
            frames: {
              ...current.placement.frames,
              [id]: change(kind, current.initial, dx, dy),
            },
          };
          setPreview(current.placement);
        },
        onPointerUp: (event: PointerEvent<HTMLButtonElement>) => finish(event),
        onPointerCancel: (event: PointerEvent<HTMLButtonElement>) =>
          finish(event, true),
        onLostPointerCapture: (event: PointerEvent<HTMLButtonElement>) =>
          finish(event, true),
        onKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
          if (event.altKey || event.ctrlKey || event.metaKey || drag.current)
            return;
          const step = event.shiftKey ? 40 : 10;
          const dx =
            event.key === "ArrowLeft"
              ? -step
              : event.key === "ArrowRight"
                ? step
                : 0;
          const dy =
            event.key === "ArrowUp"
              ? -step
              : event.key === "ArrowDown"
                ? step
                : 0;
          if (!dx && !dy) return;
          event.preventDefault();
          const next = capture(id);
          if (!next.frames[id]) return;
          next.frames[id] = change(kind, next.frames[id], dx, dy);
          bringForward(id);
          commit(next);
        },
        onDoubleClick:
          kind === "resize"
            ? () => {
                if (!floating) return;
                const next = capture(id);
                next.frames[id] = defaultCanvasFrame(
                  ids.indexOf(id),
                  bounds,
                  mainMax,
                );
                commit(next);
              }
            : undefined,
      };
    },
  };
}
