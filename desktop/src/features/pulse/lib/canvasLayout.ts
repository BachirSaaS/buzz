import { useCallback, useMemo, useSyncExternalStore } from "react";
import { parsePanelLayout, type LayoutState } from "./panelLayout";
import { migrateConnectedWindows } from "./parentWindows";
import { toast } from "sonner";

export type CanvasViewKind =
  | "app"
  | "channel"
  | "dm"
  | "project"
  | "agents"
  | "widget";
export type CanvasView = {
  id: string;
  kind: CanvasViewKind;
  title: string;
  target?: string;
  aliases?: string[];
  description?: string;
};
export type CanvasLayout = {
  layout: "focus" | "grid" | "columns" | "freeform";
  windows: string[];
  /** False for workspaces whose every window is explicitly added. */
  main?: false;
  routes?: Record<string, Record<string, string>>;
  panels?: Record<string, LayoutState>;
  interiors?: Record<string, LayoutState>;
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
/** All content IDs, including the implicit main only in older workspaces. */
export const canvasContentIds = (state: CanvasLayout): string[] =>
  state.main === false ? state.windows : ["main", ...state.windows];
/** Four total views, whether or not the workspace has a legacy main. */
export const canvasWindowLimit = (state: CanvasLayout) =>
  MAX_CANVAS_WINDOWS + (state.main === false ? 1 : 0);
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
      // Preserve existing companions when restoring Home’s permanent summary.
      value.windows.length > MAX_CANVAS_WINDOWS + 1 ||
      value.windows.some(
        (id: unknown) => typeof id !== "string" || id.length > 512,
      ) ||
      new Set(value.windows).size !== value.windows.length
    )
      return EMPTY;
    const ids =
      value.main === false ? value.windows : ["main", ...value.windows];
    const routes: NonNullable<CanvasLayout["routes"]> = {};
    for (const id of ids) {
      const route = value.routes?.[id];
      if (route && typeof route === "object" && !Array.isArray(route))
        routes[id] = Object.fromEntries(
          Object.entries(route)
            .slice(0, 40)
            .filter(
              ([key, val]) =>
                key.length < 80 &&
                typeof val === "string" &&
                val.length <= 2048,
            ),
        ) as Record<string, string>;
    }
    const panels: Record<string, LayoutState> = {};
    for (const scope of ["home", "workspace"])
      for (const preset of ["focus", "grid", "columns"]) {
        const key = `${scope}:${preset}`;
        const parsed = parsePanelLayout(value.panels?.[key]);
        if (parsed) panels[key] = parsed;
      }
    const interiors: Record<string, LayoutState> = {};
    const interiorTabs = new Set<string>();
    for (const owner of ids) {
      const parsed = parsePanelLayout(value.interiors?.[owner]);
      const tabs = parsed?.groups.flatMap((g) => g.tabs) ?? [];
      if (
        parsed &&
        tabs.includes(owner) &&
        tabs.every((id) => ids.includes(id) && !interiorTabs.has(id))
      ) {
        interiors[owner] = parsed;
        for (const id of tabs) interiorTabs.add(id);
      }
    }
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
    return migrateConnectedWindows({
      layout: value.layout,
      windows: value.windows,
      ...(value.main === false ? { main: false as const } : {}),
      routes,
      widths,
      panels,
      interiors,
      ...(value.freeform ? { freeform: { frames, order } } : {}),
    });
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
