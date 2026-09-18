import { canvasContentIds, type CanvasLayout } from "./canvasLayout";
import {
  initialLayout,
  leafIds,
  reconcilePanels,
  type LayoutState,
  type LayoutNode,
} from "./panelLayout";

/** Content inside a parent never becomes an independent canvas window. */
export function parentWindowIds(state: CanvasLayout): string[] {
  const children = new Set(
    Object.entries(state.interiors ?? {}).flatMap(([owner, layout]) =>
      layout.groups.flatMap((g) => g.tabs).filter((id) => id !== owner),
    ),
  );
  return canvasContentIds(state).filter((id) => !children.has(id));
}

/** Migrate the earlier toolbar-plus prototype into true parent-owned interiors. */
export function migrateConnectedWindows(state: CanvasLayout): CanvasLayout {
  const interiors = { ...state.interiors };
  const panels = { ...state.panels };
  const keys = Object.keys(panels).sort(
    (a, b) =>
      Number(b.endsWith(`:${state.layout}`)) -
      Number(a.endsWith(`:${state.layout}`)),
  );
  for (const key of keys) {
    const layout = panels[key];
    let groups = layout.groups;
    const visit = (node: LayoutNode): LayoutNode => {
      if (node.type === "pane") return node;
      if (node.id.startsWith("connected-")) {
        const ids = leafIds(node);
        const contents = ids.map((id) => groups.find((g) => g.id === id));
        const owner = contents[0]?.tabs[0];
        if (
          owner &&
          contents.every((g) => g?.tabs.length === 1) &&
          !Object.values(interiors).some((l) =>
            l.groups.some((g) =>
              g.tabs.some((id) => contents.some((c) => c?.tabs.includes(id))),
            ),
          )
        ) {
          interiors[owner] = {
            root: node,
            groups: contents.filter(
              (g): g is LayoutState["groups"][number] => !!g,
            ),
          };
          groups = groups.filter((g) => !ids.slice(1).includes(g.id));
          return { type: "pane", id: ids[0] };
        }
      }
      return { ...node, first: visit(node.first), second: visit(node.second) };
    };
    const root = visit(layout.root);
    panels[key] = { root, groups };
  }
  const next = { ...state, interiors, panels };
  const parents = parentWindowIds(next);
  for (const [key, layout] of Object.entries(panels)) {
    const ids = key.startsWith("home:")
      ? parents.filter((id) => id !== "main")
      : parents;
    if (ids.length)
      panels[key] = reconcilePanels(layout, ids, key.split(":")[1], 960, 1600);
    else delete panels[key];
  }
  return next;
}

/** Remove just the requested view; surviving children inherit their parent's placement. */
export function removeInteriorContent(
  state: CanvasLayout,
  removed: string,
): CanvasLayout {
  const interiors: Record<string, LayoutState> = {};
  let promoted: string | undefined;
  for (const [owner, layout] of Object.entries(state.interiors ?? {})) {
    const ids = layout.groups
      .flatMap((g) => g.tabs)
      .filter((id) => id !== removed);
    if (!ids.length) continue;
    const nextOwner = owner === removed ? ids[0] : owner;
    if (owner === removed) promoted = nextOwner;
    if (ids.length > 1)
      interiors[nextOwner] = reconcilePanels(layout, ids, "columns", 960, 1600);
  }
  const rename = (id: string) => (id === removed && promoted ? promoted : id);
  const next: CanvasLayout = {
    ...state,
    windows: state.windows.filter((id) => id !== removed),
    interiors,
    routes: Object.fromEntries(
      Object.entries(state.routes ?? {}).filter(([id]) => id !== removed),
    ),
  };
  const parents = parentWindowIds(next);
  next.panels = {};
  for (const [key, layout] of Object.entries(state.panels ?? {})) {
    const ids = key.startsWith("home:")
      ? parents.filter((id) => id !== "main")
      : parents;
    if (ids.length)
      next.panels[key] = reconcilePanels(
        {
          ...layout,
          groups: layout.groups.map((g) => ({
            ...g,
            tabs: g.tabs.map(rename),
            selected: rename(g.selected),
          })),
        },
        ids,
        key.split(":")[1],
        960,
        1600,
      );
  }
  if (state.freeform) {
    const frames = { ...state.freeform.frames };
    if (promoted && frames[removed]) frames[promoted] = frames[removed];
    delete frames[removed];
    next.freeform = {
      frames,
      order: [
        ...new Set(
          state.freeform.order.map(rename).filter((id) => parents.includes(id)),
        ),
      ],
    };
  }
  return next;
}

/** Default interior shares the same renderer as connected views. */
export function windowInterior(
  state: CanvasLayout,
  owner: string,
): LayoutState {
  return state.interiors?.[owner] ?? initialLayout([owner]);
}
