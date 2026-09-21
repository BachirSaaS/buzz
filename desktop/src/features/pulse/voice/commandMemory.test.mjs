import assert from "node:assert/strict";
import { test } from "node:test";
import { parameterQuestions, decodePlan } from "./plan.ts";
import { commandCanvas } from "./execute.ts";
import { currentCommandMemory, rememberCommand } from "./commandMemory.ts";

const ids = ["dm:kenny", "dm:cynthia", "app:projects"];
const bounds = { width: 1400, height: 900 };
const frames = Object.fromEntries(
  ids.map((id, i) => [
    id,
    { x: 80 + i * 350, y: 100, width: 280, height: 400 },
  ]),
);
const ctx = () => ({
  active: {
    id: "desk",
    name: "Desk",
    route: {},
    canvas: {
      main: false,
      layout: "freeform",
      windows: ids,
      freeform: { frames: structuredClone(frames), order: ids },
    },
  },
  workspaces: [],
  people: [],
  focused: ids[2],
  catalog: ids.map((id, i) => ({
    id,
    title: ["Kenny", "Cynthia", "Projects"][i],
    kind: i === 2 ? "app" : "dm",
    aliases: [],
    description: i === 2 ? "List of projects" : "Direct message",
  })),
});
const answer = (choice) => ({ choice, probability: 0.98, margin: 0.95 });

test("projects plus a position is one atomic open; unanimous targets resolve only redundant count uncertainty", () => {
  const context = ctx();
  context.active.canvas.windows = ids.slice(0, 2);
  const specs = parameterQuestions(
    "open_windows",
    "projects on the left",
    context,
  );
  const answers = Object.fromEntries(
    Object.keys(specs).map((key) => [
      key,
      answer(
        key === "count"
          ? "1"
          : key === "target_1"
            ? ids[2]
            : key === "layout"
              ? "custom"
              : key === "area_1"
                ? "left"
                : "none",
      ),
    ]),
  );
  answers.count = { choice: "1", probability: 0.45, margin: 0.08 };
  const plan = decodePlan("open_windows", specs, answers, context);
  const next = commandCanvas(plan, context, bounds, {}, "unused");
  assert.deepEqual(next.windows, ids);
  assert.equal(next.layout, "freeform");
  assert.equal(next.freeform.frames[ids[2]].x, 0);
  assert.equal(context.active.canvas.windows.length, 2);
  assert.throws(() =>
    decodePlan(
      "open_windows",
      specs,
      { ...answers, count: { choice: "2", probability: 0.45, margin: 0.08 } },
      context,
    ),
  );
  assert.throws(() =>
    decodePlan(
      "open_windows",
      specs,
      {
        ...answers,
        target_2: { choice: "none", probability: 0.4, margin: 0.08 },
      },
      context,
    ),
  );
  assert.throws(() =>
    decodePlan(
      "open_windows",
      specs,
      { ...answers, count: { choice: "1", probability: NaN, margin: 0.08 } },
      context,
    ),
  );
});

test("more retains the last group and direction, moves farther and leaves other windows alone", () => {
  const context = ctx();
  const first = {
    action: "move_window",
    targets: ids.slice(0, 2),
    placement: "nudge_right",
  };
  const after = {
    ...context.active,
    canvas: commandCanvas(first, context, bounds, {}, "unused"),
  };
  context.recent = rememberCommand(
    first,
    "move Kenny and Cynthia to the right",
    context.active,
    after,
  );
  context.active = after;
  const specs = parameterQuestions("move_window", "move them more", context);
  const reference = Object.keys(specs.window.criteria).find((key) =>
    specs.window.criteria[key].includes("LAST SUCCESSFUL SELECTION"),
  );
  assert.ok(reference);
  assert.match(specs.placement.instructions, /nudge_right/);
  const plan = decodePlan(
    "move_window",
    specs,
    { window: answer(reference), placement: answer("nudge_right") },
    context,
  );
  assert.deepEqual(plan.targets, ids.slice(0, 2));
  const next = commandCanvas(plan, context, bounds, {}, "unused");
  for (const id of ids.slice(0, 2)) {
    assert.equal(
      next.freeform.frames[id].x,
      frames[id].x + bounds.width * 0.16,
    );
    assert.equal(next.freeform.frames[id].width, frames[id].width);
  }
  assert.deepEqual(next.freeform.frames[ids[2]], frames[ids[2]]);
  const missing = {
    ...after,
    canvas: { ...after.canvas, windows: [ids[0], ids[2]] },
  };
  assert.equal(currentCommandMemory(context.recent, missing), undefined);
  assert.equal(
    currentCommandMemory(context.recent, { ...after, id: "elsewhere" }),
    undefined,
  );
});

test("a newly opened window is the singular follow-up target instead of the previously focused window", () => {
  const context = ctx();
  const before = {
    ...context.active,
    canvas: { ...context.active.canvas, windows: ids.slice(0, 2) },
  };
  context.recent = rememberCommand(
    {
      action: "open_windows",
      windowIds: [ids[2]],
      areas: { [ids[2]]: "left" },
    },
    "projects on the left",
    before,
    context.active,
  );
  context.focused = ids[0];
  const specs = parameterQuestions("resize_window", "make it bigger", context);
  assert.match(specs.window.criteria[ids[2]], /LAST SUCCESSFUL SELECTION/);
  const plan = decodePlan(
    "resize_window",
    specs,
    { window: answer(ids[2]), size: answer("bigger") },
    context,
  );
  assert.equal(plan.target, ids[2]);
});
