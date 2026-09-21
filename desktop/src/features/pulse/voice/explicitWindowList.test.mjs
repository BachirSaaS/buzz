import assert from "node:assert/strict";
import { test } from "node:test";
import { explicitWindowList } from "./explicitWindowList.ts";
import { parameterQuestions, decodePlan } from "./plan.ts";
import { executeInterfacePlan } from "./execute.ts";

const catalog = [
  ["channel:design", "#buzz-design", "channel"],
  ["channel:interface", "#buzz-interface-squad", "channel"],
  ["widget:weather", "Weather", "widget"],
].map(([id, title, kind]) => ({
  id,
  title,
  kind,
  aliases: [],
  description: "Existing Buzz view",
}));
const request = "buzz design, buzz interface squad, weather";
const active = { id: "home", name: "Home", route: {}, canvas: { windows: [] } };
const ctx = {
  active,
  workspaces: [active],
  catalog,
  people: [],
  focused: null,
};
const answer = (choice) => ({ choice, probability: 0.98, margin: 0.95 });

test("exact mixed channel/widget lists use catalog-backed slots and create every window atomically", () => {
  const specs = parameterQuestions("create_workspace", request, ctx);
  assert.equal(specs.count, undefined);
  assert.equal(specs.target_4, undefined);
  const answers = Object.fromEntries(
    Object.keys(specs).map((id) => [
      id,
      answer(
        id.startsWith("target_")
          ? catalog[Number(id.slice(7)) - 1].id
          : id === "scope"
            ? "create"
            : id === "layout"
              ? "auto"
              : id === "text"
                ? "0"
                : "none",
      ),
    ]),
  );
  const plan = decodePlan("create_workspace", specs, answers, ctx);
  assert.deepEqual(
    plan.windowIds,
    catalog.map((entry) => entry.id),
  );
  let writes = 0;
  executeInterfacePlan(
    plan,
    ctx,
    {
      canCreate: true,
      create(blueprint) {
        writes++;
        assert.deepEqual(
          blueprint.windowIds,
          catalog.map((entry) => entry.id),
        );
        return true;
      },
    },
    { width: 1400, height: 900 },
    {},
  );
  assert.equal(writes, 1);
  for (const choice of ["none", "unavailable", "channel:invented"]) {
    assert.throws(() =>
      decodePlan(
        "create_workspace",
        specs,
        { ...answers, target_2: answer(choice) },
        ctx,
      ),
    );
  }
  assert.throws(() =>
    decodePlan(
      "create_workspace",
      specs,
      {
        ...answers,
        target_2: { choice: catalog[1].id, probability: 0.4, margin: 0.05 },
      },
      ctx,
    ),
  );
});

test("list matching normalizes separators, preserves order and never guesses incomplete or ambiguous names", () => {
  assert.deepEqual(explicitWindowList(request, catalog), catalog);
  assert.deepEqual(
    explicitWindowList("#BUZZ-DESIGN\n#buzz-interface-squad\nweather", catalog),
    catalog,
  );
  assert.deepEqual(explicitWindowList("weather, weather", catalog), [
    catalog[2],
  ]);
  for (const input of [
    "buzz design, unknown, weather",
    "buzz, weather",
    "buzz design, weather on the left",
    "DM with Matt and Jared, weather",
    "weather,",
    "weather",
    Array(9).fill("weather").join(","),
  ]) {
    assert.equal(explicitWindowList(input, catalog), undefined, input);
    assert.ok(parameterQuestions("create_workspace", input, ctx).count);
  }
  assert.equal(
    explicitWindowList(request, [
      ...catalog,
      { ...catalog[0], id: "project:other" },
    ]),
    undefined,
  );
});
