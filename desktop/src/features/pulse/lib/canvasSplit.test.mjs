import { test } from "node:test";
import assert from "node:assert/strict";
import { fillCanvasSplit, insertConnectedPane } from "./canvasSplit.ts";
import {
  initialLayout,
  measureLayout,
  parsePanelLayout,
  combineTab,
} from "./panelLayout.ts";
import { parseCanvasLayout } from "./canvasLayout.ts";
const bounds = { x: 0, y: 0, width: 1552, height: 904 };
test("new splits attach to their target and retain unrelated pane geometry", () => {
  const initial = initialLayout(["main", "agents"], "focus", 960, 1552);
  const next = insertConnectedPane(initial, "agents", "empty:new", bounds);
  assert.ok(parsePanelLayout(next));
  assert.deepEqual(
    measureLayout(initial.root, bounds, 8).panes.get("main"),
    measureLayout(next.root, bounds, 8).panes.get("main"),
  );
  assert.equal(next.root.second.first.id, "agents");
  assert.equal(next.root.second.second.id, "empty:new");
});
test("split insertion falls back vertically, rejects invalid targets, full or undersized workspaces", () => {
  const initial = initialLayout(["main"]);
  assert.equal(
    insertConnectedPane(initial, "main", "empty:new", { ...bounds, width: 200 })
      .root.axis,
    "vertical",
  );
  assert.equal(
    insertConnectedPane(initial, "main", "empty:new", {
      ...bounds,
      width: 200,
      height: 150,
    }),
    undefined,
  );
  assert.equal(
    insertConnectedPane(initial, "missing", "empty:new", bounds),
    undefined,
  );
  const full = initialLayout(["main", "a", "b", "c"]);
  assert.equal(insertConnectedPane(full, "a", "empty:new", bounds), undefined);
});
test("choosing a split replaces its identity atomically across presets and floating placement", () => {
  const panels = insertConnectedPane(
    initialLayout(["main"]),
    "main",
    "empty:new",
    bounds,
  );
  const frame = { x: 50, y: 40, width: 300, height: 400 };
  const state = {
    layout: "columns",
    windows: ["empty:new"],
    panels: {
      "workspace:columns": panels,
      "workspace:focus": combineTab(panels, "empty:new", "main", "empty:new"),
    },
    freeform: { frames: { "empty:new": frame }, order: ["main", "empty:new"] },
  };
  const next = fillCanvasSplit(state, "empty:new", "agents");
  assert.deepEqual(next.windows, ["agents"]);
  assert.deepEqual(next.panels["workspace:columns"].root, panels.root);
  assert.deepEqual(next.freeform.frames, { agents: frame });
  for (const layout of Object.values(next.panels)) {
    assert.ok(parsePanelLayout(layout));
    assert.ok(!layout.groups.some((g) => g.tabs.includes("empty:new")));
  }
  assert.ok(parseCanvasLayout(JSON.stringify(next)).interiors.main);
  assert.equal(fillCanvasSplit(next, "empty:new", "widget:weather"), undefined);
  assert.equal(
    fillCanvasSplit(
      { ...state, windows: ["empty:new", "agents"] },
      "empty:new",
      "agents",
    ),
    undefined,
  );
});

test("interiors retain ownership through filling, reload, closing, and legacy migration", async () => {
  const { parentWindowIds, removeInteriorContent } = await import(
    "./parentWindows.ts"
  );
  const interior = insertConnectedPane(
    initialLayout(["agents"]),
    "agents",
    "empty:new",
    bounds,
  );
  const frame = { x: 80, y: 80, width: 800, height: 600 };
  const original = {
    layout: "freeform",
    windows: ["agents", "empty:new"],
    interiors: { agents: interior },
    freeform: { frames: { agents: frame }, order: ["main", "agents"] },
  };
  const filled = fillCanvasSplit(original, "empty:new", "widget:weather");
  assert.equal(filled.layout, "freeform");
  assert.deepEqual(parentWindowIds(filled), ["main", "agents"]);
  assert.deepEqual(
    parseCanvasLayout(JSON.stringify(filled)).interiors,
    filled.interiors,
  );
  const closedChild = removeInteriorContent(filled, "widget:weather");
  assert.deepEqual(closedChild.windows, ["agents"]);
  assert.deepEqual(closedChild.interiors, {});
  const promoted = removeInteriorContent(filled, "agents");
  assert.deepEqual(parentWindowIds(promoted), ["main", "widget:weather"]);
  assert.deepEqual(promoted.freeform.frames, { "widget:weather": frame });
  const legacy = {
    layout: "columns",
    windows: ["agents", "empty:new"],
    panels: {
      "workspace:columns": insertConnectedPane(
        initialLayout(["main", "agents"]),
        "agents",
        "empty:new",
        bounds,
      ),
    },
  };
  const migrated = parseCanvasLayout(JSON.stringify(legacy));
  assert.deepEqual(parentWindowIds(migrated), ["main", "agents"]);
  assert.equal(migrated.interiors.agents.groups.length, 2);
});
test("every corner fixes the opposite corner, clamps to canvas, and allows width beyond reading caps", async () => {
  const { resizeCanvasFrame } = await import("./freeformCanvas.ts");
  const frame = { x: 100, y: 100, width: 1000, height: 600 },
    bounds = { width: 1600, height: 1000 };
  for (const corner of ["nw", "ne", "sw", "se"]) {
    const west = corner.includes("w"),
      north = corner.includes("n");
    const after = resizeCanvasFrame(
      frame,
      west ? 20 : -20,
      north ? 20 : -20,
      corner,
      bounds,
    );
    assert.equal(after.width, 980);
    assert.equal(after.height, 580);
    assert.equal(west ? after.x + after.width : after.x, west ? 1100 : 100);
    assert.equal(north ? after.y + after.height : after.y, north ? 700 : 100);
  }
  assert.deepEqual(resizeCanvasFrame(frame, -500, -500, "nw", bounds), {
    x: 0,
    y: 0,
    width: 1100,
    height: 700,
  });
  assert.equal(resizeCanvasFrame(frame, 1000, 0, "se", bounds).width, 1500);
});
