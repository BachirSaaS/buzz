import assert from "node:assert/strict";
import test from "node:test";
import { CHANNEL_EVENT_KINDS } from "../constants/kinds.ts";

const timers = new Map();
let timerId = 0;
let invoke;
globalThis.window = {
  setTimeout: (fn) => {
    timers.set(++timerId, fn);
    return timerId;
  },
  clearTimeout: (id) => timers.delete(id),
  __TAURI_INTERNALS__: { invoke: (...args) => invoke(...args) },
};
const { RelayClient } = await import("./relayClientSession.ts");

async function flush() {
  for (let i = 0; i < 80; i++) await Promise.resolve();
}

function event(id, createdAt) {
  return Object.freeze({
    id: String(id).padStart(64, "0"),
    pubkey: "a".repeat(64),
    kind: 9,
    created_at: createdAt,
    tags: Object.freeze([Object.freeze(["h", "channel-1"])]),
    content: "",
    sig: "b".repeat(128),
  });
}

function fixture() {
  timers.clear();
  const client = new RelayClient();
  client.wsId = 7;
  const reads = [];
  const frames = [];
  const deliver = (frame) =>
    client.handleWsMessage(
      { type: "Text", data: JSON.stringify(frame) },
      client.connectionGeneration,
    );
  invoke = async (command, args) => {
    if (command === "plugin:websocket|send") {
      const frame = JSON.parse(args.message.data);
      frames.push(frame);
      if (frame[0] === "REQ") await deliver(["EOSE", frame[1]]);
      return;
    }
    if (command === "get_channel_reconnect_repair") {
      return new Promise((resolve, reject) =>
        reads.push({ args, resolve, reject }),
      );
    }
    assert.fail(`unexpected native command: ${command}`);
  };
  return { client, reads, frames, deliver };
}

for (const [name, backgroundStart, foregroundStart, cursor, expectedReads] of [
  ["same startup second", 2_000, 2_000, 2_100, 1],
  ["different subscription start floors", 2_000, 2_100, 2_200, 2],
  ["older subscriptions with converged replay floors", 2_000, 2_100, 5_000, 1],
]) {
  test(`real RelayClient native repair: ${name}`, async (t) => {
    const f = fixture();
    let now = backgroundStart;
    t.mock.method(Date, "now", () => now * 1_000);
    const background = [];
    const foreground = [];
    // The background filter is exactly the one in useLiveChannelUpdates.
    const disposeBackground = await f.client.subscribeLive(
      {
        kinds: [...CHANNEL_EVENT_KINDS],
        "#h": ["channel-1"],
        since: Math.floor(Date.now() / 1_000),
        limit: 1_000,
      },
      (row) => background.push(row.id),
    );
    now = foregroundStart;
    const disposeForeground = await f.client.subscribeToChannelLive(
      "channel-1",
      (row) => foreground.push(row.id),
    );
    const subIds = f.frames
      .filter((frame) => frame[0] === "REQ")
      .map((frame) => frame[1]);
    // Seed the cursor through the real inbound EVENT and EOSE dispatch.
    for (const subId of subIds) {
      await f.deliver(["EVENT", subId, event(1, cursor)]);
      await f.deliver(["EOSE", subId]);
    }
    background.length = 0;
    foreground.length = 0;
    f.frames.length = 0;
    f.client.setVisibleChannelId("channel-1");
    const running = f.client.replayLiveSubscriptions();
    await flush();
    assert.equal(f.frames.filter((frame) => frame[0] === "REQ").length, 2);
    assert.equal(f.reads.length, expectedReads);
    for (const read of f.reads) {
      assert.deepEqual(read.args, {
        channelId: "channel-1",
        since: Math.max(
          cursor - 1_865,
          read === f.reads[0] ? backgroundStart : foregroundStart,
        ),
        limit: 500,
        until: null,
        beforeId: null,
      });
      read.resolve(Object.freeze([event(2, cursor + 1)]));
    }
    await running;
    assert.deepEqual(background, [event(2, 0).id]);
    assert.deepEqual(foreground, background);
    assert.equal(f.client.wsId, 7, "repair must preserve the healthy socket");
    for (const sub of f.client.subscriptions.values()) {
      assert.equal(sub.pendingReplaySince, undefined);
      assert.equal(
        sub.reconnectReplay,
        undefined,
        "EOSE plus repair retires dedupe",
      );
    }
    await disposeForeground();
    await disposeBackground();
    assert.equal(f.client.subscriptions.size, 0);
  });
}
