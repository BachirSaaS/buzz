// Uses the production registry; run with desktop/test-loader.mjs and native live_interface_fixture.
import { actionQuestion } from "./intent.ts";
import { parameterQuestions } from "./plan.ts";
const ctx = {
  active: {
    id: "desk",
    name: "Desk",
    route: {},
    canvas: {
      main: false,
      layout: "columns",
      windows: ["widget:music", "widget:weather"],
    },
  },
  workspaces: [{ id: "desk", name: "Desk" }],
  people: [],
  focused: "widget:music",
  catalog: ["music", "weather"].map((name) => ({
    id: `widget:${name}`,
    title: name,
    kind: "widget",
    description: `${name} widget`,
    aliases: [name],
  })),
};
const cases = [
  [
    "put music in the left half",
    "move_window",
    { window: "widget:music", placement: "left_half" },
  ],
  [
    "weather should take the bottom third",
    "move_window",
    { window: "widget:weather", placement: "bottom_third" },
  ],
  [
    "move weather to the top right quarter",
    "move_window",
    { window: "widget:weather", placement: "top_right_quarter" },
  ],
  [
    "make music a small window",
    "resize_window",
    { window: "widget:music", size: "small" },
  ],
  [
    "make this a large window",
    "resize_window",
    { window: "widget:music", size: "large" },
  ],
  ["split screen side by side", "arrange_windows", { layout: "columns" }],
  ["split the windows top and bottom", "arrange_windows", { layout: "rows" }],
  ["put the windows in a grid", "arrange_windows", { layout: "grid" }],
  [
    "put music in the left half and weather in the right half",
    "arrange_windows",
    { layout: "custom", area_1: "left_half", area_2: "right_half" },
  ],
  [
    "create a workspace with music on the left half and weather on the right half",
    "create_workspace",
    {
      count: "2",
      target_1: "widget:music",
      target_2: "widget:weather",
      area_1: "left_half",
      area_2: "right_half",
      layout: "custom",
      text: "0",
      scope: "create",
    },
  ],
  [
    "Message Matt and Jared and check the weather",
    "create_workspace",
    {
      count: "2",
      target_1: "draft:message",
      target_2: "widget:weather",
      layout: "auto",
      text: "0",
      area_1: "none",
      area_2: "none",
      scope: "create",
    },
    true,
  ],
  [
    "Send Matt a message saying hello",
    "create_workspace",
    { scope: "unsupported" },
    true,
  ],
];
console.log(
  JSON.stringify(
    cases.flatMap(([request, action, expected, fixed]) => {
      const base = {
        request,
        context: JSON.stringify({ workspace: "Desk", focused: "widget:music" }),
      };
      return [
        ...(!fixed
          ? [
              {
                input: { ...base, questions: { action: actionQuestion() } },
                expected: { action },
              },
            ]
          : []),
        {
          input: {
            ...base,
            questions: parameterQuestions(action, request, ctx),
          },
          expected,
        },
      ];
    }),
    null,
    2,
  ),
);
