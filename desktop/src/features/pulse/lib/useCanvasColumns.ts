import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import type { CanvasLayout } from "./canvasLayout";
import {
  CANVAS_GAP,
  CANVAS_STACK_WIDTH,
  canvasColumnWidths,
  resizeCanvasColumns,
} from "./canvasColumns";

/** Pointer and keyboard resizing with one durable write per completed gesture. */
export function useCanvasColumns(
  state: CanvasLayout,
  save: (next: CanvasLayout) => boolean,
  mainMax: number,
) {
  const ref = useRef<HTMLDivElement>(null);
  const [available, setAvailable] = useState(0);
  const [preview, setPreview] = useState<{
    key: string;
    widths: number[];
  } | null>(null);
  const drag = useRef<{
    key: string;
    pointerId: number;
    startX: number;
    initial: number[];
    widths: number[];
  } | null>(null);
  const count = state.layout === "columns" ? state.windows.length + 1 : 2;
  const key = `${state.layout}:${state.windows.join(",")}:${mainMax}:${available}`;
  const currentKey = useRef(key);
  currentKey.current = key;
  const resizing = preview?.key === key;
  const enabled =
    (state.layout === "columns" || state.layout === "grid") &&
    state.windows.length > 0 &&
    available > CANVAS_STACK_WIDTH;
  const widths = resizing
    ? preview.widths
    : canvasColumnWidths(
        available,
        count,
        mainMax,
        state.widths?.[state.layout],
      );

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) =>
      setAvailable(entry.contentRect.width),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (drag.current?.key !== key) drag.current = null;
    setPreview((current) => (current?.key === key ? current : null));
  }, [key]);

  useEffect(() => {
    if (!resizing) return;
    const cursor = document.body.style.cursor;
    const selection = document.body.style.userSelect;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    const cancel = () => {
      drag.current = null;
      setPreview(null);
    };
    const handleEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        cancel();
      }
    };
    window.addEventListener("blur", cancel);
    window.addEventListener("keydown", handleEscape);
    return () => {
      document.body.style.cursor = cursor;
      document.body.style.userSelect = selection;
      window.removeEventListener("blur", cancel);
      window.removeEventListener("keydown", handleEscape);
    };
  }, [resizing]);

  const commit = (next: number[]) =>
    save({ ...state, widths: { ...state.widths, [state.layout]: next } });
  function finish(event: PointerEvent<HTMLDivElement>, cancel = false) {
    const active = drag.current;
    if (!active || active.pointerId !== event.pointerId) return;
    drag.current = null;
    if (
      !cancel &&
      active.key === currentKey.current &&
      active.widths.some((width, index) => width !== active.initial[index])
    )
      commit(active.widths);
    setPreview(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
  }

  return {
    ref,
    widths,
    enabled,
    resizing,
    style: enabled
      ? { gridTemplateColumns: widths.map((width) => `${width}px`).join(" ") }
      : undefined,
    separatorProps(index: number) {
      const minimum = Math.min(240, ...widths);
      const maximum = widths[index] + widths[index + 1] - minimum;
      return {
        role: "separator" as const,
        tabIndex: 0,
        "aria-label":
          index === 0
            ? "Resize main view and side panels"
            : `Resize side panels ${index} and ${index + 1}`,
        "aria-orientation": "vertical" as const,
        "aria-valuemin": Math.round(minimum),
        "aria-valuemax": Math.round(maximum),
        "aria-valuenow": Math.round(widths[index]),
        "aria-valuetext": `${Math.round(widths[index])} pixels`,
        title: "Drag to resize · Arrow keys to adjust · Double-click to reset",
        style: {
          left:
            widths.slice(0, index + 1).reduce((sum, width) => sum + width, 0) +
            CANVAS_GAP * index +
            CANVAS_GAP / 2,
        },
        onPointerDown(event: PointerEvent<HTMLDivElement>) {
          if (event.button !== 0 || !event.isPrimary) return;
          event.preventDefault();
          event.currentTarget.focus();
          event.currentTarget.setPointerCapture(event.pointerId);
          drag.current = {
            key,
            pointerId: event.pointerId,
            startX: event.clientX,
            initial: widths,
            widths,
          };
          setPreview({ key, widths });
        },
        onPointerMove(event: PointerEvent<HTMLDivElement>) {
          const active = drag.current;
          if (
            !active ||
            active.pointerId !== event.pointerId ||
            active.key !== key
          )
            return;
          active.widths = resizeCanvasColumns(
            active.initial,
            index,
            event.clientX - active.startX,
          );
          setPreview({ key, widths: active.widths });
        },
        onPointerUp: (event: PointerEvent<HTMLDivElement>) => finish(event),
        onPointerCancel: (event: PointerEvent<HTMLDivElement>) =>
          finish(event, true),
        onLostPointerCapture: (event: PointerEvent<HTMLDivElement>) =>
          finish(event, true),
        onDoubleClick: () =>
          commit(canvasColumnWidths(available, count, mainMax)),
        onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
          if (event.altKey || event.ctrlKey || event.metaKey || drag.current)
            return;
          const direction =
            event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : 0;
          if (
            direction ||
            event.key === "Home" ||
            event.key === "End" ||
            event.key === "Enter"
          ) {
            event.preventDefault();
            if (event.key === "Enter")
              commit(canvasColumnWidths(available, count, mainMax));
            else
              commit(
                resizeCanvasColumns(
                  widths,
                  index,
                  event.key === "Home"
                    ? -Infinity
                    : event.key === "End"
                      ? Infinity
                      : direction * (event.shiftKey ? 40 : 10),
                ),
              );
          }
        },
      };
    },
  };
}
