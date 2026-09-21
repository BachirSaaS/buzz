// Production live-listening prompts against Jev. No microphone or relay writes.
import { liveIntentInput } from "./liveIntent.ts";
const ctx = {
  token: "test",
  description: "Workspace Studio. Open windows: music, weather.",
  clarifying: false,
};
const cases = [
  ["so I've been looking at this all morning open music", "act", "open music"],
  ["I could use some music", "act", "I could use some music"],
  ["start a dm with Matt and Jared", "act", "start a dm with Matt and Jared"],
  ["start a dm with Matt and", "wait"],
  ["I saw Matt yesterday and we talked about music", "ignore"],
  ["don't open music", "ignore"],
  ["if I asked you to open music what would happen", "ignore"],
  ["open music then move it left", "act", "open music"],
  ["make this window bigger", "act", "make this window bigger"],
];
const fixture = (text, readiness, command, clarifying = false) => {
  const input = liveIntentInput(text, { ...ctx, clarifying }, []);
  const choice =
    command &&
    Object.entries(input.questions.command.criteria).find(
      ([, value]) => value === command,
    )?.[0];
  if (command && !choice) throw new Error(`Missing candidate: ${command}`);
  return {
    input,
    expected: { readiness, ...(choice ? { command: choice } : {}) },
  };
};
console.log(
  JSON.stringify(
    [
      ...cases.map((args) => fixture(...args)),
      fixture("the first one", "act", "the first one", true),
    ],
    null,
    2,
  ),
);
