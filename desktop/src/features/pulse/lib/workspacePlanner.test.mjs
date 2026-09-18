import assert from "node:assert/strict";
import { test } from "node:test";
import { buildWindowCatalog, searchWindowCatalog } from "./windowCatalog.ts";
import { workspacePlanInput, parseWorkspacePlan } from "./workspacePlanner.ts";
const person = {
  name: "jmarr",
  displayName: "John Marr",
  nip05Handle: "jmarr@buzz.test",
  avatarUrl: null,
};
const channel = {
  id: "dm-j",
  name: "opaque-dm-name",
  channelType: "dm",
  isMember: true,
  archivedAt: null,
  participantPubkeys: ["me", "john"],
  participants: ["Me", "John"],
};
const entries = () =>
  buildWindowCatalog({
    channels: [
      channel,
      { ...channel, id: "archived", archivedAt: "today" },
      { ...channel, id: "outsider", isMember: false },
    ],
    profiles: { john: person },
    currentPubkey: "me",
    projects: [],
    widgets: [{ id: "weather", title: "Weather" }],
    projectsEnabled: true,
    workflowsEnabled: false,
  });
test("catalog resolves username aliases and excludes unavailable objects and feature areas", () => {
  const catalog = entries();
  const dm = searchWindowCatalog(catalog, "message @jmarr")[0];
  assert.equal(dm.id, "dm:dm-j");
  assert.equal(dm.title, "John Marr");
  assert.ok(dm.aliases.includes("jmarr"));
  assert.ok(
    !catalog.some((item) =>
      ["dm:archived", "dm:outsider", "app:workflows"].includes(item.id),
    ),
  );
});
test("model input is bounded and ranks requested people ahead of unrelated names", () => {
  const unrelated = Array.from({ length: 200 }, (_, i) => ({
    id: `dm:${i}`,
    kind: "dm",
    title: `Person ${i}`,
    aliases: [],
    description: "Existing DM",
    secret: "not sent",
  }));
  const input = workspacePlanInput(
    "message jmarr and check the weather and my projects",
    [...unrelated, ...entries()],
  );
  assert.equal(input.catalog.length, 80);
  for (const id of ["dm:dm-j", "widget:weather", "app:projects"])
    assert.ok(input.catalog.slice(0, 4).some((item) => item.id === id));
  assert.ok(!JSON.stringify(input).includes("secret"));
  assert.ok(!JSON.stringify(input).includes("avatarUrl"));
  assert.ok(new TextEncoder().encode(JSON.stringify(input)).length <= 60000);
});
test("plans must be complete, unique, grounded, and limited to four windows", () => {
  const catalog = entries();
  const good = {
    name: "My desk",
    layout: "grid",
    windowIds: ["dm:dm-j", "widget:weather", "app:projects"],
    unresolved: [],
  };
  assert.deepEqual(parseWorkspacePlan(good, catalog), {
    name: good.name,
    layout: good.layout,
    windowIds: good.windowIds,
  });
  for (const bad of [
    null,
    {},
    { ...good, windowIds: ["invented"] },
    { ...good, windowIds: [] },
    { ...good, windowIds: ["widget:weather", "widget:weather"] },
    { ...good, windowIds: catalog.slice(0, 5).map((item) => item.id) },
    { ...good, layout: "surprise" },
    { ...good, name: "x".repeat(49) },
    { ...good, unresolved: ["Which Matt did you mean?"] },
  ])
    assert.throws(() => parseWorkspacePlan(bad, catalog));
  assert.throws(() =>
    parseWorkspacePlan(
      good,
      catalog.filter((item) => item.id !== "dm:dm-j"),
    ),
  );
});
