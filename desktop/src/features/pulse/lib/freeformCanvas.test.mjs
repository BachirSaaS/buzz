import assert from "node:assert/strict";
import { test } from "node:test";
import {
  fitCanvasFrame,
  defaultCanvasFrame,
  withoutCanvasWindow,
} from "./freeformCanvas.ts";
import { parseCanvasLayout } from "./canvasLayout.ts";

test("floating windows stay reachable after oversize moves, resizes, and viewport changes", () => {
  for (const bounds of [
    { width: 1472, height: 824 },
    { width: 612, height: 524 },
    { width: 180, height: 140 },
  ]) {
    for (const input of [
      { x: -400, y: -300, width: 100, height: 80 },
      { x: 10000, y: 10000, width: 2000, height: 2000 },
      { x: 150, y: 150, width: 440, height: 400 },
    ]) {
      const frame = fitCanvasFrame(input, bounds, 800);
      assert.ok(
        frame.x >= 0 && frame.y >= 0 && frame.width > 0 && frame.height > 0,
      );
      assert.ok(frame.x + frame.width <= bounds.width);
      assert.ok(frame.y + frame.height <= bounds.height);
      assert.ok(frame.width <= 800);
    }
  }
  assert.equal(
    defaultCanvasFrame(0, { width: 1472, height: 824 }, 960).width,
    960,
  );
});

test("freeform placements round-trip, malformed geometry is dropped, and close removes metadata", () => {
  const good = { x: 80, y: 60, width: 440, height: 400 };
  const state = parseCanvasLayout(
    JSON.stringify({
      layout: "freeform",
      windows: ["channel:general", "dm:alice"],
      freeform: {
        frames: {
          main: good,
          "channel:general": good,
          "dm:alice": { ...good, width: -20 },
          stale: good,
        },
        order: ["channel:general", "channel:general", "main", "stale"],
      },
    }),
  );
  assert.equal(state.layout, "freeform");
  assert.deepEqual(state.freeform.frames, {
    main: good,
    "channel:general": good,
  });
  assert.deepEqual(state.freeform.order, ["channel:general", "main"]);
  const closed = withoutCanvasWindow(state, "channel:general");
  assert.deepEqual(closed.windows, ["dm:alice"]);
  assert.deepEqual(closed.freeform.frames, { main: good });
  assert.deepEqual(closed.freeform.order, ["main"]);
});
