import { useCallback, useMemo, useSyncExternalStore } from "react";
import { toast } from "sonner";

export type CanvasViewKind = "channel" | "dm" | "project" | "agents" | "widget";
export type CanvasView = {
  id: string;
  kind: CanvasViewKind;
  title: string;
  target?: string;
};
export type CanvasLayout = {
  layout: "focus" | "grid" | "columns" | "freeform";
  windows: string[];
  widths?: Partial<Record<CanvasLayout["layout"], number[]>>;
  freeform?: { frames: Record<string, CanvasFrame>; order: string[] };
};
export type CanvasFrame = {
  x: number;
  y: number;
  width: number;
  height: number;
};
export const MAX_CANVAS_WINDOWS = 3;
const EMPTY: CanvasLayout = { layout: "focus", windows: [] };
const CHANGE = "buzz-canvas-layout-changed";

/** Read a bounded layout; store references only, never conversation contents. */
export function parseCanvasLayout(raw: string | null): CanvasLayout {
  if (!raw) return EMPTY;
  try {
    const value = JSON.parse(raw);
    if (
      !value ||
      !["focus", "grid", "columns", "freeform"].includes(value.layout) ||
      !Array.isArray(value.windows) ||
      value.windows.length > MAX_CANVAS_WINDOWS ||
      value.windows.some(
        (id: unknown) => typeof id !== "string" || id.length > 512,
      ) ||
      new Set(value.windows).size !== value.windows.length
    )
      return EMPTY;
    const widths: NonNullable<CanvasLayout["widths"]> = {};
    for (const layout of ["focus", "grid", "columns"] as const) {
      const sizes = value.widths?.[layout];
      if (
        Array.isArray(sizes) &&
        sizes.length >= 2 &&
        sizes.length <= MAX_CANVAS_WINDOWS + 1 &&
        sizes.every(
          (size: unknown) =>
            typeof size === "number" &&
            Number.isFinite(size) &&
            size >= 1 &&
            size <= 100000,
        )
      )
        widths[layout] = sizes;
    }
    const frames: Record<string, CanvasFrame> = {};
    const ids = ["main", ...value.windows];
    for (const id of ids) {
      const frame = value.freeform?.frames?.[id];
      if (
        frame &&
        ["x", "y", "width", "height"].every(
          (key) =>
            typeof frame[key] === "number" &&
            Number.isFinite(frame[key]) &&
            frame[key] >= (key === "x" || key === "y" ? 0 : 1) &&
            frame[key] <= 100000,
        )
      ) {
        frames[id] = {
          x: frame.x,
          y: frame.y,
          width: frame.width,
          height: frame.height,
        };
      }
    }
    const order = Array.isArray(value.freeform?.order)
      ? [
          ...new Set<string>(
            value.freeform.order
              .slice(0, MAX_CANVAS_WINDOWS + 1)
              .filter(
                (id: unknown) => typeof id === "string" && ids.includes(id),
              ),
          ),
        ]
      : [];
    return {
      layout: value.layout,
      windows: value.windows,
      widths,
      ...(value.freeform ? { freeform: { frames, order } } : {}),
    };
  } catch {
    return EMPTY;
  }
}

function subscribe(callback: () => void) {
  window.addEventListener("storage", callback);
  window.addEventListener(CHANGE, callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener(CHANGE, callback);
  };
}

/** Persist each layout edit atomically within the current identity and community. */
export function useCanvasLayout(scope: string | null) {
  const key = scope ? `buzz-canvas.v1:${scope}` : null;
  const snapshot = useCallback(() => {
    try {
      return key ? localStorage.getItem(key) : null;
    } catch {
      return null;
    }
  }, [key]);
  const raw = useSyncExternalStore(subscribe, snapshot, () => null);
  const state = useMemo(() => parseCanvasLayout(raw), [raw]);
  const save = (next: CanvasLayout) => {
    if (!key) return false;
    try {
      localStorage.setItem(key, JSON.stringify(next));
      window.dispatchEvent(new Event(CHANGE));
      return true;
    } catch {
      toast.error("Could not save your canvas. Please try again.");
      return false;
    }
  };
  return { state, save };
}
