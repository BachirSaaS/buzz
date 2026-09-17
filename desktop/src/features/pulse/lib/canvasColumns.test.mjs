import assert from "node:assert/strict";
import { test } from "node:test";
import { canvasColumnWidths, resizeCanvasColumns } from "./canvasColumns.ts";
import { parseCanvasLayout } from "./canvasLayout.ts";

test("saved and default widths fit the canvas across main caps and column counts", () => {
  for (const available of [761, 972, 1472, 3000]) {
    for (const count of [2, 3, 4]) {
      for (const maximum of [800, 960]) {
        for (const saved of [
          undefined,
          [700, 400],
          [640, 500, 320],
          [1000, 100, 100, 100],
        ]) {
          const widths = canvasColumnWidths(available, count, maximum, saved);
          assert.equal(widths.length, count);
          assert.ok(
            widths.every((width) => Number.isFinite(width) && width > 0),
          );
          if (!saved || saved.length !== count) assert.ok(widths[0] <= maximum);
          assert.ok(
            Math.abs(
              widths.reduce((sum, width) => sum + width, 0) +
                8 * (count - 1) -
                available,
            ) < 0.001,
          );
          const restored = canvasColumnWidths(
            available,
            count,
            maximum,
            widths,
          );
          assert.ok(
            restored.every(
              (width, index) => Math.abs(width - widths[index]) < 0.001,
            ),
          );
        }
      }
    }
  }
});

test("drag bounds preserve other columns and total space", () => {
  const widths = [800, 328, 328];
  assert.deepEqual(resizeCanvasColumns(widths, 0, 500), [888, 240, 328]);
  assert.deepEqual(resizeCanvasColumns(widths, 0, -1000), [240, 888, 328]);
  assert.deepEqual(resizeCanvasColumns(widths, 1, 40), [800, 368, 288]);
  assert.deepEqual(resizeCanvasColumns(widths, 1, 1000), [800, 416, 240]);
});

test("legacy layouts remain usable and malformed saved widths are ignored", () => {
  const base = { layout: "focus", windows: ["channel:general"] };
  assert.deepEqual(
    parseCanvasLayout(JSON.stringify(base)).windows,
    base.windows,
  );
  for (const bad of [[-1, 400], [null, 400], [800], [800, 1e100], "800,400"]) {
    assert.deepEqual(
      parseCanvasLayout(JSON.stringify({ ...base, widths: { focus: bad } }))
        .widths,
      {},
    );
  }
  assert.deepEqual(
    parseCanvasLayout(
      JSON.stringify({ ...base, widths: { focus: [640, 824] } }),
    ).widths,
    { focus: [640, 824] },
  );
});
