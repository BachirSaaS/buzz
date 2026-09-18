import {
  combineTab,
  fitsLayout,
  siblingAxis,
  splitPane,
  swapPanes,
  type Box,
  type Edge,
  type LayoutState,
} from "./panelLayout";
export type PanelDrop = {
  type: "combine" | "split" | "swap";
  next: LayoutState;
  target: string;
  edge?: Edge;
};
/** Hit-test authoritative slots, prioritizing tab headers over structural edge drops. */
export function panelDropTarget(
  state: LayoutState,
  boxes: Map<string, Box>,
  headers: Map<string, number>,
  bounds: Box,
  source: string,
  tab: string | undefined,
  x: number,
  y: number,
  dx: number,
  dy: number,
  lastSwap?: string,
): PanelDrop | undefined {
  const target = state.groups.find((g) => {
    const b = boxes.get(g.id);
    return (
      b &&
      (g.id !== source || (!!tab && g.tabs.length > 1)) &&
      x >= b.x &&
      x <= b.x + b.width &&
      y >= b.y &&
      y <= b.y + b.height
    );
  });
  if (!target) return;
  const box = boxes.get(target.id);
  if (!box) return;
  if (
    tab &&
    target.id !== source &&
    y < box.y + (headers.get(target.id) ?? 0)
  ) {
    const next = combineTab(state, source, target.id, tab);
    return next && fitsLayout(next, bounds, 8)
      ? { type: "combine", next, target: target.id }
      : undefined;
  }
  const edges: [Edge, number][] = [
    ["left", x - box.x],
    ["right", box.x + box.width - x],
    ["top", y - box.y],
    ["bottom", box.y + box.height - y],
  ];
  const [edge, distance] = edges.sort((a, b) => a[1] - b[1])[0];
  const horizontal = edge === "left" || edge === "right";
  if (
    distance < Math.min(36, (horizontal ? box.width : box.height) * 0.18) &&
    Math.abs(horizontal ? dx : dy) >= 32
  ) {
    const next = splitPane(state, source, target.id, edge, tab);
    return next && fitsLayout(next, bounds, 8)
      ? { type: "split", next, target: target.id, edge }
      : undefined;
  }
  const own = boxes.get(source),
    axis = siblingAxis(state.root, source, target.id);
  if (
    !tab &&
    target.id !== lastSwap &&
    own &&
    Math.abs(own.width - box.width) <= 1 &&
    Math.abs(own.height - box.height) <= 1 &&
    ((axis === "horizontal" && Math.abs(dx) > Math.abs(dy) * 1.5) ||
      (axis === "vertical" && Math.abs(dy) > Math.abs(dx) * 1.5))
  ) {
    return {
      type: "swap",
      next: { ...state, root: swapPanes(state.root, source, target.id) },
      target: target.id,
    };
  }
}
