import assert from "node:assert/strict";
import test from "node:test";

const timers = new Map();
let nextTimer = 0;
let invoke;
globalThis.window = {
  setTimeout: (fn, ms) => {
    timers.set(++nextTimer, { fn, ms });
    return nextTimer;
  },
  clearTimeout: (id) => timers.delete(id),
  setInterval: (fn, ms) => window.setTimeout(fn, ms),
  clearInterval: (id) => timers.delete(id),
  __TAURI_INTERNALS__: {
    transformCallback: () => ++nextTimer,
    unregisterCallback: () => {},
    invoke: (...args) => invoke(...args),
  },
};
const { RelayClient } = await import("./relayClientSession.ts");
const { resetRateLimitGate } = await import("./relayRateLimitGate.ts");

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
  for (let i = 0; i < 100; i++) await Promise.resolve();
}

function row(id) {
  return {
    id: id.repeat(64),
    pubkey: "a".repeat(64),
    kind: 9,
    created_at: Math.floor(Date.now() / 1000),
    tags: [["h", "background"]],
    content: id,
    sig: "b".repeat(128),
  };
}

function fixture(t) {
  timers.clear();
  resetRateLimitGate();
  const client = new RelayClient();
  const sockets = [];
  const frames = [];
  const repairs = [];
  let authHeld = false;
  let failReplay = null;
  let failNextOperation = false;
  invoke = async (command, args) => {
    if (command === "get_relay_ws_url") return "wss://fixture.invalid";
    if (command === "sign_event") return JSON.stringify(row("3"));
    if (command === "create_auth_event") return JSON.stringify({ id: "auth" });
    if (command === "plugin:websocket|connect") {
      sockets.push(args.onMessage);
      args.onMessage.onmessage({ type: "Text", data: '["AUTH","challenge"]' });
      return sockets.length;
    }
    if (command === "plugin:websocket|disconnect") return;
    if (command === "plugin:websocket|send") {
      const frame = JSON.parse(args.message.data);
      frames.push({ socket: args.id, frame });
      if (failNextOperation && (frame[0] === "REQ" || frame[0] === "EVENT")) {
        failNextOperation = false;
        authHeld = true;
        throw new Error("fixture initial send failed");
      }
      if (frame[0] === "EVENT") deliver(args.id, ["OK", frame[1].id, true, ""]);
      if (frame[0] === "AUTH" && !authHeld)
        deliver(args.id, ["OK", "auth", true, ""]);
      if (frame[0] === "REQ") {
        if (failReplay && frame[2]["#h"]?.[0] === "background")
          return failReplay.promise;
        deliver(args.id, ["EOSE", frame[1]]);
      }
      return;
    }
    if (command === "get_channel_reconnect_repair") {
      const gate = deferred();
      repairs.push({ args, ...gate });
      return gate.promise;
    }
    assert.fail(`Unexpected native call: ${command}`);
  };
  function deliver(socket, frame) {
    sockets[socket - 1].onmessage({
      type: "Text",
      data: JSON.stringify(frame),
    });
  }
  t.after(async () => {
    for (const repair of repairs) repair.resolve([]);
    failReplay?.resolve();
    await flush();
    client.disconnect();
    resetRateLimitGate();
  });
  return {
    client,
    sockets,
    frames,
    repairs,
    deliver,
    failNextOperation: () => {
      failNextOperation = true;
    },
    holdAuth: () => {
      authHeld = true;
    },
    failReplay: (gate) => {
      failReplay = gate;
    },
  };
}

async function seedAndDisconnect(f) {
  const delivered = [];
  await f.client.subscribeToChannelLive("background", (event) =>
    delivered.push(event.id),
  );
  const sub = f.frames.find(({ frame }) => frame[0] === "REQ").frame[1];
  f.deliver(1, ["EVENT", sub, row("1")]);
  f.deliver(1, ["EOSE", sub]);
  await flush();
  assert.deepEqual(delivered, [row("1").id]);
  f.sockets[0].onmessage({
    type: "Close",
    data: { code: 1006, reason: "fixture drop" },
  });
  await flush();
  return delivered;
}

for (const beforeAuth of [false, true]) {
  test(`foreground subscription does not wait for background repair (${beforeAuth ? "queued before auth" : "after auth"})`, async (t) => {
    const f = fixture(t);
    const delivered = await seedAndDisconnect(f);
    let completed = 0;
    f.client.subscribeToReconnects(() => completed++);
    if (beforeAuth) f.holdAuth();
    const reconnect = f.client.resumeReconnect();
    await flush();
    let ready = false;
    const foreground = f.client
      .subscribeToChannelLive("foreground", () => {})
      .then((dispose) => {
        ready = true;
        return dispose;
      });
    await flush();
    if (beforeAuth) {
      assert.equal(ready, false, "authentication remains mandatory");
      assert.equal(
        f.frames.some(
          ({ socket, frame }) => socket === 2 && frame[0] === "REQ",
        ),
        false,
      );
      f.deliver(2, ["OK", "auth", true, ""]);
      await flush();
    }
    assert.equal(f.repairs.length, 1, "real native repair must be in flight");
    assert.equal(completed, 0, "reconnect completion still waits for repair");
    try {
      assert.equal(
        ready,
        true,
        "authenticated foreground REQ must not wait for unrelated HTTP repair",
      );
    } finally {
      f.repairs[0].resolve([row("2")]);
      await reconnect;
      const dispose = await foreground;
      await flush();
      await dispose();
    }
    assert.deepEqual(
      delivered,
      [row("1").id, row("2").id],
      "missed history still arrives",
    );
    assert.equal(completed, 1);
  });
}

test("late repair completion cannot notify or deliver into a replacement community", async (t) => {
  const f = fixture(t);
  const delivered = await seedAndDisconnect(f);
  await f.client.resumeReconnect();
  await flush();
  assert.equal(f.repairs.length, 1);
  f.client.disconnect();
  await f.client.preconnect();
  await flush();
  let notified = 0;
  f.client.subscribeToReconnects(() => notified++);
  const socket = f.client.wsId;
  f.repairs[0].resolve([row("2")]);
  await flush();
  assert.equal(f.client.wsId, socket);
  assert.equal(f.client.getConnectionState(), "connected");
  assert.equal(notified, 0);
  assert.deepEqual(delivered, [row("1").id]);
});

test("current replay transport failure resets the socket and schedules recovery", async (t) => {
  const f = fixture(t);
  await seedAndDisconnect(f);
  const send = deferred();
  f.failReplay(send);
  await f.client.resumeReconnect();
  await flush();
  assert.equal(f.client.getConnectionState(), "connected");
  send.reject(new Error("fixture send failed"));
  await flush();
  assert.equal(f.client.wsId, null);
  assert.equal(f.client.getConnectionState(), "reconnecting");
  assert.notEqual(f.client.reconnectTimeout, null);
});

test("stale replay transport failure cannot reset a replacement socket", async (t) => {
  const f = fixture(t);
  await seedAndDisconnect(f);
  const send = deferred();
  f.failReplay(send);
  await f.client.resumeReconnect();
  await flush();
  f.client.disconnect();
  f.failReplay(null);
  await f.client.preconnect();
  await flush();
  const socket = f.client.wsId;
  send.reject(new Error("late fixture send failure"));
  await flush();
  assert.equal(f.client.wsId, socket);
  assert.equal(f.client.getConnectionState(), "connected");
  assert.equal(f.client.reconnectTimeout, null);
});

test("rejected authentication never releases a waiting foreground request", async (t) => {
  const f = fixture(t);
  f.holdAuth();
  const connecting = f.client.preconnect();
  const rejected = assert.rejects(connecting, /restricted/);
  await flush();
  const foreground = f.client.subscribeToChannelLive("foreground", () => {});
  const foregroundRejected = assert.rejects(foreground, /restricted/);
  f.deliver(1, ["OK", "auth", false, "restricted: fixture denial"]);
  await Promise.all([rejected, foregroundRejected]);
  assert.equal(
    f.frames.some(({ frame }) => frame[0] === "REQ"),
    false,
  );
  assert.equal(f.client.wsId, null);
  assert.equal(f.client.getConnectionState(), "disconnected");
});

function expireCooldown() {
  const entry = [...timers.entries()].find(([, timer]) => timer.ms === 10_000);
  assert.ok(entry, "expected WS admission timer");
  timers.delete(entry[0]);
  entry[1].fn();
}

for (const switchCommunity of [false, true]) {
  test(`foreground admission preserves WS cooldown (switch=${switchCommunity})`, async (t) => {
    const f = fixture(t);
    await seedAndDisconnect(f);
    await f.client.resumeReconnect();
    f.deliver(2, ["NOTICE", "rate-limited: retry in 10s"]);
    await flush();
    const foreground = f.client.subscribeToChannelLive("foreground", () => {});
    const outcome = foreground.then(
      () => "ready",
      () => "superseded",
    );
    await flush();
    assert.equal(
      f.frames.some(
        ({ frame }) =>
          frame[0] === "REQ" && frame[2]["#h"]?.[0] === "foreground",
      ),
      false,
    );
    if (switchCommunity) {
      f.client.disconnect();
      resetRateLimitGate();
      await f.client.preconnect();
      assert.equal(await outcome, "superseded");
      assert.equal(f.client.subscriptions.size, 0);
      assert.equal(f.client.getConnectionState(), "connected");
    } else {
      expireCooldown();
      await flush();
      assert.equal(await outcome, "ready");
      assert.equal(f.repairs.length, 1, "HTTP repair stays held");
    }
  });
}

for (const operation of ["subscribe", "publish"]) {
  for (const switchCommunity of [false, true]) {
    test(`${operation} retry respects cooldown armed during reconnect (switch=${switchCommunity})`, async (t) => {
      const f = fixture(t);
      await f.client.preconnect();
      f.failNextOperation();
      const pending =
        operation === "subscribe"
          ? f.client.subscribeToChannelLive("foreground", () => {})
          : f.client.publishEvent(row("3"), "timeout", "send failed");
      const outcome = pending.then(
        () => "ready",
        () => "superseded",
      );
      await flush();
      const reconnect = f.client.resumeReconnect();
      await flush();
      f.deliver(2, ["NOTICE", "rate-limited: retry in 10s"]);
      f.deliver(2, ["OK", "auth", true, ""]);
      await reconnect;
      await flush();
      assert.equal(
        f.frames.some(
          ({ socket, frame }) =>
            socket === 2 && ["REQ", "EVENT"].includes(frame[0]),
        ),
        false,
      );
      if (switchCommunity) {
        f.client.disconnect();
        resetRateLimitGate();
        const replacement = f.client.preconnect();
        await flush();
        f.deliver(3, ["OK", "auth", true, ""]);
        await replacement;
        assert.equal(await outcome, "superseded");
        assert.equal(
          f.frames.some(
            ({ socket, frame }) =>
              socket === 3 && ["REQ", "EVENT"].includes(frame[0]),
          ),
          false,
        );
        assert.equal(f.client.getConnectionState(), "connected");
      } else {
        expireCooldown();
        await flush();
        assert.equal(await outcome, "ready");
      }
    });
  }
}

test("queued old repair workers cannot re-pin floors after same-community successor completes", async (t) => {
  const f = fixture(t);
  for (let i = 0; i < 6; i++) {
    await f.client.subscribeToChannelLive(`background-${i}`, () => {});
    const sub = f.frames.at(-1).frame[1];
    f.deliver(1, [
      "EVENT",
      sub,
      { ...row("1"), tags: [["h", `background-${i}`]] },
    ]);
    f.deliver(1, ["EOSE", sub]);
  }
  await flush();
  const close = (socket) =>
    f.sockets[socket - 1].onmessage({
      type: "Close",
      data: { code: 1006, reason: "drop" },
    });
  close(1);
  await flush();
  await f.client.resumeReconnect();
  await flush();
  assert.equal(f.repairs.length, 4);
  close(2);
  await flush();
  await f.client.resumeReconnect();
  await flush();
  assert.equal(f.repairs.length, 8);
  for (const repair of f.repairs.slice(4)) repair.resolve([]);
  await flush();
  assert.equal(f.repairs.length, 10);
  for (const repair of f.repairs.slice(8)) repair.resolve([]);
  await flush();
  assert.ok(
    [...f.client.subscriptions.values()].every(
      (sub) => sub.pendingReplaySince === undefined,
    ),
  );
  for (const repair of f.repairs.slice(0, 4)) repair.resolve([row("2")]);
  await flush();
  assert.ok(
    [...f.client.subscriptions.values()].every(
      (sub) => sub.pendingReplaySince === undefined,
    ),
    "stale queued workers must not mutate completed successor repair",
  );
  assert.equal(f.repairs.length, 10, "old queued repair stays inert");
});

test("finite read and accepted send proceed while unrelated recovery is held", async (t) => {
  const f = fixture(t);
  await seedAndDisconnect(f);
  f.holdAuth();
  const reconnect = f.client.resumeReconnect();
  await flush();
  let readDone = false;
  let sendDone = false;
  const read = f.client.fetchEvents({ kinds: [1] }).then(() => {
    readDone = true;
  });
  const send = f.client.sendMessage("foreground", "hello").then(() => {
    sendDone = true;
  });
  await flush();
  assert.equal(readDone || sendDone, false);
  f.deliver(2, ["OK", "auth", true, ""]);
  await flush();
  assert.equal(f.repairs.length, 1);
  try {
    assert.equal(readDone, true, "EOSE completes finite read before repair");
    assert.equal(sendDone, true, "OK acknowledges send before repair");
  } finally {
    f.repairs[0].resolve([]);
    await Promise.all([reconnect, read, send]);
  }
});
