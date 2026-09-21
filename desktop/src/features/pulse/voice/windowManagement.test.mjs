import assert from "node:assert/strict";
import { test } from "node:test";
import { parameterQuestions, decodePlan } from "./plan.ts";
import { commandCanvas, executeInterfacePlan } from "./execute.ts";
import { percentageChoices, windowTargetOptions } from "./windowTargets.ts";
const ids = ["widget:music", "widget:weather", "app:messages"];
const ctx = () => ({
  active: {
    id: "desk",
    name: "Desk",
    route: {},
    canvas: { main: false, layout: "columns", windows: ids },
  },
  workspaces: [],
  people: [],
  catalog: ids.map((id) => ({
    id,
    title: id.split(":")[1],
    kind: id.split(":")[0],
  })),
  focused: ids[0],
});
const bounds = { width: 1800, height: 1000 };
const frames = Object.fromEntries(
  ids.map((id, i) => [
    id,
    { x: 100 + 550 * i, y: 80, width: 500, height: 600 },
  ]),
);
const answer = (choice) => ({ choice, probability: 0.95, margin: 0.9 });
function plan(request, choices, context = ctx(), action = "resize_window") {
  const questions = parameterQuestions(action, request, context);
  return decodePlan(
    action,
    questions,
    Object.fromEntries(
      Object.entries(choices).map(([key, choice]) => [key, answer(choice)]),
    ),
    context,
  );
}
test("all windows 25% smaller resolves a bulk target despite focus and saves once", () => {
  const context = ctx();
  const request = plan(
    "all windows 25% smaller",
    { window: "all", size: "smaller", percentage: "25" },
    context,
  );
  assert.deepEqual(request.targets, ids);
  let writes = 0;
  let saved;
  executeInterfacePlan(
    request,
    context,
    {
      saveCanvas: (value) => {
        writes++;
        saved = value;
        return true;
      },
    },
    bounds,
    frames,
  );
  assert.equal(writes, 1);
  for (const id of ids)
    assert.deepEqual(saved.freeform.frames[id], {
      ...frames[id],
      width: 375,
      height: 450,
    });
  assert.equal(context.active.canvas.layout, "columns");
});
test("named groups leave other windows intact; percentages preserve axes and distinguish by from to", () => {
  const context = ctx();
  const options = windowTargetOptions(context, true);
  const key = Object.keys(options.groups).find(
    (key) =>
      JSON.stringify(options.groups[key]) === JSON.stringify(ids.slice(0, 2)),
  );
  assert.ok(key);
  const request = plan("music and weather 10 percent narrower", {
    window: key,
    size: "narrower",
    percentage: "10",
  });
  const result = commandCanvas(request, context, bounds, frames, "unused");
  assert.deepEqual(result.freeform.frames[ids[2]], frames[ids[2]]);
  assert.deepEqual(result.freeform.frames[ids[0]], {
    ...frames[ids[0]],
    width: 450,
  });
  assert.deepEqual(
    percentageChoices("all windows twenty-five percent smaller"),
    {
      25: "25 percent, exactly as requested",
      unavailable: "No single percentage applies to the requested resize",
    },
  );
  const scaled = plan("resize all windows to 60%", {
    window: "all",
    size: "scale",
    percentage: "60",
  });
  assert.equal(
    commandCanvas(scaled, context, bounds, frames, "unused").freeform.frames[
      ids[0]
    ].width,
    300,
  );
  assert.throws(
    () =>
      parameterQuestions("resize_window", "all windows 0% smaller", context),
    /percentage/,
  );
  assert.throws(
    () =>
      commandCanvas(
        { ...request, size: "smaller", percentage: 100 },
        context,
        bounds,
        frames,
        "unused",
      ),
    /less than 100/,
  );
  assert.throws(
    () =>
      commandCanvas(
        { ...request, targets: [ids[0], "gone"] },
        context,
        bounds,
        frames,
        "unused",
      ),
    /no longer/,
  );
});
test("connected panes resize once and Home stays anchored", () => {
  const context = ctx();
  context.active.canvas.interiors = {
    [ids[0]]: {
      root: { type: "pane", id: "group" },
      groups: [{ id: "group", tabs: ids.slice(0, 2), selected: ids[0] }],
    },
  };
  const result = commandCanvas(
    plan(
      "all windows 25% smaller",
      { window: "all", size: "smaller", percentage: "25" },
      context,
    ),
    context,
    bounds,
    frames,
    "unused",
  );
  assert.equal(result.freeform.frames[ids[0]].width, 375);
  assert.deepEqual(result.interiors, context.active.canvas.interiors);
  context.active.id = "home";
  delete context.active.canvas.main;
  const request = plan(
    "all windows smaller",
    { window: "all", size: "smaller" },
    context,
  );
  assert.ok(!request.targets.includes("main"));
  assert.ok(
    !commandCanvas(request, context, bounds, frames, "unused").freeform.frames
      .main,
  );
});
test("moving a group preserves spacing instead of stacking all windows at the edge", () => {
  const context = ctx();
  const result = commandCanvas(
    plan(
      "move all windows left",
      { window: "all", placement: "left" },
      context,
      "move_window",
    ),
    context,
    bounds,
    frames,
    "unused",
  );
  assert.deepEqual(result.freeform.frames[ids[0]], { ...frames[ids[0]], x: 0 });
  assert.deepEqual(result.freeform.frames[ids[1]], {
    ...frames[ids[1]],
    x: 550,
  });
  assert.deepEqual(result.freeform.frames[ids[2]], {
    ...frames[ids[2]],
    x: 1100,
  });
});

test("bulk transforms preserve the relative stacking order and reject regions too small for the group", () => {
  const context = ctx();
  const order = [...ids].reverse();
  context.active.canvas.freeform = { order, frames };
  const request = plan(
    "all windows smaller",
    { window: "all", size: "smaller" },
    context,
  );
  assert.deepEqual(
    commandCanvas(request, context, bounds, frames, "unused").freeform.order,
    order,
  );
  assert.throws(
    () =>
      commandCanvas(
        { action: "move_window", targets: ids, placement: "left_third" },
        context,
        bounds,
        frames,
        "unused",
      ),
    /too small/,
  );
  assert.deepEqual(context.active.canvas.freeform.frames, frames);
});
