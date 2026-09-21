import assert from "node:assert/strict";
import { test } from "node:test";
import { areaFrame, sizedFrame, areaChoices } from "./canvasAreas.ts";
import { commandCanvas, executeInterfacePlan } from "./execute.ts";
import { parameterQuestions, decodePlan, DRAFT_WINDOW } from "./plan.ts";
import { intentBatches } from "./intent.ts";
import { parseCanvasLayout } from "../lib/canvasLayout.ts";
const bounds = { width: 1200, height: 900 };
const original = { x: 100, y: 80, width: 400, height: 300 };
const catalog = ["music", "weather"].map((name) => ({
  id: `widget:${name}`,
  title: name,
  kind: "widget",
  description: name,
  aliases: [],
}));
const ctx = () => ({
  active: {
    id: "desk",
    name: "Desk",
    route: {},
    canvas: {
      main: false,
      layout: "columns",
      windows: catalog.map((v) => v.id),
    },
  },
  workspaces: [],
  people: [],
  focused: "widget:music",
  catalog,
});
const answer = (choice) => ({ choice, probability: 0.95, margin: 0.9 });
const choices = (specs, picks) =>
  Object.fromEntries(
    Object.keys(specs).map((id) => [
      id,
      answer(
        picks[id] ??
          (id === "scope"
            ? "create"
            : id.startsWith("area_") || id.startsWith("target_")
              ? "none"
              : "0"),
      ),
    ]),
  );
test("areas snap exact fractions, preserve size at edges, and remain bounded on small canvases", () => {
  assert.deepEqual(areaFrame("left_half", original, bounds), {
    x: 0,
    y: 0,
    width: 600,
    height: 900,
  });
  assert.deepEqual(areaFrame("bottom_third", original, bounds), {
    x: 0,
    y: 600,
    width: 1200,
    height: 300,
  });
  assert.deepEqual(areaFrame("top_right_quarter", original, bounds), {
    x: 600,
    y: 0,
    width: 600,
    height: 450,
  });
  assert.deepEqual(areaFrame("bottom_right", original, bounds), {
    ...original,
    x: 800,
    y: 600,
  });
  for (const area of Object.keys(areaChoices))
    for (const canvas of [bounds, { width: 160, height: 120 }]) {
      const frame = areaFrame(area, original, canvas);
      assert.ok(
        frame.x >= 0 &&
          frame.y >= 0 &&
          frame.x + frame.width <= canvas.width + 1e-6 &&
          frame.y + frame.height <= canvas.height + 1e-6,
      );
      assert.deepEqual(areaFrame(area, frame, canvas), frame);
    }
  assert.throws(() => areaFrame("made-up", original, bounds));
  assert.equal(sizedFrame("small", original, bounds).width, 420);
  assert.equal(sizedFrame("large", original, bounds).width, 1020);
});
test("shared Jev parameters decode multi-window areas and commit them atomically with reloadable geometry", () => {
  const context = ctx();
  const specs = parameterQuestions(
    "arrange_windows",
    "music left half and weather right half",
    context,
  );
  const plan = decodePlan(
    "arrange_windows",
    specs,
    choices(specs, {
      layout: "custom",
      area_1: "left_half",
      area_2: "right_half",
    }),
    context,
  );
  let calls = 0,
    saved;
  executeInterfacePlan(
    plan,
    context,
    {
      saveCanvas: (canvas) => {
        calls++;
        saved = canvas;
        return true;
      },
    },
    bounds,
    {},
  );
  assert.equal(calls, 1);
  assert.deepEqual(saved.freeform.frames["widget:music"], {
    x: 0,
    y: 0,
    width: 600,
    height: 900,
  });
  assert.deepEqual(saved.freeform.frames["widget:weather"], {
    x: 600,
    y: 0,
    width: 600,
    height: 900,
  });
  assert.deepEqual(
    parseCanvasLayout(JSON.stringify(saved)).freeform,
    saved.freeform,
  );
  assert.equal(context.active.canvas.layout, "columns");
  for (const layout of ["columns", "rows", "grid"]) {
    const next = commandCanvas(
      { action: "arrange_windows", arrangement: layout },
      context,
      bounds,
      {},
      "unused",
    );
    const a = next.freeform.frames["widget:music"],
      b = next.freeform.frames["widget:weather"];
    assert.ok(a.x + a.width <= b.x || a.y + a.height <= b.y);
  }
});
test("connected panes move as a unit, conflicting areas reject, and Home stays anchored", () => {
  const context = ctx();
  context.active.canvas.interiors = {
    "widget:music": {
      groups: [
        {
          id: "both",
          selected: "widget:weather",
          tabs: ["widget:music", "widget:weather"],
        },
      ],
      tree: { type: "leaf", groupId: "both" },
    },
  };
  const next = commandCanvas(
    {
      action: "move_window",
      target: "widget:weather",
      placement: "bottom_third",
    },
    context,
    bounds,
    {},
    "unused",
  );
  assert.deepEqual(next.freeform.frames["widget:music"], {
    x: 0,
    y: 600,
    width: 1200,
    height: 300,
  });
  assert.deepEqual(next.interiors, context.active.canvas.interiors);
  assert.throws(
    () =>
      commandCanvas(
        {
          action: "arrange_windows",
          areas: {
            "widget:music": "left_half",
            "widget:weather": "right_half",
          },
        },
        context,
        bounds,
        {},
        "unused",
      ),
    /Connected panes/,
  );
  context.active.id = "home";
  delete context.active.canvas.main;
  assert.throws(
    () =>
      commandCanvas(
        { action: "arrange_windows", areas: { main: "left_half" } },
        context,
        bounds,
        {},
        "unused",
      ),
    /anchored/,
  );
  const tiled = commandCanvas(
    { action: "arrange_windows", arrangement: "rows" },
    context,
    bounds,
    {},
    "unused",
  );
  assert.ok(!tiled.freeform.frames.main);
});
test("workspace creation combines a recipient draft, widgets and areas in a single transaction", () => {
  const context = ctx();
  const person = "a".repeat(64);
  context.people = [{ pubkey: person, displayName: "Matt" }];
  const specs = parameterQuestions(
    "create_workspace",
    "DM with Matt on the left and weather on the right",
    context,
  );
  const batches = intentBatches({
    request: "create workspace",
    context: "",
    questions: specs,
  });
  assert.ok(
    batches.every((batch) => Object.keys(batch.questions).length <= 12),
  );
  assert.deepEqual(
    Object.assign({}, ...batches.map((batch) => batch.questions)),
    specs,
  );
  const plan = decodePlan(
    "create_workspace",
    specs,
    choices(specs, {
      count: "2",
      target_1: DRAFT_WINDOW,
      target_2: "widget:weather",
      layout: "custom",
      area_1: "left_half",
      area_2: "right_half",
    }),
    context,
  );
  plan.recipients = [person];
  let calls = 0,
    saved;
  executeInterfacePlan(
    plan,
    context,
    {
      canCreate: true,
      create: (blueprint) => {
        calls++;
        saved = blueprint;
        return true;
      },
    },
    bounds,
    {},
  );
  assert.equal(calls, 1);
  const draft = saved.windowIds[0];
  assert.equal(saved.canvas.routes[draft].voiceRecipients, person);
  assert.equal(saved.canvas.routes[draft].compose, "message");
  assert.equal(saved.canvas.freeform.frames[draft].width, 600);
  const restored = parseCanvasLayout(JSON.stringify(saved.canvas));
  assert.deepEqual(restored.freeform, saved.canvas.freeform);
  assert.deepEqual(restored.routes, saved.canvas.routes);
  for (const invalid of ["invented", "unavailable"])
    assert.throws(() =>
      decodePlan(
        "create_workspace",
        specs,
        choices(specs, {
          count: "2",
          target_1: invalid,
          target_2: "widget:weather",
          layout: "columns",
        }),
        context,
      ),
    );
});
