import assert from "node:assert/strict";
import test from "node:test";
import {
  PAGE_REPLAY_MAX_ATTEMPTS,
  RECONNECT_REPLAY_PAGE_LIMIT,
  replayLiveSubscriptions,
} from "./relayReconnectReplay.ts";
import { buildChannelFilter } from "./relayChannelFilters.ts";
import { shouldDispatchSubscriptionEvent } from "./relayClosedRecovery.ts";

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

async function flush() {
  // Drain continuations without clock-based assertions or transport sleeps.
  for (let i = 0; i < 60; i++) await Promise.resolve();
}

function event(id) {
  return Object.freeze({
    id: String(id).padStart(64, "0"),
    pubkey: "a".repeat(64),
    created_at: 3_000,
    kind: 9,
    tags: Object.freeze([]),
    content: "",
    sig: "b".repeat(128),
  });
}

function subscriber(channelId = "channel-1", since = 2_000) {
  const received = [];
  return {
    mode: "live",
    filter: { ...buildChannelFilter(channelId, 1_000), since },
    lastSeenCreatedAt: 3_100,
    onEvent: (row) => received.push(row.id),
    received,
  };
}

function fixture(entries = [subscriber(), subscriber()], options = {}) {
  const subscriptions = new Map(entries.map((sub, i) => [String(i), sub]));
  const reads = [];
  const frames = [];
  const requestRepair = (request) => {
    const pending = deferred();
    reads.push({ request, ...pending });
    return pending.promise;
  };
  const replay = (overrides = {}) =>
    replayLiveSubscriptions({
      subscriptions,
      sendRaw: async (frame) => {
        frames.push(frame);
      },
      requestRepair,
      generation: 1,
      ...options,
      ...overrides,
    });
  return { entries, subscriptions, reads, frames, replay };
}

test("overlapping repairs share each composite-cursor page, not subscriber delivery", async () => {
  const f = fixture();
  const running = f.replay();
  await flush();
  assert.equal(f.frames.length, 2, "both live REQs must precede repair");
  assert.equal(
    f.reads.length,
    1,
    "one outstanding native read for equal pages",
  );
  // A live frame has already reached only one subscriber. Shared history must
  // dedupe for it, but still deliver that row to the other subscriber.
  const first = Object.freeze(
    Array.from({ length: RECONNECT_REPLAY_PAGE_LIMIT }, (_, i) => event(i + 1)),
  );
  const live = first[0];
  assert.equal(shouldDispatchSubscriptionEvent(f.entries[0], live), true);
  f.entries[0].onEvent(live);
  f.reads[0].resolve(first);
  await flush();
  assert.equal(f.reads.length, 2);
  assert.deepEqual(f.reads[1].request, {
    channelId: "channel-1",
    since: 2_000,
    limit: 500,
    until: 3_000,
    beforeId: first.at(-1).id,
  });
  const last = event(501);
  f.reads[1].resolve(Object.freeze([last]));
  await running;
  const expected = [...first, last].map((row) => row.id);
  for (const sub of f.entries) {
    assert.deepEqual(sub.received, expected);
    assert.equal(sub.pendingReplaySince, undefined);
    assert.equal(sub.reconnectReplay.repairDone, true);
  }
});

for (const [label, second] of [
  ["channel", () => subscriber("channel-2")],
  ["history floor", () => subscriber("channel-1", 2_100)],
]) {
  test(`different ${label} requests never share`, async () => {
    const f = fixture([subscriber(), second()]);
    const running = f.replay();
    await flush();
    assert.equal(f.reads.length, 2);
    f.reads[0].resolve([event(1)]);
    f.reads[1].resolve([event(2)]);
    await running;
    assert.deepEqual(f.entries[0].received, [event(1).id]);
    assert.deepEqual(f.entries[1].received, [event(2).id]);
  });
}

test("completed pages are not cached for a later subscriber", async () => {
  const f = fixture(undefined, { pageReplayConcurrency: 1 });
  const running = f.replay();
  await flush();
  f.reads[0].resolve([event(1)]);
  await flush();
  assert.equal(f.reads.length, 2);
  assert.deepEqual(f.reads[1].request, f.reads[0].request);
  f.reads[1].resolve([event(2)]);
  await running;
  assert.deepEqual(f.entries[0].received, [event(1).id]);
  assert.deepEqual(f.entries[1].received, [event(2).id]);
});

test("a rejected shared page is evicted and both subscribers can retry", async (t) => {
  t.mock.method(console, "warn", () => {});
  const f = fixture();
  const running = f.replay();
  await flush();
  assert.equal(f.reads.length, 1);
  f.reads[0].reject(new Error("temporary native read failure"));
  await flush();
  assert.equal(f.reads.length, 2, "retry must not reuse a rejected promise");
  assert.deepEqual(f.reads[0].request, f.reads[1].request);
  f.reads[1].resolve([event(1)]);
  await running;
  for (const sub of f.entries) {
    assert.deepEqual(sub.received, [event(1).id]);
    assert.equal(sub.pendingReplaySince, undefined);
  }
});

test("exhausted shared reads preserve each floor without rejecting the replay", async (t) => {
  t.mock.method(console, "warn", () => {});
  const f = fixture();
  const running = f.replay();
  for (let attempt = 0; attempt < PAGE_REPLAY_MAX_ATTEMPTS; attempt++) {
    await flush();
    assert.equal(f.reads.length, attempt + 1);
    f.reads[attempt].reject(new Error("unavailable"));
  }
  await running;
  for (const sub of f.entries) {
    assert.deepEqual(sub.received, []);
    assert.equal(sub.pendingReplaySince, 2_000);
  }
  const retry = f.replay({ generation: 2 });
  await flush();
  assert.equal(f.reads.length, PAGE_REPLAY_MAX_ATTEMPTS + 1);
  f.reads.at(-1).resolve([event(1)]);
  await retry;
  for (const sub of f.entries) assert.equal(sub.pendingReplaySince, undefined);
});

test("synchronous request failures retain the existing bounded retry contract", async (t) => {
  t.mock.method(console, "warn", () => {});
  const f = fixture();
  let attempts = 0;
  await f.replay({
    requestRepair: () => {
      attempts++;
      throw new Error("synchronous boundary failure");
    },
  });
  assert.equal(attempts, 2 * PAGE_REPLAY_MAX_ATTEMPTS);
  for (const sub of f.entries) assert.equal(sub.pendingReplaySince, 2_000);
});

for (const action of ["dispose", "replace"]) {
  test(`${action} during a shared read leaves the other subscriber intact`, async () => {
    const f = fixture();
    const running = f.replay();
    await flush();
    assert.equal(f.reads.length, 1);
    const replacement = subscriber();
    if (action === "dispose") f.subscriptions.delete("0");
    else f.subscriptions.set("0", replacement);
    f.reads[0].resolve([event(1)]);
    await running;
    assert.deepEqual(f.entries[0].received, []);
    assert.deepEqual(replacement.received, []);
    assert.deepEqual(f.entries[1].received, [event(1).id]);
    assert.equal(f.entries[1].pendingReplaySince, undefined);
  });
}

test("superseding reconnect does not share stale reads or release its retry floor", async () => {
  let generation = 1;
  const f = fixture();
  const stale = f.replay({ isActive: () => generation === 1 });
  await flush();
  assert.equal(f.reads.length, 1);
  generation = 2;
  const current = f.replay({ generation, isActive: () => generation === 2 });
  await flush();
  assert.equal(f.reads.length, 2, "new connection needs a new native read");
  f.reads[0].resolve([event(1)]);
  await stale;
  for (const sub of f.entries) {
    assert.deepEqual(sub.received, []);
    assert.equal(sub.pendingReplaySince, 2_000);
    assert.equal(sub.reconnectReplay.generation, 2);
    assert.equal(sub.reconnectReplay.repairDone, false);
  }
  f.reads[1].resolve([event(2)]);
  await current;
  for (const sub of f.entries) {
    assert.deepEqual(sub.received, [event(2).id]);
    assert.equal(sub.pendingReplaySince, undefined);
  }
});

test("concurrent replay owners never share pages across sessions", async () => {
  const left = fixture();
  const right = fixture();
  const leftRun = left.replay();
  const rightRun = right.replay();
  await flush();
  assert.equal(left.reads.length, 1);
  assert.equal(right.reads.length, 1);
  left.reads[0].resolve([event(1)]);
  right.reads[0].resolve([event(2)]);
  await Promise.all([leftRun, rightRun]);
  for (const sub of left.entries) assert.deepEqual(sub.received, [event(1).id]);
  for (const sub of right.entries)
    assert.deepEqual(sub.received, [event(2).id]);
});

for (const boundary of ["timestamp", "event id"]) {
  test(`in-flight pages with a different ${boundary} cursor cannot share`, async () => {
    // The third worker starts after the first reader has paged: its page one
    // may see a newer snapshot, so equal floors do not imply equal cursors.
    const f = fixture([subscriber(), subscriber("blocker"), subscriber()], {
      pageReplayConcurrency: 2,
    });
    const running = f.replay();
    await flush();
    const page = Array.from({ length: 500 }, (_, i) => event(i + 1));
    f.reads[0].resolve(page);
    await flush();
    assert.equal(f.reads.length, 3);
    f.reads[1].resolve([]);
    await flush();
    assert.equal(
      f.reads.length,
      4,
      "initial and cursor pages must be separate",
    );
    const alternate = [...page];
    alternate[499] =
      boundary === "timestamp"
        ? { ...page[499], created_at: 2_999 }
        : event(501);
    f.reads[3].resolve(alternate);
    await flush();
    assert.equal(
      f.reads.length,
      5,
      "different composite cursors must not share",
    );
    assert.equal(f.reads[2].request.since, f.reads[4].request.since);
    if (boundary === "timestamp") {
      assert.equal(f.reads[2].request.beforeId, f.reads[4].request.beforeId);
      assert.notEqual(f.reads[2].request.until, f.reads[4].request.until);
    } else {
      assert.equal(f.reads[2].request.until, f.reads[4].request.until);
      assert.notEqual(f.reads[2].request.beforeId, f.reads[4].request.beforeId);
    }
    f.reads[2].resolve([event(600)]);
    f.reads[4].resolve([event(700)]);
    await running;
    assert.equal(f.entries[0].received.at(-1), event(600).id);
    assert.equal(f.entries[2].received.at(-1), event(700).id);
  });
}

test("one subscriber callback failure does not poison another's shared page", async (t) => {
  t.mock.method(console, "warn", () => {});
  const broken = subscriber();
  broken.onEvent = () => {
    throw new Error("consumer failure");
  };
  const f = fixture([broken, subscriber()]);
  const running = f.replay();
  await flush();
  f.reads[0].resolve([event(1)]);
  await flush();
  assert.equal(f.reads.length, 2, "failed consumer owns its own retry");
  assert.deepEqual(f.entries[1].received, [event(1).id]);
  assert.equal(f.entries[1].pendingReplaySince, undefined);
  f.reads[1].resolve([event(1)]);
  await running;
  assert.deepEqual(f.entries[1].received, [event(1).id]);
});
