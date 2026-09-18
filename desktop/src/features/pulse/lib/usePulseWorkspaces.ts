import type { WorkspaceBlueprint } from "./workspacePlanner";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
} from "react";
import { toast } from "sonner";
import { allowNavigation } from "@/app/navigation/navigationGuard";
import type { CanvasLayout } from "./canvasLayout";
import {
  MAX_WORKSPACES,
  homeCanvas,
  WORKSPACE_ROUTE_KEYS,
  parseWorkspaces,
  workspaceForFeed,
  workspaceRoute,
  type PulseWorkspaces,
  type PulseWorkspace,
} from "./pulseWorkspaces";
const CHANGE = "buzz-workspaces-changed";
const clearRoute = Object.fromEntries(
  WORKSPACE_ROUTE_KEYS.map((key) => [key, null]),
);
function subscribe(callback: () => void) {
  window.addEventListener("storage", callback);
  window.addEventListener(CHANGE, callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener(CHANGE, callback);
  };
}
type Values = Record<
  (typeof WORKSPACE_ROUTE_KEYS)[number] | "workspace",
  string | null
>;
type Patch = (patch: Partial<Values>, options?: { replace?: boolean }) => void;
/** Own window geometry and navigation per workspace, scoped to this community and identity. */
export function usePulseWorkspaces(
  scope: string | null,
  values: Values,
  applyPatch: Patch,
  syncRoute = true,
) {
  const key = scope ? `buzz-workspaces.v1:${scope}` : null;
  const snapshot = useCallback(() => {
    try {
      return key
        ? (localStorage.getItem(key) ??
            `legacy:${localStorage.getItem(`buzz-canvas.v1:${scope}`) ?? ""}`)
        : "";
    } catch {
      return "";
    }
  }, [key, scope]);
  const raw = useSyncExternalStore(subscribe, snapshot, () => "");
  const state = useMemo(
    () =>
      raw.startsWith("legacy:")
        ? parseWorkspaces(null, raw.slice(7))
        : parseWorkspaces(raw),
    [raw],
  );
  const direct =
    !values.workspace && values.feed
      ? workspaceForFeed(values.feed)
      : state.active;
  const active =
    state.items.find((item) => item.id === (values.workspace || direct)) ??
    state.items.find((item) => item.id === state.active) ??
    state.items[0];
  const pending = useRef<string | null>(null);
  const persist = useCallback(
    (next: PulseWorkspaces) => {
      if (!key) return false;
      try {
        localStorage.setItem(key, JSON.stringify(next));
        window.dispatchEvent(new Event(CHANGE));
        return true;
      } catch {
        toast.error("Could not save this workspace. Please try again.");
        return false;
      }
    },
    [key],
  );
  const route = workspaceRoute(values);
  const routeKey = JSON.stringify(route);
  // URL changes from feature pages and browser history belong to the selected workspace.
  useEffect(() => {
    if (!key || !syncRoute) return;
    const route = JSON.parse(routeKey);
    if (pending.current && pending.current !== values.workspace) return;
    pending.current = null;
    // Home's summary is never a navigation destination for another app.
    // Links opened from it go to that app's workspace, retaining Home's windows.
    if (active.id === "home" && route.feed && route.feed !== "home") {
      const id = workspaceForFeed(route.feed);
      const existing = state.items.find((item) => item.id === id);
      const target = existing ?? {
        id,
        name:
          {
            home: "Home",
            messages: "Messages",
            projects: "Projects",
            agents: "Agents",
            apps: "Apps",
          }[id] ?? "Messages",
        route,
        canvas: { layout: "focus" as const, windows: [] },
      };
      if (!existing && state.items.length >= MAX_WORKSPACES) {
        toast.error("Close a workspace to open this view.");
        applyPatch({ ...clearRoute, feed: "home" }, { replace: true });
        return;
      }
      if (
        persist({
          ...state,
          active: id,
          items: existing
            ? state.items.map((item) =>
                item.id === id ? { ...item, route } : item,
              )
            : [...state.items, target],
        })
      ) {
        pending.current = id;
        applyPatch(
          { ...clearRoute, ...route, workspace: id },
          { replace: true },
        );
      }
      return;
    }
    if (values.workspace !== active.id) {
      applyPatch(
        {
          ...clearRoute,
          ...(!values.workspace && values.feed ? route : active.route),
          workspace: active.id,
        },
        { replace: true },
      );
      return;
    }
    if (
      state.active !== active.id ||
      JSON.stringify(active.route) !== routeKey ||
      raw.startsWith("legacy:")
    )
      persist({
        ...state,
        active: active.id,
        items: state.items.map((item) =>
          item.id === active.id
            ? { ...item, route: item.id === "home" ? { feed: "home" } : route }
            : item,
        ),
      });
  }, [
    key,
    syncRoute,
    values.workspace,
    values.feed,
    active,
    state,
    routeKey,
    persist,
    applyPatch,
    raw,
  ]);
  const current = (): PulseWorkspaces => ({
    ...state,
    active: active.id,
    items: state.items.map((item) =>
      item.id === active.id
        ? { ...item, route: item.id === "home" ? { feed: "home" } : route }
        : item,
    ),
  });
  const navigate = (next: PulseWorkspaces, target: PulseWorkspace) => {
    if (
      !allowNavigation({ kind: "route", href: `/pulse?workspace=${target.id}` })
    )
      return false;
    if (!persist({ ...next, active: target.id })) return false;
    pending.current = target.id;
    applyPatch({ ...clearRoute, ...target.route, workspace: target.id });
    return true;
  };
  const select = (id: string) => {
    if (id === active.id && syncRoute) return true;
    const target = state.items.find((item) => item.id === id);
    return target ? navigate(current(), target) : false;
  };
  const create = (blueprint?: WorkspaceBlueprint) => {
    if (state.items.length >= MAX_WORKSPACES) return false;
    let index = 1;
    while (state.items.some((item) => item.name === `Workspace ${index}`))
      index++;
    const item: PulseWorkspace = {
      id: crypto.randomUUID(),
      name: blueprint?.name ?? `Workspace ${index}`,
      route: {},
      canvas: {
        layout: blueprint?.layout ?? "focus",
        windows: blueprint?.windowIds ?? [],
        main: false,
      },
    };
    return navigate({ ...current(), items: [...current().items, item] }, item);
  };
  const rename = (id: string, name: string) => {
    const clean = name.trim().slice(0, 48);
    if (!clean || !state.items.some((item) => item.id === id)) return false;
    return persist({
      ...current(),
      items: current().items.map((item) =>
        item.id === id ? { ...item, name: clean } : item,
      ),
    });
  };
  const close = (id: string) => {
    if (state.items.length === 1) return false;
    const items = current().items.filter((item) => item.id !== id);
    return id === active.id
      ? navigate(
          { ...current(), items },
          items[
            Math.max(0, state.items.findIndex((item) => item.id === id) - 1)
          ],
        )
      : persist({ ...current(), items });
  };
  const saveCanvas = (canvas: CanvasLayout) =>
    persist({
      ...current(),
      items: current().items.map((item) =>
        item.id === active.id
          ? {
              ...item,
              canvas: item.id === "home" ? homeCanvas(canvas) : canvas,
            }
          : item,
      ),
    });
  return {
    scope,
    items: state.items,
    active,
    select,
    create,
    rename,
    close,
    saveCanvas,
    canCreate: Boolean(key) && state.items.length < MAX_WORKSPACES,
  };
}
export type WorkspaceController = ReturnType<typeof usePulseWorkspaces>;
