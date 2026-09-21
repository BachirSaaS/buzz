import { actionQuestion, intentBatches } from "./intent.ts";
import { parameterQuestions } from "./plan.ts";
const ids = ["dm:kenny", "dm:cynthia", "widget:music"];
const active = {
  id: "desk",
  name: "Desk",
  route: {},
  canvas: { main: false, layout: "freeform", windows: ids },
};
const catalog = [...ids, "app:projects"].map((id, i) => ({
  id,
  title: ["Kenny", "Cynthia", "Music", "Projects"][i],
  kind: i < 2 ? "dm" : i === 2 ? "widget" : "app",
  aliases: [],
  description: i === 3 ? "The list of my projects" : "Buzz window",
}));
const move = {
  workspace: "desk",
  request: "move Kenny and Cynthia to the right",
  action: "move_window",
  targets: ids.slice(0, 2),
  placement: "nudge_right",
};
const cases = [
  [
    "projects on the left",
    "open_windows",
    { count: "1", target_1: "app:projects", area_1: "left" },
  ],
  [
    "open projects and put it on the left",
    "open_windows",
    { count: "1", target_1: "app:projects", area_1: "left" },
  ],
  [
    "move Kenny and Cynthia to the right",
    "move_window",
    { window: "group:0,1", placement: "nudge_right" },
  ],
  [
    "move them more",
    "move_window",
    { window: "group:0,1", placement: "nudge_right" },
    move,
  ],
  [
    "move them left instead",
    "move_window",
    { window: "group:0,1", placement: "nudge_left" },
    move,
  ],
  [
    "make it bigger",
    "resize_window",
    { window: "app:projects", size: "bigger" },
    {
      workspace: "desk",
      request: "projects on the left",
      action: "open_windows",
      targets: ["app:projects"],
      placement: "left",
    },
  ],
];
console.log(
  JSON.stringify(
    cases.flatMap(([request, action, expected, recent]) => {
      const ctx = {
        active: {
          ...active,
          canvas: {
            ...active.canvas,
            windows: recent?.targets.includes("app:projects")
              ? [...ids, "app:projects"]
              : ids,
          },
        },
        workspaces: [active],
        catalog,
        people: [],
        focused: "widget:music",
        recent,
      };
      const base = {
        request,
        context: JSON.stringify({
          workspace: "Desk",
          recentCommand: recent,
          windows: ctx.active.canvas.windows,
          availableViews: catalog,
        }),
      };
      return [
        {
          input: { ...base, questions: { action: actionQuestion() } },
          expected: { action },
        },
        ...intentBatches({
          ...base,
          questions: parameterQuestions(action, request, ctx),
        }).map((input) => ({
          input,
          expected: Object.fromEntries(
            Object.entries(expected).filter(([key]) => key in input.questions),
          ),
        })),
      ];
    }),
  ),
);
