import { isWorkspaceIcon, type WorkspaceIconName } from "./workspaceIcons";
import { parseCanvasLayout, type CanvasLayout } from "./canvasLayout";
import { removeInteriorContent } from "./parentWindows";
import { PULSE_CONVERSATION_KEYS } from "./pulsePanelState";
import { PULSE_WORKSPACE_KEYS } from "./workspaceNavigation";

export const WORKSPACE_ROUTE_KEYS = [
  "feed",
  "briefings",
  ...PULSE_CONVERSATION_KEYS,
  ...PULSE_WORKSPACE_KEYS,
] as const;
export type WorkspaceRoute = Partial<
  Record<(typeof WORKSPACE_ROUTE_KEYS)[number], string>
>;
export type PulseWorkspace = {
  id: string;
  name: string;
  /** Explicit, user-selected icon; automatic enrichment never replaces it. */
  icon?: WorkspaceIconName;
  route: WorkspaceRoute;
  canvas: CanvasLayout;
};
export type PulseWorkspaces = { active: string; items: PulseWorkspace[] };
export const MAX_WORKSPACES = 12;
const defaults = [
  ["home", "Home", "home"],
  ["messages", "Messages", "conversation"],
  ["projects", "Projects", "projects"],
  ["agents", "Agents", "agents"],
  ["apps", "Apps", "workflows"],
] as const;

/** Retain only bounded navigation references, never message contents. */
export function workspaceRoute(
  value: Partial<Record<string, unknown>>,
): WorkspaceRoute {
  return Object.fromEntries(
    WORKSPACE_ROUTE_KEYS.flatMap((key) =>
      typeof value[key] === "string" &&
      value[key].length > 0 &&
      value[key].length <= 2048
        ? [[key, value[key]]]
        : [],
    ),
  );
}
/** Home owns a permanent summary; detach existing companions without discarding them. */
export function homeCanvas(canvas: CanvasLayout): CanvasLayout {
  const grouped = Object.values(canvas.interiors ?? {}).some((layout) =>
    layout.groups.some((group) => group.tabs.includes("main")),
  );
  const next = grouped ? removeInteriorContent(canvas, "main") : canvas;
  if (!grouped && next.main !== false) return next;
  const { main: _main, ...anchored } = next;
  return anchored;
}
/** Migrate the former shared canvas into Home without copying it into other workspaces. */
export function parseWorkspaces(
  raw: string | null,
  legacy: string | null = null,
): PulseWorkspaces {
  const fallback = (): PulseWorkspaces => ({
    active: "home",
    items: defaults.map(([id, name, feed]) => ({
      id,
      name,
      route: { feed },
      canvas:
        id === "home"
          ? homeCanvas(parseCanvasLayout(legacy))
          : parseCanvasLayout(null),
    })),
  });
  if (!raw) return fallback();
  try {
    const data = JSON.parse(raw);
    if (
      !Array.isArray(data.items) ||
      !data.items.length ||
      data.items.length > MAX_WORKSPACES
    )
      return fallback();
    const ids = new Set<string>();
    const items: PulseWorkspace[] = [];
    for (const item of data.items) {
      if (
        !item ||
        typeof item.id !== "string" ||
        !/^[a-zA-Z0-9-]{1,80}$/.test(item.id) ||
        ids.has(item.id) ||
        typeof item.name !== "string" ||
        !item.name.trim() ||
        item.name.length > 48
      )
        return fallback();
      ids.add(item.id);
      items.push({
        id: item.id,
        name: item.name,
        ...(isWorkspaceIcon(item.icon) ? { icon: item.icon } : {}),
        route:
          item.id === "home"
            ? { feed: "home" }
            : workspaceRoute(item.route ?? {}),
        canvas:
          item.id === "home"
            ? homeCanvas(parseCanvasLayout(JSON.stringify(item.canvas)))
            : parseCanvasLayout(JSON.stringify(item.canvas)),
      });
    }
    return { items, active: ids.has(data.active) ? data.active : items[0].id };
  } catch {
    return fallback();
  }
}
/** Direct links without a workspace select their corresponding starter workspace. */
export function workspaceForFeed(feed: string | null) {
  return feed === "projects" || feed === "agents"
    ? feed
    : feed === "workflows"
      ? "apps"
      : !feed || feed === "home"
        ? "home"
        : "messages";
}
