import type { CanvasLayout } from "./canvasLayout";
import {
  fitsLayout,
  leafIds,
  replace,
  type LayoutState,
  type Box,
  type LayoutNode,
} from "./panelLayout";

/** Add one connected leaf beside the selected group without moving unrelated branches. */
export function insertConnectedPane(
  state: LayoutState,
  target: string,
  id: string,
  bounds: Box,
  gap = 0,
): LayoutState | undefined {
  if (
    !leafIds(state.root).includes(target) ||
    state.groups.flatMap((g) => g.tabs).length >= 4 ||
    state.groups.some((g) => g.id === id || g.tabs.includes(id))
  )
    return;
  const occupied = new Set<string>();
  const collect = (node: LayoutNode) => {
    occupied.add(node.id);
    if (node.type === "split") {
      collect(node.first);
      collect(node.second);
    }
  };
  collect(state.root);
  let splitId = `connected-${id}`;
  while (occupied.has(splitId)) splitId += "-split";
  for (const axis of ["horizontal", "vertical"] as const) {
    const next: LayoutState = {
      root: replace(state.root, target, {
        type: "split",
        id: splitId,
        axis,
        ratio: 0.5,
        first: { type: "pane", id: target },
        second: { type: "pane", id },
      }),
      groups: [...state.groups, { id, tabs: [id], selected: id }],
    };
    if (fitsLayout(next, bounds, gap)) return next;
  }
}

/** Choose content in place, retaining the empty pane's geometry and all other views. */
export function fillCanvasSplit(
  state: CanvasLayout,
  empty: string,
  view: string,
): CanvasLayout | undefined {
  if (
    !empty.startsWith("empty:") ||
    !state.windows.includes(empty) ||
    state.windows.includes(view)
  )
    return;
  const rename = (id: string) => (id === empty ? view : id);
  const panels = Object.fromEntries(
    Object.entries(state.panels ?? {}).map(([key, layout]) => [
      key,
      {
        ...layout,
        groups: layout.groups.map((g) => ({
          ...g,
          tabs: g.tabs.map(rename),
          selected: rename(g.selected),
        })),
      },
    ]),
  );
  return {
    ...state,
    windows: state.windows.map(rename),
    panels,
    interiors: Object.fromEntries(
      Object.entries(state.interiors ?? {}).map(([owner, layout]) => [
        rename(owner),
        {
          ...layout,
          groups: layout.groups.map((g) => ({
            ...g,
            tabs: g.tabs.map(rename),
            selected: rename(g.selected),
          })),
        },
      ]),
    ),
    ...(state.freeform
      ? {
          freeform: {
            frames: Object.fromEntries(
              Object.entries(state.freeform.frames).map(([id, frame]) => [
                rename(id),
                frame,
              ]),
            ),
            order: state.freeform.order.map(rename),
          },
        }
      : {}),
  };
}
