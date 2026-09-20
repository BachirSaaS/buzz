import assert from "node:assert/strict";
import { after, afterEach, before, mock, test } from "node:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { JSDOM } from "jsdom";
import React from "react";
import {
  useThreadReplies,
  useThreadRepliesForRoots,
} from "./useThreadReplies.ts";
import { useChannelSubscription } from "./hooks.ts";
import { relayClient } from "../../shared/api/relayClient.ts";
import { threadRepliesKey } from "./lib/messageQueryKeys.ts";

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "http://localhost",
});
before(() => {
  Object.assign(globalThis, {
    document: dom.window.document,
    HTMLElement: dom.window.HTMLElement,
    IS_REACT_ACT_ENVIRONMENT: true,
    window: dom.window,
  });
});
afterEach(() => mock.restoreAll());
after(() => dom.window.close());
const channel = { id: "channel-a", channelType: "stream" };
const rootId = "a".repeat(64);
const oldReply = {
  id: "b".repeat(64),
  pubkey: "c".repeat(64),
  created_at: 100,
  kind: 9,
  tags: [
    ["h", channel.id],
    ["e", rootId, "", "root"],
  ],
  content: "old reply",
  sig: "",
};
const latestReply = {
  ...oldReply,
  id: "d".repeat(64),
  created_at: 201,
  content: "latest reply",
};
function deferred() {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

async function mount(fetchReplies, { multiRoot = false } = {}) {
  const { act, renderHook, waitFor } = await import("@testing-library/react");
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  const frames = [];
  const priorWsId = relayClient.wsId;
  relayClient.wsId = 7;
  window.__TAURI_INTERNALS__ = {
    invoke: async (command, args) => {
      if (command === "get_thread_replies") return fetchReplies(args);
      if (command === "plugin:websocket|send") {
        const frame = JSON.parse(args.message.data);
        frames.push(frame);
        if (frame[0] === "REQ") {
          await relayClient.handleWsMessage(
            { type: "Text", data: JSON.stringify(["EOSE", frame[1]]) },
            relayClient.connectionGeneration,
          );
        }
        return;
      }
      assert.fail(`Unexpected command: ${command}`);
    },
  };
  const hook = renderHook(
    ({ active, root }) => {
      const single = useThreadReplies(active, multiRoot ? null : root);
      const multiple = useThreadRepliesForRoots(
        active,
        multiRoot && root ? [root] : [],
      );
      useChannelSubscription(active);
      return multiRoot ? multiple : single;
    },
    {
      initialProps: { active: channel, root: rootId },
      wrapper: ({ children }) =>
        React.createElement(QueryClientProvider, { client }, children),
    },
  );
  return {
    hook,
    client,
    frames,
    act,
    waitFor,
    async dispose() {
      hook.unmount();
      client.clear();
      await act(async () => {
        await new Promise((r) => setImmediate(r));
      });
      relayClient.wsId = priorWsId;
    },
  };
}

for (const multiRoot of [false, true]) {
  test(`returning ${multiRoot ? "multi-root" : "single-root"} reader does not reuse an abandoned pre-subscription snapshot`, async () => {
    let now = 200;
    mock.method(Date, "now", () => now * 1000);
    const staleSnapshot = deferred();
    let reads = 0;
    const h = await mount(
      async () => {
        reads += 1;
        if (reads === 1) return staleSnapshot.promise;
        return { events: [oldReply, latestReply], next_cursor: null };
      },
      { multiRoot },
    );
    try {
      await h.waitFor(() => assert.equal(reads, 1));
      await h.waitFor(() =>
        assert.equal(h.frames.filter((f) => f[0] === "REQ").length, 1),
      );
      h.hook.rerender({
        active: { id: "channel-b", channelType: "stream" },
        root: null,
      });
      // A reply is committed while this channel has no foreground subscription.
      // The background unread listener does not populate the thread cache.
      now = 202;
      h.hook.rerender({ active: channel, root: rootId });
      await h.waitFor(() =>
        assert.equal(h.frames.filter((f) => f[0] === "REQ").length, 3),
      );
      const returningFilter = h.frames.filter((f) => f[0] === "REQ").at(-1)[2];
      assert.equal(returningFilter.since, 202);
      assert.ok(latestReply.created_at < returningFilter.since);
      // A returned reader must finish without waiting for the abandoned IPC.
      await h.waitFor(() =>
        assert.equal(reads, 2, "return must issue a fresh thread snapshot"),
      );
      await h.waitFor(() =>
        assert.equal(
          h.client.getQueryState(threadRepliesKey(channel.id, rootId)).status,
          "success",
        ),
      );
      await h.act(async () => {
        staleSnapshot.resolve({ events: [oldReply], next_cursor: null });
        await new Promise((r) => setImmediate(r));
      });
      assert.deepEqual(
        h.client
          .getQueryData(threadRepliesKey(channel.id, rootId))
          .map((e) => e.id),
        [oldReply.id, latestReply.id],
      );
    } finally {
      await h.act(async () => {
        staleSnapshot.resolve({ events: [oldReply], next_cursor: null });
        await new Promise((r) => setImmediate(r));
      });
      await h.dispose();
    }
  });
}

test("leaving a thread stops its remaining serial pages", async () => {
  const firstPage = deferred();
  let reads = 0;
  const h = await mount(async () => {
    reads += 1;
    if (reads === 1) return firstPage.promise;
    return {
      events: [latestReply],
      next_cursor:
        reads < 5
          ? { created_at: 201 + reads, event_id: latestReply.id }
          : null,
    };
  });
  try {
    await h.waitFor(() => assert.equal(reads, 1));
    h.hook.rerender({ active: null, root: null });
    await h.act(async () => {
      firstPage.resolve({
        events: [oldReply],
        next_cursor: { created_at: 100, event_id: oldReply.id },
      });
      await new Promise((r) => setImmediate(r));
    });
    assert.equal(
      reads,
      1,
      "obsolete navigation must not keep issuing history pages",
    );
  } finally {
    firstPage.resolve({ events: [], next_cursor: null });
    await h.dispose();
  }
});

test("a surviving multi-root consumer keeps shared pagination alive", async () => {
  const page = deferred();
  let reads = 0;
  const h = await mount(async () => {
    reads += 1;
    if (reads === 1) return page.promise;
    return { events: [latestReply], next_cursor: null };
  });
  const { renderHook } = await import("@testing-library/react");
  const other = renderHook(() => useThreadRepliesForRoots(channel, [rootId]), {
    wrapper: ({ children }) =>
      React.createElement(QueryClientProvider, { client: h.client }, children),
  });
  try {
    await h.waitFor(() => assert.equal(reads, 1));
    h.hook.rerender({ active: null, root: null });
    await h.act(async () => {
      page.resolve({
        events: [oldReply],
        next_cursor: { created_at: 100, event_id: oldReply.id },
      });
    });
    await h.waitFor(() => assert.equal(other.result.current.isPending, false));
    assert.equal(reads, 2);
    assert.deepEqual(
      other.result.current.events.map((e) => e.id),
      [oldReply.id, latestReply.id],
    );
  } finally {
    page.resolve({ events: [], next_cursor: null });
    other.unmount();
    await h.dispose();
  }
});

test("multi-root pagination stops when its last consumer leaves", async () => {
  const page = deferred();
  let reads = 0;
  const h = await mount(
    async () => {
      reads += 1;
      if (reads === 1) return page.promise;
      return { events: [latestReply], next_cursor: null };
    },
    { multiRoot: true },
  );
  try {
    await h.waitFor(() => assert.equal(reads, 1));
    h.hook.rerender({ active: null, root: null });
    await h.act(async () => {
      page.resolve({
        events: [oldReply],
        next_cursor: { created_at: 100, event_id: oldReply.id },
      });
      await new Promise((r) => setImmediate(r));
    });
    assert.equal(reads, 1);
  } finally {
    page.resolve({ events: [], next_cursor: null });
    await h.dispose();
  }
});

test("canceling a refresh retains cached replies and live arrivals", async () => {
  const page = deferred();
  let reads = 0;
  const h = await mount(async () => {
    reads += 1;
    if (reads === 1) return { events: [oldReply], next_cursor: null };
    return page.promise;
  });
  try {
    await h.waitFor(() => assert.equal(h.hook.result.current.isSuccess, true));
    await h.act(async () => {
      void h.hook.result.current.refetch();
    });
    await h.waitFor(() => assert.equal(reads, 2));
    const key = threadRepliesKey(channel.id, rootId);
    // Same cache seam used by live channel delivery while history is pending.
    await h.act(async () => {
      h.client.setQueryData(key, [oldReply, latestReply]);
    });
    h.hook.rerender({ active: null, root: null });
    await h.act(async () => {
      page.resolve({ events: [oldReply], next_cursor: null });
      await new Promise((r) => setImmediate(r));
    });
    assert.deepEqual(
      h.client.getQueryData(key).map((e) => e.id),
      [oldReply.id, latestReply.id],
    );
    assert.equal(h.client.getQueryState(key).fetchStatus, "idle");
    assert.equal(h.client.getQueryState(key).status, "success");
  } finally {
    page.resolve({ events: [], next_cursor: null });
    await h.dispose();
  }
});
