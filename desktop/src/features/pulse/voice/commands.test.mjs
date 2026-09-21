import assert from "node:assert/strict";
import { test } from "node:test";
import { commandCanvas, executeInterfacePlan } from "./execute.ts";
import {
  parameterQuestions,
  decodePlan as decodeInterfacePlan,
} from "./plan.ts";
const decodePlan = (action, specs, answers, ctx) =>
  decodeInterfacePlan(
    action,
    specs,
    {
      ...Object.fromEntries(
        Object.keys(specs)
          .filter((id) => id.startsWith("area_") || id === "scope")
          .map((id) => [id, answer(id === "scope" ? "create" : "none")]),
      ),
      ...answers,
    },
    ctx,
  );
import { actionQuestion, selectDecision } from "./intent.ts";
import { parseCanvasLayout } from "../lib/canvasLayout.ts";
import { workspaceNavigation } from "./workspaceNavigation.ts";

const matt = "a".repeat(64),
  jared = "b".repeat(64);
const catalog = ["music", "weather"].map((id) => ({
  id: `widget:${id}`,
  title: id,
  kind: "widget",
  aliases: [],
  description: id,
}));
const state = {
  layout: "columns",
  main: false,
  windows: ["widget:music", "widget:weather"],
};
const ctx = () => ({
  active: { id: "w", name: "Work", route: {}, canvas: structuredClone(state) },
  workspaces: [{ id: "w", name: "Work" }],
  catalog,
  people: [
    { pubkey: matt, displayName: "Matt Kursmark" },
    { pubkey: jared, displayName: "Jared" },
  ],
  focused: "widget:music",
});
const bounds = { width: 1000, height: 700 };
const frames = {
  "widget:music": { x: 100, y: 100, width: 400, height: 300 },
  "widget:weather": { x: 550, y: 50, width: 350, height: 350 },
};
const answer = (choice, probability = 0.9, margin = 0.8) => ({
  choice,
  probability,
  margin,
});

test("explicit workspace navigation resolves unique names and speech spacing without guessing", () => {
  const workspaces = [
    { id: "home", name: "Home" },
    { id: "night", name: "nightriders" },
    { id: "design", name: "Buzz Design" },
  ];
  for (const request of [
    "switch to nightriders",
    " Switch to NIGHTRIDERS! ",
    "please switch to night riders",
    "go back to night-riders",
    "take me to the nightriders workspace",
    "open workspace nightriders",
    "can you switch to “nightriders”?",
  ]) {
    const plan = workspaceNavigation(request, workspaces);
    assert.deepEqual(plan, { action: "switch_workspace", workspace: "night" });
    let selected;
    executeInterfacePlan(
      plan,
      { ...ctx(), workspaces },
      {
        select: (id) => {
          selected = id;
          return true;
        },
      },
      bounds,
      frames,
    );
    assert.equal(selected, "night");
  }
  for (const request of [
    "don't switch to nightriders",
    "I said switch to nightriders",
    "switch to night",
    "switch to unknown",
    "switch to nightriders and open music",
    "close workspace nightriders",
    "rename Home to nightriders",
  ])
    assert.equal(workspaceNavigation(request, workspaces), null);
  assert.equal(
    workspaceNavigation("switch to night riders", [
      ...workspaces,
      { id: "duplicate", name: "Night Riders" },
    ]),
    null,
  );
});

test("DM intent resolves two people into one unsent composer, atomically and durably", () => {
  const context = ctx();
  const questions = parameterQuestions(
    "new_dm",
    "start a dm with Matt and Jared",
    context,
  );
  const plan = decodePlan("new_dm", questions, {
    count: answer("2"),
    target_1: answer(matt),
    target_2: answer(jared),
    target_3: answer("unavailable", 0.1, 0.01),
  });
  const next = commandCanvas(plan, context, bounds, frames, "draft");
  assert.equal(next.windows.length, 3);
  assert.deepEqual(next.routes.draft, {
    feed: "conversation",
    compose: "message",
    voiceRecipients: `${matt},${jared}`,
  });
  assert.deepEqual(
    parseCanvasLayout(JSON.stringify(next)).routes.draft,
    next.routes.draft,
  );
  let saved = 0;
  executeInterfacePlan(
    plan,
    context,
    {
      saveCanvas: (canvas) => {
        saved++;
        assert.equal(canvas.windows.length, 3);
        return true;
      },
    },
    bounds,
    frames,
  );
  assert.equal(saved, 1);
  assert.equal(context.active.canvas.windows.length, 2);
});
test("partial, ambiguous, fabricated and duplicate targets never execute", () => {
  const specs = parameterQuestions("new_dm", "Matt and Jared", ctx());
  for (const second of [
    answer("unavailable"),
    answer(matt),
    answer(jared, 0.51, 0.02),
    answer("made-up"),
  ])
    assert.throws(() =>
      decodePlan("new_dm", specs, {
        count: answer("2"),
        target_1: answer(matt),
        target_2: second,
      }),
    );
  assert.throws(() =>
    selectDecision(
      { action: answer("send_messages") },
      "action",
      actionQuestion(),
    ),
  );
  assert.throws(() =>
    commandCanvas(
      { action: "new_dm", recipients: ["missing"] },
      ctx(),
      bounds,
      frames,
      "draft",
    ),
  );
});
test("move converts to freeform, preserves neighbors, clamps to bounds and raises target", () => {
  const next = commandCanvas(
    { action: "move_window", target: "widget:music", placement: "right" },
    ctx(),
    bounds,
    frames,
    "unused",
  );
  assert.equal(next.layout, "freeform");
  assert.equal(next.freeform.frames["widget:music"].x, 600);
  assert.deepEqual(
    next.freeform.frames["widget:weather"],
    frames["widget:weather"],
  );
  assert.equal(next.freeform.order.at(-1), "widget:music");
  const big = commandCanvas(
    { action: "resize_window", target: "widget:music", size: "maximize" },
    ctx(),
    bounds,
    frames,
    "unused",
  );
  assert.deepEqual(big.freeform.frames["widget:music"], {
    x: 0,
    y: 0,
    width: 1000,
    height: 700,
  });
});
test("closing removes geometry/routes and capacity failures leave existing state intact", () => {
  const context = ctx();
  context.active.canvas.freeform = { frames, order: state.windows };
  context.active.canvas.routes = { "widget:music": { feed: "search" } };
  const next = commandCanvas(
    { action: "close_window", target: "widget:music" },
    context,
    bounds,
    frames,
    "unused",
  );
  assert.ok(!next.freeform.frames["widget:music"]);
  assert.ok(!next.routes["widget:music"]);
  assert.ok(!next.freeform.order.includes("widget:music"));
  context.active.canvas.windows.push("x", "y");
  const original = JSON.stringify(context.active.canvas);
  const expanded = commandCanvas(
    { action: "new_dm", recipients: [matt] },
    context,
    bounds,
    frames,
    "draft",
  );
  assert.equal(expanded.windows.length, 5);
  assert.ok(expanded.windows.includes("draft"));
  assert.equal(JSON.stringify(context.active.canvas), original);
});
test("new workspace chooses its windows, layout and literal name from the registry", () => {
  const specs = parameterQuestions(
    "create_workspace",
    'create a workspace called "Studio" with music and weather',
    ctx(),
  );
  const text = Object.entries(specs.text.criteria).find(
    ([, value]) => value === "Studio",
  )[0];
  const plan = decodePlan("create_workspace", specs, {
    count: answer("2"),
    target_1: answer("widget:music"),
    target_2: answer("widget:weather"),
    layout: answer("grid"),
    text: answer(text),
  });
  let created;
  executeInterfacePlan(
    plan,
    ctx(),
    {
      canCreate: true,
      create: (value) => {
        created = value;
        return true;
      },
    },
    bounds,
    frames,
  );
  assert.deepEqual(created, {
    name: "Studio",
    layout: "freeform",
    windowIds: ["widget:music", "widget:weather"],
    canvas: {
      main: false,
      layout: "freeform",
      windows: ["widget:music", "widget:weather"],
      freeform: {
        order: ["widget:music", "widget:weather"],
        frames: {
          "widget:music": { x: 0, y: 0, width: 500, height: 700 },
          "widget:weather": { x: 500, y: 0, width: 500, height: 700 },
        },
      },
    },
  });
});
test("anchored Home and stale targets produce actionable errors", () => {
  const context = ctx();
  context.active.id = "home";
  delete context.active.canvas.main;
  assert.throws(
    () =>
      commandCanvas(
        { action: "move_window", target: "main", placement: "left" },
        context,
        bounds,
        frames,
        "x",
      ),
    /anchored/,
  );
  assert.throws(
    () =>
      commandCanvas(
        { action: "close_window", target: "gone" },
        context,
        bounds,
        frames,
        "x",
      ),
    /no longer/,
  );
});

test("focusing a connected tab selects it while moving keeps its parent together", () => {
  const context = ctx();
  context.active.canvas.interiors = {
    "widget:music": {
      root: { type: "pane", id: "group" },
      groups: [
        {
          id: "group",
          tabs: ["widget:music", "widget:weather"],
          selected: "widget:music",
        },
      ],
    },
  };
  const focus = commandCanvas(
    { action: "focus_window", target: "widget:weather" },
    context,
    bounds,
    frames,
    "unused",
  );
  assert.equal(
    focus.interiors["widget:music"].groups[0].selected,
    "widget:weather",
  );
  const moved = commandCanvas(
    { action: "move_window", target: "widget:weather", placement: "right" },
    context,
    bounds,
    frames,
    "unused",
  );
  assert.equal(moved.freeform.frames["widget:music"].x, 600);
  assert.deepEqual(moved.interiors, context.active.canvas.interiors);
});
test("an unqualified open preserves layout and crowded recipient questions fit native bounds", () => {
  const context = ctx();
  const questions = parameterQuestions("open_windows", "open music", context);
  const plan = decodePlan("open_windows", questions, {
    count: answer("1"),
    target_1: answer("widget:music"),
    layout: answer("auto"),
  });
  context.active.canvas.layout = "freeform";
  assert.equal(
    commandCanvas(plan, context, bounds, frames, "unused").layout,
    "freeform",
  );
  context.people = Array.from({ length: 120 }, (_, i) => ({
    pubkey: i.toString(16).padStart(64, "0"),
    displayName: "A".repeat(160),
    nip05Handle: "b".repeat(80),
  }));
  const specs = parameterQuestions(
    "new_dm",
    "start a dm with somebody",
    context,
  );
  assert.ok(
    new TextEncoder().encode(
      JSON.stringify({ request: "x", context: "", questions: specs }),
    ).length < 160000,
  );
});

test("voice recipient discovery includes familiar peers absent from relay prefix search", async () => {
  const { rankCommandRecipients } = await import("./recipients.ts");
  const known = [
    {
      pubkey: matt,
      displayName: "mattkursmark",
      nip05Handle: "mattkursmark",
      known: true,
    },
  ];
  const directory = [
    ...Array.from({ length: 100 }, (_, i) => ({
      pubkey: String(i),
      displayName: `Unrelated ${i}`,
      nip05Handle: null,
    })),
    { pubkey: jared, displayName: "Jared", nip05Handle: "jared" },
  ];
  const people = rankCommandRecipients(
    "Can you start me at DM with Matt and Jared?",
    known,
    directory,
    () => true,
  );
  assert.equal(people.length, 80);
  assert.ok(people.slice(0, 2).some((p) => p.pubkey === matt && p.known));
  assert.ok(people.slice(0, 2).some((p) => p.pubkey === jared));
  assert.ok(
    !rankCommandRecipients(
      "Matt",
      known,
      directory,
      (p) => p.pubkey !== matt,
    ).some((p) => p.pubkey === matt),
  );
});

test("recipient resolution favors a familiar short name, preserves ambiguity, and remembers confirmed aliases by scope", async () => {
  const { resolveRecipients } = await import("./recipientClarification.ts");
  const { rememberRecipientAlias, readRecipientAliases, familiarRecipient } =
    await import("./recipients.ts");
  const c = ctx();
  c.people = [
    {
      pubkey: matt,
      displayName: "mattkursmark",
      known: true,
      lastMessageAt: Date.now(),
    },
    {
      pubkey: jared,
      displayName: "jmarr",
      known: true,
      confirmedAliases: ["Jared"],
    },
    { pubkey: "c".repeat(64), displayName: "Matt", known: false },
    { pubkey: "d".repeat(64), displayName: "Brooke Jones", known: false },
  ];
  assert.equal(familiarRecipient("@Jared", c.people), undefined);
  const request = "start a dm with Matt and Jared";
  const specs = parameterQuestions("new_dm", request, c);
  assert.deepEqual(
    resolveRecipients(request, c.people, specs, {
      count: answer("2"),
      target_1: answer("c".repeat(64)),
      target_2: answer("unavailable"),
    }).recipients,
    [matt, jared],
  );
  assert.deepEqual(
    resolveRecipients("start a dm with Matt and Brooke", c.people, specs, {
      count: answer("2"),
      target_1: answer(matt),
      target_2: answer("d".repeat(64)),
    }).recipients,
    [matt, null],
  );
  c.people.push({
    pubkey: "e".repeat(64),
    displayName: "Matthew",
    known: true,
  });
  assert.equal(
    resolveRecipients("start a dm with Matt", c.people, specs, {
      count: answer("1"),
      target_1: answer(matt, 0.51, 0.01),
    }).recipients[0],
    null,
  );
  c.people[0].active = true;
  assert.equal(
    resolveRecipients("start a dm with Matt", c.people, specs, {
      count: answer("1"),
      target_1: answer(matt, 0.51, 0.01),
    }).recipients[0],
    matt,
  );
  const values = new Map();
  const previous = globalThis.localStorage;
  globalThis.localStorage = {
    getItem: (k) => values.get(k) ?? null,
    setItem: (k, v) => values.set(k, v),
  };
  try {
    rememberRecipientAlias("community:user", "Jared", jared);
    assert.deepEqual(readRecipientAliases("community:user")[jared], ["Jared"]);
    assert.deepEqual(readRecipientAliases("other:user"), {});
  } finally {
    globalThis.localStorage = previous;
  }
});

test("Focus commands prepend new windows in mention order without reordering existing ones", () => {
  const context = ctx();
  context.active.canvas = {
    main: false,
    layout: "focus",
    windows: ["widget:weather"],
  };
  const result = commandCanvas(
    { action: "open_windows", windowIds: ["widget:music", "widget:weather"] },
    context,
    bounds,
    {},
    "new",
  );
  assert.deepEqual(result.windows, ["widget:music", "widget:weather"]);
  context.active.canvas = result;
  const draft = commandCanvas(
    { action: "new_dm", recipients: [matt] },
    context,
    bounds,
    {},
    "draft:test",
  );
  assert.deepEqual(draft.windows, [
    "draft:test",
    "widget:music",
    "widget:weather",
  ]);
  assert.deepEqual(draft.routes["draft:test"].voiceRecipients, matt);
  const ordinary = ctx();
  ordinary.active.canvas.windows = ["widget:weather"];
  assert.deepEqual(
    commandCanvas(
      { action: "open_windows", windowIds: ["widget:music"] },
      ordinary,
      bounds,
      {},
      "new",
    ).windows,
    ["widget:weather", "widget:music"],
  );
});
