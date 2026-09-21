import assert from "node:assert/strict";
import { test } from "node:test";
import { manageWorkspace } from "./workspaceManagement.ts";
import { parameterQuestions, decodePlan } from "./plan.ts";
import { executeInterfacePlan } from "./execute.ts";
import { parseWorkspaces } from "../lib/pulseWorkspaces.ts";

const state = () => ({
  active: "studio",
  items: [
    {
      id: "home",
      name: "Home",
      route: { feed: "home" },
      canvas: { layout: "columns", windows: [] },
    },
    {
      id: "studio",
      name: "Studio",
      route: {},
      canvas: {
        main: false,
        layout: "columns",
        windows: ["widget:music"],
        routes: { "widget:music": { feed: "search", windowSearch: "launch" } },
      },
    },
    {
      id: "work",
      name: "Work",
      route: {},
      canvas: { main: false, layout: "columns", windows: [] },
    },
  ],
});
const context = (saved) => ({
  active: saved.items[1],
  workspaces: saved.items,
  catalog: [],
  people: [],
  focused: null,
  workspaceIcons: { studio: "music" },
});
const answer = (choice) => ({ choice, probability: 0.98, margin: 0.95 });
test("explicit icons are allowlisted, persist in the workspace snapshot and commit atomically", () => {
  const saved = state(),
    ctx = context(saved);
  const specs = parameterQuestions(
    "set_workspace_icon",
    "change this workspace icon to a message icon",
    ctx,
  );
  const plan = decodePlan(
    "set_workspace_icon",
    specs,
    { workspace: answer("studio"), icon: answer("messages") },
    ctx,
  );
  let writes = 0,
    next;
  executeInterfacePlan(
    plan,
    ctx,
    {
      checkpoint: () => saved,
      restore: (value) => {
        writes++;
        next = value;
        return true;
      },
    },
    {},
    {},
  );
  assert.equal(writes, 1);
  assert.equal(next.items[1].icon, "messages");
  assert.deepEqual(next.items[1].canvas, saved.items[1].canvas);
  assert.equal(parseWorkspaces(JSON.stringify(next)).items[1].icon, "messages");
  assert.throws(() =>
    manageWorkspace({ ...plan, icon: "bad" }, saved, ctx, "new"),
  );
  assert.equal(saved.items[1].icon, undefined);
});
test("duplicate copies routes and arrangement, retains the current icon, and respects capacity", () => {
  const saved = state(),
    ctx = context(saved);
  const next = manageWorkspace(
    { action: "duplicate_workspace", workspace: "studio", text: "After hours" },
    saved,
    ctx,
    "copy",
  );
  assert.equal(next.active, "copy");
  assert.deepEqual(
    next.items.map((item) => item.id),
    ["home", "studio", "copy", "work"],
  );
  assert.equal(next.items[2].icon, "music");
  assert.deepEqual(next.items[2].canvas, saved.items[1].canvas);
  next.items[2].canvas.windows.push("widget:weather");
  assert.equal(saved.items[1].canvas.windows.length, 1);
  const full = {
    ...saved,
    items: Array.from({ length: 12 }, (_, i) => ({
      ...saved.items[1],
      id: i ? String(i) : "studio",
    })),
  };
  assert.throws(
    () =>
      manageWorkspace(
        { action: "duplicate_workspace", workspace: "studio" },
        full,
        ctx,
        "copy",
      ),
    /Close a workspace/,
  );
});
test("dock movement, clearing and closing others change just the requested workspace state", () => {
  const saved = state(),
    ctx = context(saved);
  for (const [position, ids] of [
    ["first", ["studio", "home", "work"]],
    ["last", ["home", "work", "studio"]],
    ["previous", ["studio", "home", "work"]],
    ["next", ["home", "work", "studio"]],
    ["after", ["home", "work", "studio"]],
  ]) {
    const next = manageWorkspace(
      {
        action: "reorder_workspace",
        workspace: "studio",
        workspacePosition: position,
        referenceWorkspace: "work",
      },
      saved,
      ctx,
      "copy",
    );
    assert.deepEqual(
      next.items.map((item) => item.id),
      ids,
    );
    assert.equal(next.active, "studio");
    assert.equal(
      next.items.find((item) => item.id === "studio").canvas,
      saved.items[1].canvas,
    );
  }
  assert.throws(() =>
    manageWorkspace(
      {
        action: "reorder_workspace",
        workspace: "studio",
        workspacePosition: "before",
        referenceWorkspace: "missing",
      },
      saved,
      ctx,
      "copy",
    ),
  );
  const empty = manageWorkspace(
    { action: "clear_workspace", workspace: "studio" },
    saved,
    ctx,
    "copy",
  );
  assert.deepEqual(empty.items[1].canvas, {
    main: false,
    layout: "columns",
    windows: [],
  });
  const home = manageWorkspace(
    { action: "clear_workspace", workspace: "home" },
    saved,
    ctx,
    "copy",
  );
  assert.notEqual(home.items[0].canvas.main, false);
  assert.deepEqual(
    manageWorkspace(
      { action: "close_other_workspaces", workspace: "work" },
      saved,
      ctx,
      "copy",
    ),
    { active: "work", items: [saved.items[2]] },
  );
});
test("relative workspace selection wraps in dock order and unused neighbor answers cannot veto movement", () => {
  const saved = state(),
    ctx = context(saved);
  const specs = parameterQuestions("switch_workspace", "next workspace", ctx);
  assert.match(specs.workspace.criteria.work, /next workspace/);
  assert.match(specs.workspace.criteria.home, /previous workspace/);
  const homeSpecs = parameterQuestions(
    "switch_workspace",
    "previous workspace",
    { ...ctx, active: saved.items[0] },
  );
  assert.match(homeSpecs.workspace.criteria.work, /previous workspace/);
  assert.equal(
    decodePlan("switch_workspace", specs, { workspace: answer("work") }, ctx)
      .workspace,
    "work",
  );
  assert.equal(
    decodePlan(
      "switch_workspace",
      specs,
      { workspace: answer("work") },
      { ...ctx, active: saved.items[0] },
    ).workspace,
    "work",
  );
  const reorder = parameterQuestions(
    "reorder_workspace",
    "move this workspace to the top",
    ctx,
  );
  assert.equal(
    decodePlan(
      "reorder_workspace",
      reorder,
      { workspace: answer("studio"), position: answer("first") },
      ctx,
    ).workspacePosition,
    "first",
  );
});
