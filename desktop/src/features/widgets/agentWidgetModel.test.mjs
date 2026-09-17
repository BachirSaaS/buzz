import assert from "node:assert/strict";
import test from "node:test";
import { buildTranscript } from "../agents/ui/agentSessionTranscript.ts";
import { buildAgentWidgetModel } from "./agentWidgetModel.ts";

const update = (seq, data, identity = {}) => ({
  seq,
  timestamp: `2026-09-17T12:00:${String(seq).padStart(2, "0")}Z`,
  kind: "acp_read",
  agentIndex: 0,
  channelId: "design",
  sessionId: "session-1",
  turnId: "turn-1",
  ...identity,
  payload: { method: "session/update", params: { update: data } },
});
const model = (events, extra = {}) =>
  buildAgentWidgetModel({
    name: "Agent",
    channel: "#design",
    items: buildTranscript(events),
    working: true,
    connected: true,
    ...extra,
  });
const tool = {
  sessionUpdate: "tool_call",
  toolCallId: "tool-1",
  title: "shell",
  toolName: "shell",
  status: "in_progress",
  rawInput: { command: "pnpm test" },
};

test("reported usage replaces snapshots, unknown usage stays unknown, and tools retain their details", () => {
  const result = model([
    update(1, tool),
    update(2, { sessionUpdate: "usage_update", used: 100, size: 8192 }),
    update(3, { sessionUpdate: "usage_update", used: 600, size: 8192 }),
  ]);
  assert.equal(result.tokens, 600);
  assert.equal(result.capacity, 8192);
  assert.equal(result.toolCount, 1);
  assert.equal(result.status, "Using tools");
  assert.match(result.tools[0].detail, /pnpm test/);
  assert.equal(model([update(1, tool)]).tokens, null);
});
test("a new turn or session cannot inherit tools and usage from the old turn", () => {
  const old = [
    update(1, tool),
    update(2, { sessionUpdate: "usage_update", used: 600, size: 8192 }),
  ];
  for (const identity of [{ turnId: "turn-2" }, { sessionId: "session-2" }]) {
    const result = model([
      ...old,
      update(
        3,
        {
          sessionUpdate: "agent_thought_chunk",
          content: { type: "text", text: "Considering the request" },
        },
        identity,
      ),
    ]);
    assert.equal(result.tokens, null);
    assert.equal(result.toolCount, 0);
    assert.equal(result.status, "Thinking");
  }
});
test("tool failures and disconnected observers remain visible rather than claiming active work", () => {
  const events = [
    update(1, {
      ...tool,
      status: "failed",
      content: { type: "text", text: "Build failed" },
    }),
  ];
  assert.equal(model(events).status, "Needs attention");
  const disconnected = model(events, { connected: false });
  assert.equal(disconnected.status, "Reconnecting");
  assert.equal(disconnected.active, false);
  assert.equal(disconnected.tools[0].state, "failed");
});
