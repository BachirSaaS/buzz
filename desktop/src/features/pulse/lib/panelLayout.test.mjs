import assert from "node:assert/strict";
import { test } from "node:test";
import {
  combineTab,
  fitsLayout,
  initialLayout,
  leafIds,
  measureLayout,
  minimumSize,
  parsePanelLayout,
  reconcilePanels,
  remove,
  resizeSplit,
  siblingAxis,
  splitPane,
  swapPanes,
} from "./panelLayout.ts";
const bounds = { x: 0, y: 0, width: 1000, height: 700 };
const invariant = (state, tabs) => {
  assert.ok(parsePanelLayout(state));
  assert.deepEqual(
    state.groups.flatMap((g) => g.tabs).sort(),
    [...tabs].sort(),
  );
  assert.deepEqual(
    leafIds(state.root).sort(),
    state.groups.map((g) => g.id).sort(),
  );
  assert.ok(state.groups.every((g) => g.tabs.includes(g.selected)));
};
test("pane moves remove before splitting and every edge preserves exactly one copy of content", () => {
  const state = initialLayout(["a", "b", "c", "d"]);
  for (const source of state.groups)
    for (const target of state.groups)
      for (const edge of ["left", "right", "top", "bottom"]) {
        const next = splitPane(state, source.id, target.id, edge);
        if (source === target) assert.equal(next, undefined);
        else invariant(next, ["a", "b", "c", "d"]);
      }
  invariant(state, ["a", "b", "c", "d"]);
});
test("combining an only tab collapses its parent; combining one of several preserves the pane", () => {
  const state = initialLayout(["a", "b", "c"]);
  const merged = combineTab(state, "a", "b", "a");
  invariant(merged, ["a", "b", "c"]);
  assert.equal(merged.groups.length, 2);
  assert.equal(merged.groups.find((g) => g.id === "b").selected, "a");
  const next = combineTab(merged, "b", "c", "a");
  invariant(next, ["a", "b", "c"]);
  assert.equal(next.groups.find((g) => g.id === "b").selected, "b");
});
test("extracting the selected tab works at its own edge and selects a remaining tab", () => {
  const merged = combineTab(initialLayout(["a", "b"]), "a", "b", "a");
  const next = splitPane(merged, "b", "b", "bottom", "a");
  invariant(next, ["a", "b"]);
  assert.equal(next.groups.find((g) => g.id === "b").selected, "b");
  assert.equal(next.root.axis, "vertical");
});
test("nested resize leaves unrelated geometry unchanged; undersized viewports retain all leaves", () => {
  const state = splitPane(initialLayout(["a", "b", "c"]), "c", "b", "bottom");
  const before = measureLayout(state.root, bounds, 8);
  const nested = before.splits.find((s) => s.axis === "vertical");
  const next = resizeSplit(state.root, nested.id, 0.8);
  const after = measureLayout(next, bounds, 8);
  assert.deepEqual(after.panes.get("a"), before.panes.get("a"));
  assert.notDeepEqual(after.panes.get("b"), before.panes.get("b"));
  const tiny = measureLayout(next, { ...bounds, width: 80, height: 40 }, 8);
  assert.equal(tiny.panes.size, 3);
  for (const box of tiny.panes.values())
    assert.ok(box.width >= 0 && box.height >= 0);
  assert.equal(
    fitsLayout({ ...state, root: next }, { ...bounds, width: 80 }, 8),
    false,
  );
  assert.ok(minimumSize(next, 8).height >= 208);
});
test("invalid targets and tabs never mutate state; swaps require two existing leaves", () => {
  const state = initialLayout(["a", "b"]);
  assert.equal(splitPane(state, "missing", "b", "left"), undefined);
  assert.equal(splitPane(state, "a", "missing", "left"), undefined);
  assert.equal(splitPane(state, "a", "b", "left", "missing"), undefined);
  assert.equal(combineTab(state, "a", "a", "a"), undefined);
  assert.equal(combineTab(state, "a", "b", "missing"), undefined);
  assert.equal(swapPanes(state.root, "a", "missing"), state.root);
  const swapped = swapPanes(state.root, "a", "b");
  assert.equal(swapped.ratio, state.root.ratio);
  assert.equal(swapped.first.id, "b");
  assert.equal(siblingAxis(state.root, "a", "b"), "horizontal");
  assert.equal(remove(state.root, "a").id, "b");
});
test("persisted trees reject duplicate content, missing groups, cycles, and invalid geometry", () => {
  const state = initialLayout(["a", "b"]);
  for (const bad of [
    { ...state, groups: [...state.groups, state.groups[0]] },
    { ...state, groups: [state.groups[0]] },
    {
      ...state,
      groups: state.groups.map((g) => ({ ...g, selected: "missing" })),
    },
    {
      ...state,
      groups: state.groups.map((g) => ({ ...g, tabs: ["a"], selected: "a" })),
    },
    { ...state, root: { ...state.root, ratio: NaN } },
  ])
    assert.equal(parsePanelLayout(bad), undefined);
  const cycle = { ...state.root };
  cycle.first = cycle;
  assert.equal(parsePanelLayout({ ...state, root: cycle }), undefined);
});
test("closing and adding windows reconciles every group without losing surviving tabs", () => {
  const state = combineTab(initialLayout(["a", "b", "c"]), "a", "b", "a");
  const next = reconcilePanels(state, ["b", "c", "d"], "grid", 960, 1000);
  invariant(next, ["b", "c", "d"]);
  assert.equal(next.groups.find((g) => g.id === "b").selected, "b");
});

test("larger workspaces preserve every window through tiling, persistence and reconciliation", async () => {
  const { parseCanvasLayout } = await import("./canvasLayout.ts");
  const ids = Array.from({ length: 24 }, (_, i) => `window-${i}`);
  for (const preset of ["grid", "columns"]) {
    const panel = initialLayout(ids, preset);
    invariant(panel, ids);
    const frames = Object.fromEntries(
      ids.map((id, i) => [id, { x: i, y: i, width: 400, height: 400 }]),
    );
    const parsed = parseCanvasLayout(
      JSON.stringify({
        main: false,
        layout: preset,
        windows: ids,
        panels: { [`workspace:${preset}`]: panel },
        freeform: { frames, order: ids },
      }),
    );
    assert.deepEqual(parsed.windows, ids);
    assert.deepEqual(parsed.freeform.order, ids);
    invariant(parsed.panels[`workspace:${preset}`], ids);
    invariant(reconcilePanels(panel, [...ids, "new"], preset, 720, 1600), [
      ...ids,
      "new",
    ]);
  }
});
