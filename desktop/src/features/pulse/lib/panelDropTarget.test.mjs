import assert from "node:assert/strict";
import { test } from "node:test";
import { panelDropTarget } from "./panelDropTarget.ts";
import {
  initialLayout,
  measureLayout,
  resizeSplit,
  splitPane,
  parsePanelLayout,
} from "./panelLayout.ts";
const bounds = { x: 0, y: 0, width: 1000, height: 700 };
function hit(state, tab, x, y, dx = 500, dy = 0, area = bounds) {
  return panelDropTarget(
    state,
    measureLayout(state.root, area, 8).panes,
    new Map(state.groups.map((g) => [g.id, 40])),
    area,
    "a",
    tab,
    x,
    y,
    dx,
    dy,
  );
}
test("header combining wins over top-edge splitting and requires a tab drag", () => {
  const state = initialLayout(["a", "b"]);
  assert.equal(hit(state, "a", 600, 3, 500, 50)?.type, "combine");
  assert.equal(hit(state, undefined, 600, 3, 500, 50)?.type, "split");
});
test("only equal-sized direct siblings swap along their shared axis", () => {
  const state = initialLayout(["a", "b"]);
  assert.equal(hit(state, undefined, 750, 350)?.type, "swap");
  assert.equal(hit(state, undefined, 750, 350, 500, 500), undefined);
  assert.equal(
    hit(
      { ...state, root: resizeSplit(state.root, state.root.id, 0.6) },
      undefined,
      750,
      350,
    ),
    undefined,
  );
  const nested = initialLayout(["a", "b", "c", "d"], "grid");
  assert.equal(hit(nested, undefined, 750, 180), undefined);
});
test("edge proposals require intent and reject complete trees that cannot fit", () => {
  const state = initialLayout(["a", "b"]);
  assert.equal(hit(state, undefined, 750, 697, 10, 31), undefined);
  assert.equal(hit(state, undefined, 750, 697, 10, 32)?.type, "split");
  const small = { ...bounds, height: 180 };
  assert.equal(hit(state, undefined, 750, 178, 20, 100, small), undefined);
});
test("repeated moves retain unique split IDs and every tab", () => {
  let state = initialLayout(["a", "b", "c", "d"]);
  for (let i = 0; i < 200; i++) {
    const source = ["a", "b", "c", "d"][i % 4];
    const target = ["b", "d", "a", "c"][i % 4];
    state = splitPane(
      state,
      source,
      target,
      ["left", "bottom", "right", "top"][i % 4],
    );
    assert.ok(parsePanelLayout(state));
    assert.equal(new Set(state.groups.flatMap((g) => g.tabs)).size, 4);
  }
});
