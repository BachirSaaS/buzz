import {
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  type RefObject,
} from "react";
import {
  canvasContentIds,
  type CanvasFrame,
  type CanvasLayout,
} from "./canvasLayout";
import {
  captureCanvasFrames,
  defaultCanvasFrame,
  fitCanvasFrame,
  resizeCanvasFrame,
  type CanvasBounds,
  type WindowCorner,
} from "./freeformCanvas";
type Placement = NonNullable<CanvasLayout["freeform"]>;
type Gesture = "move" | "resize";
type Drag = {
  key: string;
  id: string;
  kind: Gesture;
  corner: WindowCorner;
  pointer: number;
  x: number;
  y: number;
  initial: CanvasFrame;
  original: Placement;
  placement: Placement;
  moved: boolean;
  cursor: string;
  select: string;
};

/** Parent windows move as units. Stable canvas capture survives tiled-to-floating reparenting. */
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
  const ids = canvasContentIds(state),
    windowKey = state.windows.join(",");
  const key = `${fixedMain}:${state.layout}:${windowKey}:${mainMax}:${bounds.width}:${bounds.height}`;
  const floating = state.layout === "freeform" || preview !== null;
  const placement = drag.current?.placement ?? preview ?? state.freeform;
  const frontId = front?.windows === windowKey ? front.id : null;
  const order = [...new Set([...(placement?.order ?? []), ...ids])].filter(
    (id) => ids.includes(id) && id !== frontId,
  );
  if (frontId && ids.includes(frontId)) order.push(frontId);
  const callbacks = useRef({
    cancel: () => {},
    move: (_e: globalThis.PointerEvent) => {},
    finish: (_e: globalThis.PointerEvent) => {},
  });
  const bringForward = (id: string) => setFront({ id, windows: windowKey });
  const fit = (frame: CanvasFrame) => fitCanvasFrame(frame, bounds);
  const frameFor = (id: string) =>
    fit(
      placement?.frames[id] ??
        defaultCanvasFrame(ids.indexOf(id), bounds, mainMax),
    );
  const capture = (id: string): Placement => {
    const frames = captureCanvasFrames(ref.current);
    if (fixedMain) {
      delete frames.main;
      if (state.freeform?.frames.main) frames.main = state.freeform.frames.main;
    }
    return { frames, order: [...order.filter((other) => other !== id), id] };
  };
  const change = (
    kind: Gesture,
    initial: CanvasFrame,
    dx: number,
    dy: number,
    corner: WindowCorner,
  ) =>
    kind === "move"
      ? fit({ ...initial, x: initial.x + dx, y: initial.y + dy })
      : resizeCanvasFrame(initial, dx, dy, corner, bounds);
  const paint = (id: string, frame: CanvasFrame) => {
    const element = [
      ...(ref.current?.querySelectorAll<HTMLElement>("[data-floating-frame]") ??
        []),
    ].find((el) => el.dataset.floatingFrame === id);
    if (element)
      Object.assign(element.style, {
        left: `${frame.x}px`,
        top: `${frame.y}px`,
        width: `${frame.width}px`,
        height: `${frame.height}px`,
      });
  };
  const commit = (next: Placement) =>
    save({ ...state, layout: "freeform", freeform: next });
  function clean(current: Drag) {
    document.body.style.cursor = current.cursor;
    document.body.style.userSelect = current.select;
    if (ref.current?.hasPointerCapture(current.pointer))
      ref.current.releasePointerCapture(current.pointer);
  }
  function cancel() {
    const current = drag.current;
    if (!current) return;
    drag.current = null;
    clean(current);
    if (current.original.frames[current.id])
      paint(current.id, current.original.frames[current.id]);
    setPreview(null);
  }
  function move(event: globalThis.PointerEvent) {
    const current = drag.current;
    if (!current || current.pointer !== event.pointerId) return;
    if (current.key !== key) {
      cancel();
      return;
    }
    const dx = event.clientX - current.x,
      dy = event.clientY - current.y;
    if (!current.moved && Math.hypot(dx, dy) < 6) return;
    const frame = change(current.kind, current.initial, dx, dy, current.corner);
    current.placement = {
      ...current.placement,
      frames: { ...current.placement.frames, [current.id]: frame },
    };
    if (!current.moved) {
      current.moved = true;
      ref.current?.setPointerCapture(current.pointer);
      document.body.style.cursor =
        current.kind === "move"
          ? "grabbing"
          : current.corner === "nw" || current.corner === "se"
            ? "nwse-resize"
            : "nesw-resize";
      document.body.style.userSelect = "none";
      setPreview(current.placement);
    }
    paint(current.id, frame);
  }
  function finish(event: globalThis.PointerEvent) {
    const current = drag.current;
    if (!current || current.pointer !== event.pointerId) return;
    drag.current = null;
    clean(current);
    if (current.moved && current.key === key && !commit(current.placement))
      paint(current.id, current.initial);
    setPreview(null);
  }
  callbacks.current = { cancel, move, finish };
  useLayoutEffect(() => {
    if (drag.current && drag.current.key !== key) callbacks.current.cancel();
  }, [key]);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => {
      callbacks.current.cancel();
      setBounds({ width: element.clientWidth, height: element.clientHeight });
    };
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    measure();
    const cancel = () => callbacks.current.cancel();
    const move = (e: globalThis.PointerEvent) => callbacks.current.move(e);
    const up = (e: globalThis.PointerEvent) => callbacks.current.finish(e);
    const lost = (e: globalThis.PointerEvent) => {
      if (drag.current?.pointer === e.pointerId && e.target === element)
        cancel();
    };
    const pointerCancel = (e: globalThis.PointerEvent) => {
      if (drag.current?.pointer === e.pointerId) cancel();
    };
    const key = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape" && drag.current) {
        e.preventDefault();
        cancel();
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", pointerCancel);
    window.addEventListener("lostpointercapture", lost);
    window.addEventListener("blur", cancel);
    window.addEventListener("keydown", key);
    return () => {
      observer.disconnect();
      cancel();
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", pointerCancel);
      window.removeEventListener("lostpointercapture", lost);
      window.removeEventListener("blur", cancel);
      window.removeEventListener("keydown", key);
    };
  }, [ref]);
  return {
    floating,
    dragging: preview !== null,
    frameProps(id: string) {
      const frame = frameFor(id);
      return {
        "data-floating-frame": id,
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
    gestureProps(id: string, kind: Gesture, corner: WindowCorner = "se") {
      return {
        "data-canvas-gesture": kind,
        onPointerDown(event: PointerEvent<HTMLElement>) {
          if (event.button !== 0 || !event.isPrimary || drag.current) return;
          if (
            kind === "move" &&
            event.target instanceof Element &&
            event.target.closest("button,input,a,select,textarea")
          )
            return;
          const next = capture(id),
            initial = next.frames[id];
          if (!initial) return;
          event.preventDefault();
          event.currentTarget.focus();
          drag.current = {
            key,
            id,
            kind,
            corner,
            pointer: event.pointerId,
            x: event.clientX,
            y: event.clientY,
            initial,
            original: next,
            placement: next,
            moved: false,
            cursor: document.body.style.cursor,
            select: document.body.style.userSelect,
          };
          bringForward(id);
        },
        onKeyDown(event: KeyboardEvent<HTMLElement>) {
          if (
            event.target !== event.currentTarget ||
            event.altKey ||
            event.ctrlKey ||
            event.metaKey ||
            drag.current
          )
            return;
          const step = event.shiftKey ? 40 : 10;
          const dx =
              event.key === "ArrowLeft"
                ? -step
                : event.key === "ArrowRight"
                  ? step
                  : 0,
            dy =
              event.key === "ArrowUp"
                ? -step
                : event.key === "ArrowDown"
                  ? step
                  : 0;
          if (!dx && !dy) return;
          event.preventDefault();
          const next = capture(id);
          if (!next.frames[id]) return;
          next.frames[id] = change(kind, next.frames[id], dx, dy, corner);
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
