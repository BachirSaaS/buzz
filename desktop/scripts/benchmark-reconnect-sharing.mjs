import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { setTimeout as sleep } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
// Run from desktop after extracting the exact pre-change TS source to a file:
// node --import ./test-loader.mjs scripts/benchmark-reconnect-sharing.mjs /path/to/baseline.ts
// Synthetic transport only: timings are callback completion, not native/UI paint.
const baselinePath = process.argv[2];
if (!baselinePath)
  throw new Error("Provide a pristine relayReconnectReplay.ts baseline path");
const { replayLiveSubscriptions: baseline } = await import(
  pathToFileURL(resolve(baselinePath)).href
);
import { replayLiveSubscriptions as candidate } from "../src/shared/api/relayReconnectReplay.ts";
import { CHANNEL_EVENT_KINDS } from "../src/shared/constants/kinds.ts";
import { resetRateLimitGate } from "../src/shared/api/relayRateLimitGate.ts";

globalThis.window = globalThis;
const latency = 20;
const id = (channel, n) =>
  `${channel.toString(16).padStart(8, "0")}${n.toString(16).padStart(56, "0")}`;
const event = (channel, n) => ({
  id: id(channel, n),
  pubkey: "a".repeat(64),
  kind: 9,
  created_at: 2000 + Math.floor(n / 3),
  tags: [["h", `channel-${channel}`]],
  content: `row ${n}`,
  sig: "b".repeat(128),
});
async function run(replay, channels, overlap, slots) {
  resetRateLimitGate();
  const rows = Array.from({ length: channels }, (_, c) =>
    Array.from({ length: 520 }, (_, n) => event(c, n)).sort(
      (a, b) => b.created_at - a.created_at || a.id.localeCompare(b.id),
    ),
  );
  const subscriptions = new Map();
  const delivered = new Map();
  let foregroundCompleteMs = null,
    readCount = 0,
    active = 0,
    peak = 0,
    sent = 0;
  const waiting = [];
  const start = performance.now();
  function add(key, c) {
    const received = new Set();
    delivered.set(key, received);
    subscriptions.set(key, {
      mode: "live",
      filter: {
        kinds: [...CHANNEL_EVENT_KINDS],
        "#h": [`channel-${c}`],
        since: 1000,
        limit: 1000,
      },
      lastSeenCreatedAt: 2200,
      onEvent(e) {
        assert(!received.has(e.id));
        received.add(e.id);
        if (key === "visible" && received.size === 520)
          foregroundCompleteMs = performance.now() - start;
      },
    });
  }
  add("visible", 0);
  for (let c = overlap ? 0 : 1; c < channels; c++) add(`background-${c}`, c);
  await replay({
    subscriptions,
    visibleChannelId: "channel-0",
    generation: 1,
    sendRaw: async () => {
      sent++;
    },
    requestRepair: async ({ channelId, since, until, beforeId, limit }) => {
      readCount++;
      if (active >= slots) await new Promise((r) => waiting.push(r));
      active++;
      peak = Math.max(peak, active);
      try {
        await sleep(latency);
        const c = Number(channelId.split("-")[1]);
        return rows[c]
          .filter(
            (e) =>
              e.created_at >= since &&
              (until === undefined ||
                e.created_at < until ||
                (e.created_at === until && (!beforeId || e.id > beforeId))),
          )
          .slice(0, limit);
      } finally {
        active--;
        waiting.shift()?.();
      }
    },
  });
  const total = performance.now() - start;
  for (const [key, sub] of subscriptions) {
    const channel = Number(sub.filter["#h"][0].split("-")[1]);
    assert.deepEqual(
      [...delivered.get(key)],
      rows[channel].map((row) => row.id),
      "each subscriber must receive every expected row in relay order",
    );
    assert.equal(sub.pendingReplaySince, undefined);
    assert.equal(sub.reconnectReplay.repairDone, true);
  }
  return {
    foregroundCompleteMs,
    totalMs: total,
    reads: readCount,
    delivered: [...delivered.values()].reduce((sum, v) => sum + v.size, 0),
    reqs: sent,
    peak,
  };
}
const results = [];
for (const [channels, overlap, slots] of [
  [1, true, 2],
  [12, true, 2],
  [32, true, 2],
  [12, false, 2],
  [12, true, 4],
]) {
  const samples = { before: [], after: [] };
  for (let pair = 0; pair < 5; pair++) {
    for (const arm of pair % 2 ? ["after", "before"] : ["before", "after"]) {
      samples[arm].push(
        await run(
          arm === "before" ? baseline : candidate,
          channels,
          overlap,
          slots,
        ),
      );
    }
  }
  results.push({
    channels,
    overlap,
    upstreamSlots: slots,
    modeledReadMs: latency,
    samples,
  });
}
console.log(JSON.stringify(results, null, 2));
