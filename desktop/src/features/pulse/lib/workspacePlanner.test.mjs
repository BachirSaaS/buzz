import assert from "node:assert/strict";
import { test } from "node:test";
import { buildWindowCatalog, searchWindowCatalog } from "./windowCatalog.ts";
import { parameterQuestions } from "../voice/plan.ts";
import { intentBatches } from "../voice/intent.ts";
const workspacePlanInput = (request, catalog) => {
  const ctx = {
    catalog,
    people: [],
    active: { id: "home", name: "Home", canvas: { windows: [] } },
    workspaces: [],
  };
  const questions = parameterQuestions("create_workspace", request, ctx);
  const ids = [
    ...new Set(
      Object.entries(questions)
        .filter(([id]) => id.startsWith("target_"))
        .flatMap(([, question]) => Object.keys(question.criteria)),
    ),
  ].filter((id) => catalog.some((v) => v.id === id));
  return { questions, catalog: ids.map((id) => ({ id })) };
};
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
  // The shared native transport limits each batch, not the complete plan.
  const batches = intentBatches({
    request: "message jmarr and check the weather and my projects",
    context: JSON.stringify(input.catalog),
    questions: input.questions,
  });
  for (const batch of batches) {
    assert.ok(Object.keys(batch.questions).length <= 12);
    assert.ok(new TextEncoder().encode(JSON.stringify(batch)).length <= 160000);
  }
  assert.deepEqual(
    Object.assign({}, ...batches.map((batch) => batch.questions)),
    input.questions,
  );
});
test("casual names, separator differences and typos survive the 80-candidate shortlist", () => {
  const unrelated = Array.from({ length: 100 }, (_, i) => ({
    id: `channel:${i}`,
    kind: "channel",
    title: `#unrelated-${i}`,
    aliases: [],
    description: "Existing channel",
  }));
  const requested = [
    {
      id: "dm:matt",
      kind: "dm",
      title: "Matt Kursmark",
      aliases: ["mattkursmark"],
      description: "Existing one-to-one direct message.",
    },
    {
      id: "channel:buzz-design",
      kind: "channel",
      title: "#buzz-design",
      aliases: ["buzz-design"],
      description: "Existing channel",
    },
    {
      id: "widget:music",
      kind: "widget",
      title: "Music",
      aliases: ["music"],
      description: "Music widget",
    },
  ];
  for (const request of [
    "mattkursmark, buzz design, music",
    "mattkurs, buzzdesign, music",
    "matkursmark, buzz desgin, musci",
  ]) {
    const input = workspacePlanInput(request, [...unrelated, ...requested]);
    for (const entry of requested)
      assert.ok(
        input.catalog.slice(0, 3).some((item) => item.id === entry.id),
        `${request}: ${entry.id}`,
      );
  }
});
