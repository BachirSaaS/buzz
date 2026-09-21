// Generate live API fixtures using the production question builders.
// node --import ./test-loader.mjs --experimental-strip-types src/features/pulse/voice/live-fixtures.mjs > /tmp/interface-fixtures.json
import { actionQuestion } from "./intent.ts";
import { parameterQuestions } from "./plan.ts";
const catalog = [
  {
    id: "widget:music",
    title: "Music",
    kind: "widget",
    aliases: ["music player"],
    description: "Music player widget",
  },
  {
    id: "widget:weather",
    title: "Weather",
    kind: "widget",
    aliases: [],
    description: "Weather widget",
  },
  {
    id: "channel:buzz-design",
    title: "buzz-design",
    kind: "channel",
    aliases: ["buzz design"],
    description: "Design channel",
  },
  {
    id: "app:projects",
    title: "Projects",
    kind: "app",
    aliases: ["my projects"],
    description: "Projects app",
  },
];
const ctx = {
  active: {
    id: "studio",
    name: "Studio",
    canvas: {
      main: false,
      layout: "columns",
      windows: ["widget:music", "widget:weather"],
    },
  },
  workspaces: [
    { id: "home", name: "Home" },
    { id: "studio", name: "Studio" },
  ],
  catalog,
  people: [
    {
      pubkey: "a".repeat(64),
      displayName: "mattkursmark",
      known: true,
      nip05Handle: "mattkursmark",
    },
    {
      pubkey: "b".repeat(64),
      displayName: "jmarr",
      nip05Handle: "jmarr",
      known: true,
      confirmedAliases: ["Jared"],
    },
    { pubkey: "c".repeat(64), displayName: "Matt", nip05Handle: "matt" },
  ],
  focused: "widget:music",
};
const cases = [
  [
    "Can you start me at DM with Matt and Jared?",
    "new_dm",
    { count: "2", target_1: "a".repeat(64), target_2: "b".repeat(64) },
  ],
  [
    "open buzz design and music",
    "open_windows",
    { count: "2", target_1: "channel:buzz-design", target_2: "widget:music" },
  ],
  [
    "create a workspace with weather and my projects side by side",
    "create_workspace",
    {
      count: "2",
      target_1: "widget:weather",
      target_2: "app:projects",
      layout: "columns",
      text: "0",
    },
  ],
  [
    "move music left",
    "move_window",
    { window: "widget:music", placement: "left" },
  ],
  [
    "make this window bigger",
    "resize_window",
    { window: "widget:music", size: "bigger" },
  ],
  ["switch to Home", "switch_workspace", { workspace: "home" }],
  ["put the windows in a grid", "arrange_windows", { layout: "grid" }],
  ["send Matt a message saying hello", "unsupported", {}],
];
console.log(
  JSON.stringify(
    cases.flatMap(([request, action, expected]) => {
      const base = {
        request,
        context: JSON.stringify({
          workspace: "Studio",
          focused: "widget:music",
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
    null,
    2,
  ),
);
