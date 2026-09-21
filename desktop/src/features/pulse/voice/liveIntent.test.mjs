import assert from "node:assert/strict";
import { test } from "node:test";
import { LiveIntentSession, liveIntentInput } from "./liveIntent.ts";
import { LiveSpeechBuffer, encodeSpeech } from "./liveSpeech.ts";
const decision = (choice) => ({
  choice: String(choice),
  probability: 0.95,
  margin: 0.9,
});
const answers = (input, readiness = "act", span) => ({
  readiness: decision(readiness),
  command: decision(
    Object.entries(input.questions.command.criteria).find(
      ([, v]) =>
        v === (span ?? input.request.split(/\s+/).slice(0, 2).join(" ")),
    )?.[0] ?? "none",
  ),
});
const settle = () => new Promise((resolve) => setTimeout(resolve, 5));
function harness(interpret = async (input) => answers(input)) {
  const calls = [],
    errors = [];
  let token = "home";
  const engine = new LiveIntentSession({
    context: () => ({ token, description: "Home", clarifying: false }),
    interpret,
    run: async (...args) => {
      calls.push(args.slice(0, 1));
    },
    error: (e) => errors.push(e),
  });
  return {
    engine,
    calls,
    errors,
    switch: () => {
      token = "elsewhere";
    },
  };
}
test("stable partial speech acts before any final/stop and never replays the growing prefix", async () => {
  const h = harness();
  h.engine.update({ id: 0, text: "open music", final: false });
  await settle();
  assert.equal(h.calls.length, 0);
  h.engine.update({ id: 0, text: "open music", final: false });
  await settle();
  assert.deepEqual(h.calls, [["open music"]]);
  h.engine.update({ id: 0, text: "open music", final: true });
  await settle();
  assert.equal(h.calls.length, 1);
  h.engine.stop();
});
test("unrelated chatter and unfinished lists don't execute; spontaneous multi-step speech consumes each span once", async () => {
  const h = harness(async (input) => {
    if (input.request.includes("just chatting"))
      return answers(input, "ignore");
    if (input.request.endsWith("and")) return answers(input, "wait");
    return input.request.startsWith("then")
      ? answers(input, "act", "move it left")
      : answers(input);
  });
  h.engine.update({ id: 0, text: "just chatting about music", final: true });
  await settle();
  h.engine.update({ id: 1, text: "open music and", final: false });
  await settle();
  assert.equal(h.calls.length, 0);
  h.engine.update({ id: 1, text: "open music then move it left", final: true });
  await settle();
  assert.deepEqual(h.calls, [["open music"], ["move it left"]]);
  h.engine.stop();
});
test("revised speech, workspace changes, and stop fence in-flight model decisions", async () => {
  for (const change of ["revise", "workspace", "stop"]) {
    let release;
    let first = true;
    const h = harness(async (input) => {
      if (first) {
        first = false;
        await new Promise((r) => {
          release = r;
        });
        return answers(input);
      }
      return answers(input, "ignore");
    });
    h.engine.update({ id: 0, text: "open music", final: true });
    await settle();
    if (change === "revise")
      h.engine.update({ id: 0, text: "don't open music", final: true });
    if (change === "workspace") h.switch();
    if (change === "stop") h.engine.stop();
    release();
    await settle();
    assert.equal(h.calls.length, 0, change);
    h.engine.stop();
  }
});
test("live speech produces partial PCM while talking and automatic finals at a pause, with bounded windows", () => {
  const buffer = new LiveSpeechBuffer();
  const voice = new Float32Array(1600).fill(0.05),
    silence = new Float32Array(1600);
  for (let i = 0; i < 50; i++) assert.equal(buffer.push(silence), null);
  const slices = [];
  for (let i = 0; i < 20; i++) {
    const slice = buffer.push(voice);
    if (slice) slices.push(slice);
  }
  assert.ok(slices.some((s) => !s.final));
  for (let i = 0; i < 5; i++) {
    const slice = buffer.push(silence);
    if (slice) slices.push(slice);
  }
  assert.equal(slices.at(-1).final, true);
  for (let i = 0; i < 400; i++) {
    const slice = buffer.push(voice);
    if (slice) {
      assert.ok(slice.pcm.length <= 16000 * 12.3);
      slices.push(slice);
    }
  }
  assert.ok(slices.at(-1).id >= 3);
  const decoded = Buffer.from(
    encodeSpeech(new Float32Array([0.5, -0.5])),
    "base64",
  );
  assert.equal(decoded.readFloatLE(0), 0.5);
  assert.equal(decoded.readFloatLE(4), -0.5);
});
test("live prompts remain bounded and context marks clarification replies", () => {
  const input = liveIntentInput(
    "word ".repeat(200),
    { token: "a", description: "Home", clarifying: true },
    [],
  );
  assert.ok(Object.keys(input.questions.command.criteria).length <= 101);
  assert.match(input.context, /which recipient/);
  assert.ok(JSON.stringify(input).length < 160000);
});

test("a thought paused mid-request is completed by the next speech segment", async () => {
  const h = harness(async (input) =>
    answers(
      input,
      input.request.endsWith("with") ? "wait" : "act",
      input.request,
    ),
  );
  h.engine.update({ id: 0, text: "start a dm with", final: true });
  await settle();
  assert.equal(h.calls.length, 0);
  h.engine.update({ id: 1, text: "Matt and Jared", final: true });
  await settle();
  assert.deepEqual(h.calls, [["start a dm with Matt and Jared"]]);
  h.engine.stop();
});
