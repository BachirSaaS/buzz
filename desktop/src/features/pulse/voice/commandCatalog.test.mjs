import assert from "node:assert/strict";
import { test } from "node:test";
import { buildWindowCatalog } from "../lib/windowCatalog.ts";
import {
  commandEntries,
  directCommand,
  searchCommandEntries,
} from "./commandCatalog.ts";
import { commandCanvas } from "./execute.ts";

const catalog = (enabled = true) =>
  buildWindowCatalog({
    channels: [],
    profiles: {},
    projects: [],
    widgets: [{ id: "music", title: "Music" }],
    projectsEnabled: enabled,
    workflowsEnabled: enabled,
  });
const context = {
  catalog: catalog(),
  workspaces: [{ id: "projects", name: "Projects" }],
  active: {
    id: "studio",
    name: "Studio",
    canvas: { main: false, layout: "columns", windows: [] },
  },
  people: [],
  focused: null,
};
test("natural list requests use real app destinations rather than the model or same-named workspace", () => {
  const entries = commandEntries(context);
  for (const request of [
    "show me a list of my projects",
    "Projects",
    "please show my projects",
    "can you list all of my projects?",
  ]) {
    const plan = directCommand(request, entries);
    assert.deepEqual(plan, {
      action: "open_windows",
      windowIds: ["app:projects"],
    });
    assert.deepEqual(
      commandCanvas(plan, context, { width: 1000, height: 800 }, {}, "unused")
        .windows,
      ["app:projects"],
    );
  }
  for (const [request, id] of [
    ["show my issues", "app:project-issues"],
    ["repositories", "app:project-repositories"],
    ["show my reviews", "app:project-prs"],
    ["browse agents", "app:agent-directory"],
    ["available agents", "app:agent-directory"],
    ["create a workflow", "app:new-workflow"],
  ]) {
    assert.deepEqual(directCommand(request, entries)?.windowIds, [id]);
  }
  assert.equal(
    context.catalog.find((view) => view.id === "app:projects").initialRoute
      .projectSection,
    "projects",
  );
});
test("feature gates, ambiguity and additional operations cannot silently open the wrong destination", () => {
  const entries = commandEntries({ catalog: catalog(false), workspaces: [] });
  assert.equal(directCommand("show my projects", entries), null);
  for (const request of [
    "delete all messages",
    "open music and send Alice hello",
    "show projects then delete them",
    "make music 25% smaller",
    "don't open music",
  ]) {
    assert.equal(directCommand(request, commandEntries(context)), null);
  }
  const duplicate = [
    ...commandEntries(context),
    {
      id: "duplicate",
      title: "Music",
      aliases: [],
      plan: { action: "open_settings" },
    },
  ];
  assert.equal(directCommand("open music", duplicate), null);
});
test("search keeps verbatim terms and discovery is bounded with concrete plans", () => {
  const entries = commandEntries(context);
  assert.deepEqual(
    directCommand("search Buzz for in:design launch plans", entries),
    { action: "search_messages", text: "in:design launch plans" },
  );
  assert.deepEqual(
    directCommand("find messages about quarterly plan", entries),
    { action: "search_messages", text: "quarterly plan" },
  );
  assert.deepEqual(directCommand("open appearance settings", entries), {
    action: "open_settings",
    section: "appearance",
  });
  assert.equal(searchCommandEntries(entries, "projec")[0].title, "Projects");
  assert.ok(searchCommandEntries(entries, "project").length <= 6);
});
