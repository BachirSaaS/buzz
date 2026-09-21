// Opt-in Jev regression through the production native transport.
import { buildWindowCatalog } from "../lib/windowCatalog.ts";
import { actionQuestion } from "./intent.ts";
import { parameterQuestions } from "./plan.ts";
const catalog = buildWindowCatalog({
  channels: [],
  profiles: {},
  projects: [],
  widgets: [],
  projectsEnabled: true,
  workflowsEnabled: true,
});
const ctx = {
  catalog,
  people: [],
  active: { id: "home", name: "Home", canvas: { windows: [] } },
  workspaces: [],
};
const cases = [
  [
    "show me a list of my projects",
    "open_windows",
    { count: "1", target_1: "app:projects" },
  ],
  [
    "what repositories do I have",
    "open_windows",
    { count: "1", target_1: "app:project-repositories" },
  ],
  [
    "let me see my pull requests",
    "open_windows",
    { count: "1", target_1: "app:project-prs" },
  ],
  [
    "I'd like to browse available agents",
    "open_windows",
    { count: "1", target_1: "app:agent-directory" },
  ],
  [
    "where can I change my notification preferences",
    "open_settings",
    { section: "notifications" },
  ],
  ["create a channel", "new_channel", {}],
];
console.log(
  JSON.stringify(
    cases.flatMap(([request, action, expected]) => {
      const base = {
        request,
        context: JSON.stringify({
          availableViews: catalog
            .filter((v) => v.kind === "app")
            .map((v) => ({ title: v.title, purpose: v.description })),
        }),
      };
      const parameters = parameterQuestions(action, request, ctx);
      return [
        {
          input: { ...base, questions: { action: actionQuestion() } },
          expected: { action },
        },
        ...(Object.keys(parameters).length
          ? [{ input: { ...base, questions: parameters }, expected }]
          : []),
      ];
    }),
  ),
);
