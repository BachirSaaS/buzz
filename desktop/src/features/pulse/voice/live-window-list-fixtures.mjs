import { parameterQuestions } from "./plan.ts";
import { intentBatches } from "./intent.ts";
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
const active = { id: "home", name: "Home", route: {}, canvas: { windows: [] } };
const ctx = {
  active,
  workspaces: [active],
  catalog,
  people: [],
  focused: null,
};
const expected = {
  target_1: catalog[0].id,
  target_2: catalog[1].id,
  target_3: catalog[2].id,
  layout: "auto",
  scope: "create",
  text: "0",
  area_1: "none",
  area_2: "none",
  area_3: "none",
};
console.log(
  JSON.stringify(
    [
      "buzz design, buzz interface squad, weather",
      "#buzz-design, #buzz-interface-squad, Weather",
    ].flatMap((request) =>
      intentBatches({
        request,
        context: "The New workspace prompt describes its desired contents.",
        questions: parameterQuestions("create_workspace", request, ctx),
      }).map((input) => ({ input, expected })),
    ),
  ),
);
