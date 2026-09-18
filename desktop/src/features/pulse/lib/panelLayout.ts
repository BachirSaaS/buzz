export type Axis = "horizontal" | "vertical";
export type Edge = "left" | "right" | "top" | "bottom";
export type Group = { id: string; tabs: string[]; selected: string };
export type LayoutNode =
  | { type: "pane"; id: string }
  | {
      type: "split";
      id: string;
      axis: Axis;
      ratio: number;
      first: LayoutNode;
      second: LayoutNode;
    };
export type LayoutState = { root: LayoutNode; groups: Group[] };
export type Box = { x: number; y: number; width: number; height: number };
export type SplitBox = Box & {
  id: string;
  axis: Axis;
  ratio: number;
  minRatio: number;
  maxRatio: number;
};
const MIN_WIDTH = 120;
const MIN_HEIGHT = 100;

/** Create a preset tree using content identities, never fixed DOM slots. */
export function initialLayout(
  ids: string[],
  preset = "columns",
  mainWidth = 960,
  width = 1600,
  gap = 8,
): LayoutState {
  if (!ids.length || ids.length > 4)
    throw new RangeError("Expected one to four panes");
  let serial = 0;
  const leaf = (id: string): LayoutNode => ({ type: "pane", id });
  const split = (
    axis: Axis,
    first: LayoutNode,
    second: LayoutNode,
    ratio = 0.5,
  ): LayoutNode => ({
    type: "split",
    id: `preset-${serial++}`,
    axis,
    first,
    second,
    ratio,
  });
  const row = (names: string[], axis: Axis): LayoutNode =>
    names.length === 1
      ? leaf(names[0])
      : split(
          axis,
          leaf(names[0]),
          row(names.slice(1), axis),
          1 / names.length,
        );
  const root =
    ids.length === 1
      ? leaf(ids[0])
      : preset === "columns"
        ? row(ids, "horizontal")
        : preset === "grid" && ids.length === 4
          ? split(
              "horizontal",
              row(ids.slice(0, 2), "vertical"),
              row(ids.slice(2), "vertical"),
            )
          : split(
              "horizontal",
              leaf(ids[0]),
              row(ids.slice(1), "vertical"),
              Math.min(0.75, mainWidth / Math.max(1, width - gap)),
            );
  return { root, groups: ids.map((id) => ({ id, tabs: [id], selected: id })) };
}

/** Recursive minimum bounds, including every nested split gap. */
export function minimumSize(
  node: LayoutNode,
  gap: number,
): { width: number; height: number } {
  if (node.type === "pane") return { width: MIN_WIDTH, height: MIN_HEIGHT };
  const a = minimumSize(node.first, gap),
    b = minimumSize(node.second, gap);
  return node.axis === "horizontal"
    ? { width: a.width + gap + b.width, height: Math.max(a.height, b.height) }
    : { width: Math.max(a.width, b.width), height: a.height + gap + b.height };
}

/** Compute whole-tree geometry, including the minimum size of nested subtrees. */
export function measureLayout(root: LayoutNode, bounds: Box, gap: number) {
  const panes = new Map<string, Box>();
  const splits: SplitBox[] = [];
  const visit = (node: LayoutNode, box: Box) => {
    if (node.type === "pane") {
      panes.set(node.id, box);
      return;
    }
    const horizontal = node.axis === "horizontal";
    const localGap = Math.min(gap, horizontal ? box.width : box.height);
    const available = Math.max(
      0,
      (horizontal ? box.width : box.height) - localGap,
    );
    const firstMin = minimumSize(node.first, gap),
      secondMin = minimumSize(node.second, gap);
    const a = horizontal ? firstMin.width : firstMin.height,
      b = horizontal ? secondMin.width : secondMin.height;
    // A smaller viewport retains the arrangement rather than dropping panes.
    // New drops are separately rejected if their complete result cannot fit.
    const minRatio = available >= a + b ? a / available : a / (a + b);
    const maxRatio = available >= a + b ? 1 - b / available : minRatio;
    const ratio = Math.max(minRatio, Math.min(maxRatio, node.ratio));
    const size = available * ratio;
    splits.push({
      ...box,
      id: node.id,
      axis: node.axis,
      ratio,
      minRatio,
      maxRatio,
    });
    visit(node.first, {
      ...box,
      width: horizontal ? size : box.width,
      height: horizontal ? box.height : size,
    });
    visit(node.second, {
      x: horizontal ? box.x + size + localGap : box.x,
      y: horizontal ? box.y : box.y + size + localGap,
      width: horizontal ? available - size : box.width,
      height: horizontal ? box.height : available - size,
    });
  };
  visit(root, bounds);
  return { panes, splits };
}

/** Replace a matching leaf without altering its siblings. */
export function replace(
  node: LayoutNode,
  id: string,
  replacement: LayoutNode,
): LayoutNode {
  if (node.type === "pane") return node.id === id ? replacement : node;
  return {
    ...node,
    first: replace(node.first, id, replacement),
    second: replace(node.second, id, replacement),
  };
}
/** Remove a leaf and collapse its redundant parent. */
export function remove(node: LayoutNode, id: string): LayoutNode | undefined {
  if (node.type === "pane") return node.id === id ? undefined : node;
  const a = remove(node.first, id),
    b = remove(node.second, id);
  return a && b ? { ...node, first: a, second: b } : (a ?? b);
}

/** Change one split ratio without changing the topology. */
export function resizeSplit(
  node: LayoutNode,
  id: string,
  ratio: number,
): LayoutNode {
  if (node.type === "pane") return node;
  if (!Number.isFinite(ratio)) return node;
  if (node.id === id)
    return { ...node, ratio: Math.max(0, Math.min(1, ratio)) };
  return {
    ...node,
    first: resizeSplit(node.first, id, ratio),
    second: resizeSplit(node.second, id, ratio),
  };
}
/** Exchange two leaf identities while retaining split geometry. */
export function swapPanes(
  node: LayoutNode,
  first: string,
  second: string,
): LayoutNode {
  if (!leafIds(node).includes(first) || !leafIds(node).includes(second))
    return node;
  const exchange = (n: LayoutNode): LayoutNode =>
    n.type === "pane"
      ? { ...n, id: n.id === first ? second : n.id === second ? first : n.id }
      : { ...n, first: exchange(n.first), second: exchange(n.second) };
  return exchange(node);
}

/** Immutable proposal: remove the source first, then split the destination. */
export function splitPane(
  state: LayoutState,
  sourceId: string,
  targetId: string,
  edge: Edge,
  tab?: string,
): LayoutState | undefined {
  const source = state.groups.find((g) => g.id === sourceId),
    target = state.groups.find((g) => g.id === targetId);
  if (
    !source ||
    !target ||
    (tab && !source.tabs.includes(tab)) ||
    !["left", "right", "top", "bottom"].includes(edge)
  )
    return;
  const extracting = !!tab && source.tabs.length > 1;
  if (sourceId === targetId && !extracting) return;
  let root = state.root;
  let groups = state.groups.map((g) => ({ ...g, tabs: [...g.tabs] }));
  let movingId = sourceId;
  if (extracting && tab) {
    if (groups.length >= 4) return;
    // Reuse a tab's identity when safe, even after its original group disappeared.
    movingId = `pane-${tab}`;
    while (groups.some((g) => g.id === movingId)) movingId += "-split";
    groups = groups.map((g) =>
      g.id === sourceId
        ? {
            ...g,
            tabs: g.tabs.filter((t) => t !== tab),
            selected:
              g.selected === tab
                ? (g.tabs.find((t) => t !== tab) ?? "")
                : g.selected,
          }
        : g,
    );
    groups.push({ id: movingId, tabs: [tab], selected: tab });
  } else {
    const remaining = remove(root, sourceId);
    if (!remaining) return;
    root = remaining;
  }
  const moving: LayoutNode = { type: "pane", id: movingId };
  const destination: LayoutNode = { type: "pane", id: targetId };
  const before = edge === "left" || edge === "top";
  const occupied = new Set<string>();
  const collect = (node: LayoutNode) => {
    occupied.add(node.id);
    if (node.type === "split") {
      collect(node.first);
      collect(node.second);
    }
  };
  collect(root);
  let splitId = `split-${movingId}-${targetId}`;
  while (occupied.has(splitId) || splitId === movingId) splitId += "-split";
  const replacement: LayoutNode = {
    type: "split",
    id: splitId,
    axis: edge === "left" || edge === "right" ? "horizontal" : "vertical",
    ratio: 0.5,
    first: before ? moving : destination,
    second: before ? destination : moving,
  };
  return { root: replace(root, targetId, replacement), groups };
}

/** Merge a tab into a target, collapsing an empty source group. */
export function combineTab(
  state: LayoutState,
  sourceId: string,
  targetId: string,
  tab: string,
): LayoutState | undefined {
  const source = state.groups.find((g) => g.id === sourceId),
    target = state.groups.find((g) => g.id === targetId);
  if (!source || !target || source === target || !source.tabs.includes(tab))
    return;
  const root =
    source.tabs.length === 1 ? remove(state.root, sourceId) : state.root;
  if (!root) return;
  const groups = state.groups
    .map((g) =>
      g.id === targetId
        ? { ...g, tabs: [...g.tabs, tab], selected: tab }
        : g.id === sourceId
          ? {
              ...g,
              tabs: g.tabs.filter((t) => t !== tab),
              selected:
                g.selected === tab
                  ? (g.tabs.find((t) => t !== tab) ?? "")
                  : g.selected,
            }
          : g,
    )
    .filter((g) => g.tabs.length);
  return { root, groups };
}

/** New structural drops must fit complete recursive minimum bounds. */
export function fitsLayout(
  state: LayoutState,
  bounds: Box,
  gap: number,
): boolean {
  const min = minimumSize(state.root, gap);
  return (
    state.groups.length <= 4 &&
    min.width <= bounds.width &&
    min.height <= bounds.height
  );
}

/** Ordered tree leaf identities. */
export function leafIds(node: LayoutNode): string[] {
  return node.type === "pane"
    ? [node.id]
    : [...leafIds(node.first), ...leafIds(node.second)];
}

/** Only direct siblings can exchange equal-size slots live. */
export function siblingAxis(
  node: LayoutNode,
  a: string,
  b: string,
): Axis | undefined {
  if (node.type === "pane") return;
  if (
    node.first.type === "pane" &&
    node.second.type === "pane" &&
    [node.first.id, node.second.id].includes(a) &&
    [node.first.id, node.second.id].includes(b) &&
    a !== b
  )
    return node.axis;
  return siblingAxis(node.first, a, b) ?? siblingAxis(node.second, a, b);
}

/** Validate untrusted persisted state with bounded traversal and unique content. */
export function parsePanelLayout(value: unknown): LayoutState | undefined {
  if (!value || typeof value !== "object") return;
  const candidate = value as LayoutState;
  if (
    !Array.isArray(candidate.groups) ||
    candidate.groups.length < 1 ||
    candidate.groups.length > 4
  )
    return;
  const nodes = new Set<string>(),
    leaves: string[] = [],
    tabs: string[] = [];
  let count = 0;
  const visit = (node: LayoutNode): boolean => {
    if (
      !node ||
      typeof node !== "object" ||
      ++count > 7 ||
      typeof node.id !== "string" ||
      !node.id.length ||
      node.id.length > 2048 ||
      nodes.has(node.id)
    )
      return false;
    nodes.add(node.id);
    if (node.type === "pane") {
      leaves.push(node.id);
      return true;
    }
    return (
      node.type === "split" &&
      ["horizontal", "vertical"].includes(node.axis) &&
      Number.isFinite(node.ratio) &&
      node.ratio >= 0 &&
      node.ratio <= 1 &&
      visit(node.first) &&
      visit(node.second)
    );
  };
  if (!visit(candidate.root)) return;
  for (const group of candidate.groups) {
    if (
      !group ||
      !leaves.includes(group.id) ||
      !Array.isArray(group.tabs) ||
      !group.tabs.length ||
      group.tabs.length > 4 ||
      !group.tabs.includes(group.selected) ||
      group.tabs.some(
        (tab) => typeof tab !== "string" || !tab.length || tab.length > 512,
      )
    )
      return;
    tabs.push(...group.tabs);
  }
  if (
    leaves.length !== candidate.groups.length ||
    new Set(candidate.groups.map((g) => g.id)).size !== leaves.length ||
    tabs.length > 4 ||
    new Set(tabs).size !== tabs.length
  )
    return;
  return candidate;
}

/** Remove closed content and insert new content without losing existing tab groups. */
export function reconcilePanels(
  state: LayoutState | undefined,
  ids: string[],
  preset: string,
  mainWidth: number,
  width: number,
): LayoutState {
  if (!state) return initialLayout(ids, preset, mainWidth, width);
  let root: LayoutNode | undefined = state.root;
  const groups = state.groups.flatMap((group) => {
    const tabs = group.tabs.filter((tab) => ids.includes(tab));
    if (!tabs.length) {
      if (root) root = remove(root, group.id);
      return [];
    }
    return [
      {
        ...group,
        tabs,
        selected: tabs.includes(group.selected) ? group.selected : tabs[0],
      },
    ];
  });
  if (!root || !groups.length)
    return initialLayout(ids, preset, mainWidth, width);
  for (const id of ids.filter(
    (id) => !groups.some((group) => group.tabs.includes(id)),
  )) {
    let paneId = id;
    const occupied = new Set<string>();
    const collect = (n: LayoutNode) => {
      occupied.add(n.id);
      if (n.type === "split") {
        collect(n.first);
        collect(n.second);
      }
    };
    collect(root);
    while (occupied.has(paneId)) paneId += "-new";
    let splitId = `add-${paneId}`;
    while (occupied.has(splitId)) splitId += "-new";
    groups.push({ id: paneId, tabs: [id], selected: id });
    root = {
      type: "split",
      id: splitId,
      axis: "horizontal",
      ratio: 0.65,
      first: root,
      second: { type: "pane", id: paneId },
    };
  }
  return { root, groups };
}
