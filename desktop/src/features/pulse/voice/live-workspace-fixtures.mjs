import { actionQuestion, intentBatches } from "./intent.ts";
import { parameterQuestions } from "./plan.ts";
const workspaces = [
  {
    id: "home",
    name: "Home",
    route: { feed: "home" },
    canvas: { windows: [] },
  },
  {
    id: "studio",
    name: "Studio",
    route: {},
    canvas: { main: false, windows: ["widget:music"], layout: "columns" },
  },
  {
    id: "design",
    name: "Design",
    route: {},
    canvas: { main: false, windows: [], layout: "columns" },
  },
];
const ctx = {
  active: workspaces[1],
  workspaces,
  catalog: ["music", "weather", "inbox", "news", "location", "activity"].map(
    (id) => ({
      id: `widget:${id}`,
      title: id,
      aliases: [],
      kind: "widget",
      description: `${id} widget`,
    }),
  ),
  people: [],
  focused: null,
};
const cases = [
  [
    "open music, weather, inbox, news, location and activity widgets",
    "open_windows",
    {
      count: "6",
      layout: "auto",
      target_1: "widget:music",
      target_2: "widget:weather",
      target_3: "widget:inbox",
      target_4: "widget:news",
      target_5: "widget:location",
      target_6: "widget:activity",
    },
  ],
  ["use focus layout", "arrange_windows", { layout: "focus" }],
  [
    "arrange my windows in a single scrolling list like Home",
    "arrange_windows",
    { layout: "focus" },
  ],
  [
    "change this workspace icon to a message icon",
    "set_workspace_icon",
    { workspace: "studio", icon: "messages" },
  ],
  [
    "give Design a moon icon",
    "set_workspace_icon",
    { workspace: "design", icon: "moon" },
  ],
  [
    "duplicate this workspace",
    "duplicate_workspace",
    { workspace: "studio", text: "0" },
  ],
  [
    "move Design above Studio in the dock",
    "reorder_workspace",
    { workspace: "design", position: "before", reference_workspace: "studio" },
  ],
  [
    "put this workspace at the bottom",
    "reorder_workspace",
    { workspace: "studio", position: "last" },
  ],
  ["clear this workspace", "clear_workspace", { workspace: "studio" }],
  [
    "close all other workspaces",
    "close_other_workspaces",
    { workspace: "studio" },
  ],
  ["next workspace", "switch_workspace", { workspace: "design" }],
];
console.log(
  JSON.stringify(
    cases.flatMap(([request, action, expected]) => {
      const base = {
        request,
        context: JSON.stringify({ workspace: "Studio", workspaces }),
      };
      const questions = parameterQuestions(action, request, ctx);
      return [
        {
          input: { ...base, questions: { action: actionQuestion() } },
          expected: { action },
        },
        ...intentBatches({ ...base, questions }).map((input) => ({
          input,
          expected: Object.fromEntries(
            Object.entries(expected).filter(([id]) => id in input.questions),
          ),
        })),
      ];
    }),
  ),
);
