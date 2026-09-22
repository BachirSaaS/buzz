/**
 * Tests for the stale-at-open reader recovery added to all four sidebar hooks:
 *   useChannelSections, useChannelSortPreference, useChannelStars, useChannelMutes
 *
 * Covered seams:
 *  1. Bootstrap-fail → retry cadence applies remote (sections)
 *  2. Bootstrap-fail → retry cadence applies remote (sort)
 *  3. Bootstrap-fail → retry cadence applies merged remote (stars)
 *  4. Bootstrap-fail → retry cadence applies merged remote (mutes)
 *  5. Visibility-change to "visible" triggers an immediate retry (sections)
 *  6a. Pending whole-blob edit skips apply on the current tick (sections)
 *  6b. Pending per-entry edit skips apply on the current tick (stars)
 *  7. Unmount cancels the in-flight retry (sections)
 *  8. Equal-second tie-break: lower event ID wins (sections applyRemote guard)
 */

import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { JSDOM } from "jsdom";

// Shared JSDOM instance for all tests in this file.
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

after(() => dom.window.close());

// ---------------------------------------------------------------------------
// Tauri mock helper
// ---------------------------------------------------------------------------
function installTauri(pubkey) {
  const orig = globalThis.window?.__TAURI_INTERNALS__;
  if (typeof globalThis.window === "undefined") globalThis.window = {};
  globalThis.window.__TAURI_INTERNALS__ = {
    invoke: (cmd, args) => {
      if (cmd === "nip44_decrypt_from_self")
        return Promise.resolve(args?.ciphertext ?? "{}");
      if (cmd === "nip44_encrypt_to_self") return Promise.resolve("ct");
      if (cmd === "sign_event")
        return Promise.resolve(
          JSON.stringify({
            id: "eid",
            pubkey,
            content: "ct",
            created_at: 0,
            kind: 0,
            tags: [],
            sig: "s",
          }),
        );
      return Promise.reject(new Error(`unmocked: ${cmd}`));
    },
  };
  return () => {
    if (orig !== undefined) globalThis.window.__TAURI_INTERNALS__ = orig;
    else delete globalThis.window.__TAURI_INTERNALS__;
  };
}

// ---------------------------------------------------------------------------
// Tauri mock that hangs on encrypt (keeps pendingStore non-null)
// ---------------------------------------------------------------------------
function installHangingTauri(pubkey) {
  const orig = globalThis.window?.__TAURI_INTERNALS__;
  if (typeof globalThis.window === "undefined") globalThis.window = {};
  globalThis.window.__TAURI_INTERNALS__ = {
    invoke: (cmd, args) => {
      if (cmd === "nip44_decrypt_from_self")
        return Promise.resolve(args?.ciphertext ?? "{}");
      // Hang — keeps pendingStore non-null indefinitely.
      if (cmd === "nip44_encrypt_to_self") return new Promise(() => {});
      if (cmd === "sign_event")
        return Promise.resolve(
          JSON.stringify({
            id: "eid",
            pubkey,
            content: "ct",
            created_at: 0,
            kind: 0,
            tags: [],
            sig: "s",
          }),
        );
      return Promise.reject(new Error(`unmocked: ${cmd}`));
    },
  };
  return () => {
    if (orig !== undefined) globalThis.window.__TAURI_INTERNALS__ = orig;
    else delete globalThis.window.__TAURI_INTERNALS__;
  };
}

// ---------------------------------------------------------------------------
// 1. Sections: bootstrap-fail then retry applies remote
// ---------------------------------------------------------------------------
test("useChannelSections retry applies remote after bootstrap fetch failure", async () => {
  const { cleanup, renderHook, waitFor } = await import(
    "@testing-library/react"
  );
  const { relayClient } = await import("@/shared/api/relayClient");
  const { storageKey } = await import("./channelSectionsStorage.ts");
  const { useChannelSections } = await import("./useChannelSections.ts");

  const restoreTauri = installTauri("pk-sec");

  let fetchCallCount = 0;
  const remotePayload = JSON.stringify({
    version: 1,
    sections: [{ id: "s1", name: "Remote", order: 0 }],
    assignments: {},
  });
  // First call (bootstrap): fail. Subsequent calls (retry): succeed.
  const origFetch = relayClient.fetchEvents;
  relayClient.fetchEvents = async () => {
    fetchCallCount++;
    if (fetchCallCount === 1) throw new Error("network error");
    return [
      {
        id: "eid-remote",
        pubkey: "pk-sec",
        created_at: 1000,
        kind: 30078,
        content: remotePayload,
        tags: [["d", "channel-sections"]],
        sig: "sig",
      },
    ];
  };
  const origSubscribeLive = relayClient.subscribeLive;
  relayClient.subscribeLive = async () => async () => {};
  const origSubscribeToReconnects = relayClient.subscribeToReconnects;
  relayClient.subscribeToReconnects = () => () => {};

  const pubkey = "pk-sec";
  const relayUrl = "wss://relay.example";

  try {
    const { result, unmount } = renderHook(() =>
      useChannelSections(pubkey, relayUrl),
    );

    // The retry effect fires its first tick immediately on mount.
    // Bootstrap fails (call 1), retry fires immediately (call 2, no timer wait).
    await waitFor(() => assert.ok(fetchCallCount >= 2), { timeout: 2000 });
    await waitFor(
      () =>
        assert.ok(
          result.current.sections.some((s) => s.name === "Remote"),
          "remote section not applied after retry",
        ),
      { timeout: 2000 },
    );
    unmount();
  } finally {
    cleanup();
    restoreTauri();
    relayClient.fetchEvents = origFetch;
    relayClient.subscribeLive = origSubscribeLive;
    relayClient.subscribeToReconnects = origSubscribeToReconnects;
    try {
      globalThis.window.localStorage.removeItem(storageKey(pubkey, relayUrl));
    } catch {}
  }
});

// ---------------------------------------------------------------------------
// 2. Sort: bootstrap-fail then retry applies remote
// ---------------------------------------------------------------------------
test("useChannelSortPreference retry applies remote after bootstrap fetch failure", async () => {
  const { cleanup, renderHook, waitFor } = await import(
    "@testing-library/react"
  );
  const { relayClient } = await import("@/shared/api/relayClient");
  const { useChannelSortPreference } = await import(
    "./useChannelSortPreference.ts"
  );

  const restoreTauri = installTauri("pk-sort");

  let fetchCallCount = 0;
  const remotePayload = JSON.stringify({
    version: 1,
    groups: { starred: "recent" },
  });
  const origFetch = relayClient.fetchEvents;
  relayClient.fetchEvents = async () => {
    fetchCallCount++;
    if (fetchCallCount === 1) throw new Error("network error");
    return [
      {
        id: "eid-sort",
        pubkey: "pk-sort",
        created_at: 1000,
        kind: 30078,
        content: remotePayload,
        tags: [["d", "channel-sort"]],
        sig: "sig",
      },
    ];
  };
  const origSubscribeLive = relayClient.subscribeLive;
  relayClient.subscribeLive = async () => async () => {};
  const origSubscribeToReconnects = relayClient.subscribeToReconnects;
  relayClient.subscribeToReconnects = () => () => {};

  const pubkey = "pk-sort";
  const relayUrl = "wss://relay.example";

  try {
    const { result, unmount } = renderHook(() =>
      useChannelSortPreference(pubkey, relayUrl),
    );

    await waitFor(() => assert.ok(fetchCallCount >= 2), { timeout: 2000 });
    await waitFor(
      () =>
        assert.equal(
          result.current.sortModeFor("starred"),
          "recent",
          "remote sort mode not applied after retry",
        ),
      { timeout: 2000 },
    );
    unmount();
  } finally {
    cleanup();
    restoreTauri();
    relayClient.fetchEvents = origFetch;
    relayClient.subscribeLive = origSubscribeLive;
    relayClient.subscribeToReconnects = origSubscribeToReconnects;
  }
});

// ---------------------------------------------------------------------------
// 3. Stars: bootstrap-fail then retry merges remote
// ---------------------------------------------------------------------------
test("useChannelStars retry merges remote after bootstrap fetch failure", async () => {
  const { cleanup, renderHook, waitFor } = await import(
    "@testing-library/react"
  );
  const { relayClient } = await import("@/shared/api/relayClient");
  const { storageKey } = await import("./channelStarsStorage.ts");
  const { useChannelStars } = await import("./useChannelStars.ts");

  const restoreTauri = installTauri("pk-stars");

  let fetchCallCount = 0;
  const remotePayload = JSON.stringify({
    version: 1,
    channels: { "chan-remote": { starred: true, updatedAt: 2000 } },
  });
  const origFetch = relayClient.fetchEvents;
  relayClient.fetchEvents = async () => {
    fetchCallCount++;
    if (fetchCallCount === 1) throw new Error("network error");
    return [
      {
        id: "eid-stars",
        pubkey: "pk-stars",
        created_at: 1000,
        kind: 30078,
        content: remotePayload,
        tags: [["d", "channel-stars"]],
        sig: "sig",
      },
    ];
  };
  const origSubscribeLive = relayClient.subscribeLive;
  relayClient.subscribeLive = async () => async () => {};
  const origSubscribeToReconnects = relayClient.subscribeToReconnects;
  relayClient.subscribeToReconnects = () => () => {};

  const pubkey = "pk-stars";
  const relayUrl = "wss://relay.example";
  // Seed local: chan-local starred.
  globalThis.window.localStorage.setItem(
    storageKey(pubkey),
    JSON.stringify({
      version: 1,
      channels: { "chan-local": { starred: true, updatedAt: 1000 } },
    }),
  );

  try {
    const { result, unmount } = renderHook(() =>
      useChannelStars(pubkey, relayUrl),
    );

    await waitFor(() => assert.ok(fetchCallCount >= 2), { timeout: 2000 });
    // After merge: both chan-local (pre-seeded) and chan-remote (relay) should
    // be starred — mergeStores combines rather than replacing.
    await waitFor(
      () => {
        assert.ok(
          result.current.starredChannelIds.has("chan-remote"),
          "chan-remote not in starred set after retry merge",
        );
        assert.ok(
          result.current.starredChannelIds.has("chan-local"),
          "chan-local lost after retry merge",
        );
      },
      { timeout: 2000 },
    );
    unmount();
  } finally {
    cleanup();
    restoreTauri();
    relayClient.fetchEvents = origFetch;
    relayClient.subscribeLive = origSubscribeLive;
    relayClient.subscribeToReconnects = origSubscribeToReconnects;
    try {
      globalThis.window.localStorage.removeItem(storageKey(pubkey));
    } catch {}
  }
});

// ---------------------------------------------------------------------------
// 4. Mutes: bootstrap-fail then retry merges remote
// ---------------------------------------------------------------------------
test("useChannelMutes retry merges remote after bootstrap fetch failure", async () => {
  const { cleanup, renderHook, waitFor } = await import(
    "@testing-library/react"
  );
  const { relayClient } = await import("@/shared/api/relayClient");
  const { storageKey } = await import("./channelMutesStorage.ts");
  const { useChannelMutes } = await import("./useChannelMutes.ts");

  const restoreTauri = installTauri("pk-mutes");

  let fetchCallCount = 0;
  const remotePayload = JSON.stringify({
    version: 1,
    channels: { "chan-remote": { muted: true, updatedAt: 2000 } },
  });
  const origFetch = relayClient.fetchEvents;
  relayClient.fetchEvents = async () => {
    fetchCallCount++;
    if (fetchCallCount === 1) throw new Error("network error");
    return [
      {
        id: "eid-mutes",
        pubkey: "pk-mutes",
        created_at: 1000,
        kind: 30078,
        content: remotePayload,
        tags: [["d", "channel-mutes"]],
        sig: "sig",
      },
    ];
  };
  const origSubscribeLive = relayClient.subscribeLive;
  relayClient.subscribeLive = async () => async () => {};
  const origSubscribeToReconnects = relayClient.subscribeToReconnects;
  relayClient.subscribeToReconnects = () => () => {};

  const pubkey = "pk-mutes";
  const relayUrl = "wss://relay.example";
  globalThis.window.localStorage.setItem(
    storageKey(pubkey),
    JSON.stringify({
      version: 1,
      channels: { "chan-local": { muted: true, updatedAt: 1000 } },
    }),
  );

  try {
    const { result, unmount } = renderHook(() =>
      useChannelMutes(pubkey, relayUrl),
    );

    await waitFor(() => assert.ok(fetchCallCount >= 2), { timeout: 2000 });
    await waitFor(
      () => {
        assert.ok(
          result.current.mutedChannelIds.has("chan-remote"),
          "chan-remote not in muted set after retry merge",
        );
        assert.ok(
          result.current.mutedChannelIds.has("chan-local"),
          "chan-local lost after retry merge",
        );
      },
      { timeout: 2000 },
    );
    unmount();
  } finally {
    cleanup();
    restoreTauri();
    relayClient.fetchEvents = origFetch;
    relayClient.subscribeLive = origSubscribeLive;
    relayClient.subscribeToReconnects = origSubscribeToReconnects;
    try {
      globalThis.window.localStorage.removeItem(storageKey(pubkey));
    } catch {}
  }
});

// ---------------------------------------------------------------------------
// 5. Visibility-change to "visible" triggers an immediate retry (sections)
// ---------------------------------------------------------------------------
test("useChannelSections visibility-change to visible triggers immediate retry", async () => {
  const { cleanup, renderHook, waitFor } = await import(
    "@testing-library/react"
  );
  const { relayClient } = await import("@/shared/api/relayClient");
  const { useChannelSections } = await import("./useChannelSections.ts");

  const restoreTauri = installTauri("pk-vis");

  let fetchCallCount = 0;
  const remotePayload = JSON.stringify({
    version: 1,
    sections: [{ id: "s-vis", name: "Visible", order: 0 }],
    assignments: {},
  });
  const origFetch = relayClient.fetchEvents;
  relayClient.fetchEvents = async () => {
    fetchCallCount++;
    return [
      {
        id: `eid-vis-${fetchCallCount}`,
        pubkey: "pk-vis",
        created_at: 1000 + fetchCallCount,
        kind: 30078,
        content: remotePayload,
        tags: [["d", "channel-sections"]],
        sig: "sig",
      },
    ];
  };
  const origSubscribeLive = relayClient.subscribeLive;
  relayClient.subscribeLive = async () => async () => {};
  const origSubscribeToReconnects = relayClient.subscribeToReconnects;
  relayClient.subscribeToReconnects = () => () => {};

  const pubkey = "pk-vis";
  const relayUrl = "wss://relay.example";

  try {
    const { unmount } = renderHook(() => useChannelSections(pubkey, relayUrl));

    // Wait for the initial tick to complete.
    await waitFor(() => assert.ok(fetchCallCount >= 1), { timeout: 2000 });
    const countAfterInitial = fetchCallCount;

    // Simulate a visibility-change to "visible". The retry effect listens on
    // `document` (the JSDOM document, wired up in the before() hook).
    Object.defineProperty(dom.window.document, "visibilityState", {
      value: "visible",
      writable: true,
      configurable: true,
    });
    dom.window.document.dispatchEvent(new dom.window.Event("visibilitychange"));

    // A new fetch should fire immediately without waiting for the next timer.
    await waitFor(
      () =>
        assert.ok(
          fetchCallCount > countAfterInitial,
          "visibility-change did not trigger a new fetch",
        ),
      { timeout: 2000 },
    );
    unmount();
  } finally {
    cleanup();
    restoreTauri();
    relayClient.fetchEvents = origFetch;
    relayClient.subscribeLive = origSubscribeLive;
    relayClient.subscribeToReconnects = origSubscribeToReconnects;
  }
});

// ---------------------------------------------------------------------------
// 6a. Pending whole-blob edit defers apply on the current tick (sections)
//
// Strategy: make fetchEvents hang on the first call so the retry tick is
// in-flight when we trigger the local edit.  createSection sets pendingStore
// immediately (inside publishSections, before the debounce timer fires).
// When we then resolve the hanging fetch, applyRemote is skipped because
// getPendingStore() is non-null.
// ---------------------------------------------------------------------------
test("useChannelSections retry skips apply when a pending publish is in flight", async () => {
  const { act, cleanup, renderHook, waitFor } = await import(
    "@testing-library/react"
  );
  const { relayClient } = await import("@/shared/api/relayClient");
  const { useChannelSections } = await import("./useChannelSections.ts");

  // fetchEvents hangs until manually resolved so we can set the pending store
  // mid-flight.  The remote payload would normally overwrite local state.
  const remotePayload = JSON.stringify({
    version: 1,
    sections: [{ id: "s-skip", name: "ShouldNotAppear", order: 0 }],
    assignments: {},
  });
  let resolveFetch = null;
  const origFetch = relayClient.fetchEvents;
  relayClient.fetchEvents = () =>
    new Promise((res) => {
      resolveFetch = res;
    });
  const origSubscribeLive = relayClient.subscribeLive;
  relayClient.subscribeLive = async () => async () => {};
  const origSubscribeToReconnects = relayClient.subscribeToReconnects;
  relayClient.subscribeToReconnects = () => () => {};

  // Tauri: make nip44_encrypt_to_self hang so the pending store is never
  // cleared after the debounce timer fires.
  const restoreTauri = installHangingTauri("pk-skip");

  const pubkey = "pk-skip";
  const relayUrl = "wss://relay.example";

  try {
    const { result, unmount } = renderHook(() =>
      useChannelSections(pubkey, relayUrl),
    );

    // Wait for the retry tick to start (fetchEvents is hanging, resolveFetch set).
    await waitFor(() => assert.ok(resolveFetch !== null), { timeout: 2000 });

    // Now trigger a local edit — publishSections sets pendingStore immediately.
    await act(async () => {
      result.current.createSection("PendingSection");
    });

    // Resolve the hanging fetch with the remote payload.
    resolveFetch([
      {
        id: "eid-skip",
        pubkey: "pk-skip",
        created_at: 5000,
        kind: 30078,
        content: remotePayload,
        tags: [["d", "channel-sections"]],
        sig: "sig",
      },
    ]);

    // Give React a tick to process the resolution.
    await new Promise((r) => setTimeout(r, 50));

    // The remote "ShouldNotAppear" section must NOT have been applied because
    // the pending edit guard deferred it.
    assert.ok(
      !result.current.sections.some((s) => s.name === "ShouldNotAppear"),
      "remote apply was not deferred while pending edit was in flight",
    );
    unmount();
  } finally {
    cleanup();
    restoreTauri();
    relayClient.fetchEvents = origFetch;
    relayClient.subscribeLive = origSubscribeLive;
    relayClient.subscribeToReconnects = origSubscribeToReconnects;
  }
});

// ---------------------------------------------------------------------------
// 6b. Pending per-entry edit defers apply on the current tick (stars)
// ---------------------------------------------------------------------------
test("useChannelStars retry skips apply when a pending publish is in flight", async () => {
  const { act, cleanup, renderHook } = await import("@testing-library/react");
  const { relayClient } = await import("@/shared/api/relayClient");
  const { useChannelStars } = await import("./useChannelStars.ts");

  const remotePayload = JSON.stringify({
    version: 1,
    channels: { "chan-remote-only": { starred: true, updatedAt: 3000 } },
  });
  const origFetch = relayClient.fetchEvents;
  relayClient.fetchEvents = async () => [
    {
      id: "eid-stars-skip",
      pubkey: "pk-stars-skip",
      created_at: 1000,
      kind: 30078,
      content: remotePayload,
      tags: [["d", "channel-stars"]],
      sig: "sig",
    },
  ];
  const origSubscribeLive = relayClient.subscribeLive;
  relayClient.subscribeLive = async () => async () => {};
  const origSubscribeToReconnects = relayClient.subscribeToReconnects;
  relayClient.subscribeToReconnects = () => () => {};

  const restoreTauri = installHangingTauri("pk-stars-skip");

  const pubkey = "pk-stars-skip";
  const relayUrl = "wss://relay.example";

  try {
    const { result, unmount } = renderHook(() =>
      useChannelStars(pubkey, relayUrl),
    );

    // Create a local pending star edit.
    await act(async () => {
      result.current.starChannel("chan-local-pending");
    });

    // Give the retry tick time to run.
    await new Promise((r) => setTimeout(r, 100));

    // The local pending star must survive.
    assert.ok(
      result.current.starredChannelIds.has("chan-local-pending"),
      "local pending star was lost",
    );
    unmount();
  } finally {
    cleanup();
    restoreTauri();
    relayClient.fetchEvents = origFetch;
    relayClient.subscribeLive = origSubscribeLive;
    relayClient.subscribeToReconnects = origSubscribeToReconnects;
  }
});

// ---------------------------------------------------------------------------
// 7. Unmount cancels the in-flight retry (sections)
// ---------------------------------------------------------------------------
test("useChannelSections unmount prevents stale retry from applying state", async () => {
  const { cleanup, renderHook, waitFor } = await import(
    "@testing-library/react"
  );
  const { relayClient } = await import("@/shared/api/relayClient");
  const { useChannelSections } = await import("./useChannelSections.ts");

  const restoreTauri = installTauri("pk-cancel");

  // fetchEvents hangs until manually resolved so we can unmount mid-flight.
  let resolveHanging = null;
  const origFetch = relayClient.fetchEvents;
  relayClient.fetchEvents = async () =>
    new Promise((res) => {
      resolveHanging = res;
    });
  const origSubscribeLive = relayClient.subscribeLive;
  relayClient.subscribeLive = async () => async () => {};
  const origSubscribeToReconnects = relayClient.subscribeToReconnects;
  relayClient.subscribeToReconnects = () => () => {};

  const pubkey = "pk-cancel";
  const relayUrl = "wss://relay.example";

  try {
    const { result, unmount } = renderHook(() =>
      useChannelSections(pubkey, relayUrl),
    );

    // Wait until the retry tick is in-flight (fetchEvents is hanging).
    await waitFor(() => assert.ok(resolveHanging !== null), { timeout: 2000 });

    // Unmount while the fetch is pending — sets the cancelled flag.
    unmount();

    // Resolve the fetch with a remote payload after unmount.
    const remotePayload = JSON.stringify({
      version: 1,
      sections: [{ id: "s-ghost", name: "Ghost", order: 0 }],
      assignments: {},
    });
    resolveHanging([
      {
        id: "eid-ghost",
        pubkey: "pk-cancel",
        created_at: 9000,
        kind: 30078,
        content: remotePayload,
        tags: [["d", "channel-sections"]],
        sig: "sig",
      },
    ]);

    // Give React a tick to process the resolution.
    await new Promise((r) => setTimeout(r, 50));

    // The cancelled flag must have prevented setStore from being called.
    assert.ok(
      !result.current.sections.some((s) => s.name === "Ghost"),
      "post-unmount fetch result was applied despite cancelled flag",
    );
  } finally {
    cleanup();
    restoreTauri();
    relayClient.fetchEvents = origFetch;
    relayClient.subscribeLive = origSubscribeLive;
    relayClient.subscribeToReconnects = origSubscribeToReconnects;
  }
});

// ---------------------------------------------------------------------------
// 8. Equal-second tie-break: lower event ID wins (sections applyRemote guard)
//
// The relay's canonical order is created_at DESC, id ASC — at equal second the
// lower event ID is retained.  applyRemote must reject an incoming event whose
// ID is >= the already-applied ID so the hook converges to the canonical head.
// ---------------------------------------------------------------------------
test("useChannelSections applyRemote retains lower event ID at equal second", async () => {
  const { cleanup, renderHook, waitFor } = await import(
    "@testing-library/react"
  );
  const { relayClient } = await import("@/shared/api/relayClient");
  const { useChannelSections } = await import("./useChannelSections.ts");

  const restoreTauri = installTauri("pk-tb");

  const TS = 1_700_000_000;
  const LOW_ID = "aaa-lower-id";
  const HIGH_ID = "zzz-higher-id";

  const makePayload = (sectionName) =>
    JSON.stringify({
      version: 1,
      sections: [{ id: "s-tb", name: sectionName, order: 0 }],
      assignments: {},
    });

  // Step 1 (bootstrap): LOW_ID event — the canonical retained head.
  // Step 2+ (retry): HIGH_ID event — a non-canonical duplicate at equal second.
  let fetchCallCount = 0;
  const origFetch = relayClient.fetchEvents;
  relayClient.fetchEvents = async () => {
    fetchCallCount++;
    const id = fetchCallCount === 1 ? LOW_ID : HIGH_ID;
    const name = fetchCallCount === 1 ? "LowSection" : "HighSection";
    return [
      {
        id,
        pubkey: "pk-tb",
        created_at: TS,
        kind: 30078,
        content: makePayload(name),
        tags: [["d", "channel-sections"]],
        sig: "sig",
      },
    ];
  };
  const origSubscribeLive = relayClient.subscribeLive;
  relayClient.subscribeLive = async () => async () => {};
  const origSubscribeToReconnects = relayClient.subscribeToReconnects;
  relayClient.subscribeToReconnects = () => () => {};

  const pubkey = "pk-tb";
  const relayUrl = "wss://relay.example";

  try {
    const { result, unmount } = renderHook(() =>
      useChannelSections(pubkey, relayUrl),
    );

    // Wait for bootstrap (LOW_ID) to apply.
    await waitFor(
      () =>
        assert.ok(
          result.current.sections.some((s) => s.name === "LowSection"),
          "bootstrap LOW_ID not applied",
        ),
      { timeout: 2000 },
    );

    // Wait for at least one retry fetch (HIGH_ID) to run.
    await waitFor(() => assert.ok(fetchCallCount >= 2), { timeout: 2000 });

    // HIGH_ID (>= LOW_ID at equal second) must be rejected; LowSection persists.
    assert.ok(
      result.current.sections.some((s) => s.name === "LowSection"),
      "LowSection was overwritten by HighSection — tie-break is wrong",
    );
    assert.ok(
      !result.current.sections.some((s) => s.name === "HighSection"),
      "HighSection was applied — tie-break is wrong",
    );
    unmount();
  } finally {
    cleanup();
    restoreTauri();
    relayClient.fetchEvents = origFetch;
    relayClient.subscribeLive = origSubscribeLive;
    relayClient.subscribeToReconnects = origSubscribeToReconnects;
  }
});

// ---------------------------------------------------------------------------
// Drain helper: flushes async microtasks + one round of setImmediate callbacks.
// Used after t.mock.timers.tick() because waitFor polls via setTimeout, which
// is intercepted by the mock and deadlocks when mock timers are enabled.
// ---------------------------------------------------------------------------
async function drainAsync(n = 8) {
  for (let i = 0; i < n; i++) {
    await new Promise((r) => setImmediate(r));
  }
}

// ---------------------------------------------------------------------------
// 9. Backoff timer cadence: failure → success → later missed head, capped ticks
//
// The retry effect must: advance through 5 → 10 → 30 → 60 s steps, apply a
// found result, then keep scheduling at 60 s for a later missed head.
// ---------------------------------------------------------------------------
test("useChannelSections retry advances backoff and applies success then continues polling", async (t) => {
  const { cleanup, renderHook, waitFor } = await import(
    "@testing-library/react"
  );
  const { relayClient } = await import("@/shared/api/relayClient");
  const { useChannelSections } = await import("./useChannelSections.ts");

  t.mock.timers.enable({ apis: ["setTimeout"] });
  const restoreTauri = installTauri("pk-backoff");

  let fetchCallCount = 0;
  const remotePayload = (name) =>
    JSON.stringify({
      version: 1,
      sections: [{ id: "s1", name, order: 0 }],
      assignments: {},
    });
  const origFetch = relayClient.fetchEvents;
  relayClient.fetchEvents = async () => {
    fetchCallCount++;
    // Calls 1–2: fail (bootstrap + first retry tick). Call 3+: succeed.
    if (fetchCallCount <= 2) throw new Error("network error");
    return [
      {
        id: `eid-${fetchCallCount}`,
        pubkey: "pk-backoff",
        created_at: 1000 + fetchCallCount,
        kind: 30078,
        content: remotePayload(`Section-${fetchCallCount}`),
        tags: [["d", "channel-sections"]],
        sig: "sig",
      },
    ];
  };
  const origSubscribeLive = relayClient.subscribeLive;
  relayClient.subscribeLive = async () => async () => {};
  const origSubscribeToReconnects = relayClient.subscribeToReconnects;
  relayClient.subscribeToReconnects = () => () => {};

  const pubkey = "pk-backoff";
  const relayUrl = "wss://relay.example";

  try {
    const { result, unmount } = renderHook(() =>
      useChannelSections(pubkey, relayUrl),
    );

    // Initial tick fires immediately: bootstrap (call 1) throws, retry (call 2)
    // also throws. Both are async — drain microtasks to let them complete.
    await drainAsync();
    assert.ok(
      fetchCallCount >= 2,
      `expected ≥2 fetches after mount, got ${fetchCallCount}`,
    );

    // Advance 5 s: step 0 fires, call 3 succeeds → Section-3 applied.
    t.mock.timers.tick(5_000);
    await drainAsync();
    assert.ok(
      result.current.sections.some((s) => s.name === "Section-3"),
      "5-s tick did not apply remote",
    );
    const countAfterFirst = fetchCallCount;

    // Advance 10 s: step 1 fires → another fetch.
    t.mock.timers.tick(10_000);
    await drainAsync();
    assert.ok(
      fetchCallCount > countAfterFirst,
      "10-s tick did not fire another fetch",
    );

    // Advance past 60 s cap to confirm steady-state polling continues.
    const countBeforeCap = fetchCallCount;
    t.mock.timers.tick(60_000);
    await drainAsync();
    assert.ok(
      fetchCallCount > countBeforeCap,
      "60-s cap tick did not fire another fetch",
    );

    unmount();
  } finally {
    cleanup();
    t.mock.timers.reset();
    restoreTauri();
    relayClient.fetchEvents = origFetch;
    relayClient.subscribeLive = origSubscribeLive;
    relayClient.subscribeToReconnects = origSubscribeToReconnects;
  }
});

// ---------------------------------------------------------------------------
// 10. Single-flight: a held fetch blocks a visibility-triggered tick
// ---------------------------------------------------------------------------
test("useChannelSections single-flight: visibility tick does not start a second fetch while one is in flight", async (t) => {
  const { cleanup, renderHook, waitFor } = await import(
    "@testing-library/react"
  );
  const { relayClient } = await import("@/shared/api/relayClient");
  const { useChannelSections } = await import("./useChannelSections.ts");

  // Only mock Date here so visibility/rendering still progresses; setTimeout
  // left unmocked so waitFor can poll normally for the initial fetch.
  const restoreTauri = installTauri("pk-sf");

  let fetchCallCount = 0;
  let resolveHanging = null;
  const origFetch = relayClient.fetchEvents;
  relayClient.fetchEvents = () => {
    fetchCallCount++;
    return new Promise((res) => {
      resolveHanging = res;
    });
  };
  const origSubscribeLive = relayClient.subscribeLive;
  relayClient.subscribeLive = async () => async () => {};
  const origSubscribeToReconnects = relayClient.subscribeToReconnects;
  relayClient.subscribeToReconnects = () => () => {};

  const pubkey = "pk-sf";
  const relayUrl = "wss://relay.example";

  try {
    renderHook(() => useChannelSections(pubkey, relayUrl));

    // Wait for first fetch to start (hook fires tick immediately on mount).
    await waitFor(() => assert.ok(fetchCallCount >= 1), { timeout: 2000 });
    const countWithFetch = fetchCallCount;

    // Dispatch visibility change while fetch is in flight.
    Object.defineProperty(dom.window.document, "visibilityState", {
      value: "visible",
      writable: true,
      configurable: true,
    });
    dom.window.document.dispatchEvent(new dom.window.Event("visibilitychange"));

    // Drain — give the handler a chance to run (it should bail on inFlight).
    await drainAsync();

    // Single-flight: no second fetch should have started.
    assert.equal(
      fetchCallCount,
      countWithFetch,
      "visibility triggered a second in-flight fetch",
    );

    // Resolve the hanging fetch.
    resolveHanging([]);
  } finally {
    cleanup();
    restoreTauri();
    relayClient.fetchEvents = origFetch;
    relayClient.subscribeLive = origSubscribeLive;
    relayClient.subscribeToReconnects = origSubscribeToReconnects;
  }
});

// ---------------------------------------------------------------------------
// 11. Pending survival + recovery resumes after pending clears
//
// While a local edit is pending, retry skips apply.  Once pending clears
// (simulate successful publish by resolving encrypt + sign), the NEXT tick
// applies the remote.
// ---------------------------------------------------------------------------
test("useChannelSections recovery resumes after pending edit clears", async (t) => {
  const { act, cleanup, renderHook, waitFor } = await import(
    "@testing-library/react"
  );
  const { relayClient } = await import("@/shared/api/relayClient");
  const { useChannelSections } = await import("./useChannelSections.ts");

  t.mock.timers.enable({ apis: ["setTimeout"] });

  const remotePayload = JSON.stringify({
    version: 1,
    sections: [{ id: "s-resume", name: "ResumeSection", order: 0 }],
    assignments: {},
  });

  // First fetch (initial tick on mount): hang until we release it so we can
  // create the local edit before the remote response lands.
  let releaseInitialFetch = null;
  let fetchCallCount = 0;
  const origFetch = relayClient.fetchEvents;
  relayClient.fetchEvents = async () => {
    fetchCallCount++;
    if (fetchCallCount === 1) {
      // Bootstrap: fail immediately (not via timer).
      throw new Error("bootstrap fail");
    }
    if (fetchCallCount === 2) {
      // First retry tick (fires immediately on mount): hang until released.
      return new Promise((res) => {
        releaseInitialFetch = res;
      });
    }
    // Subsequent ticks: return the remote payload normally.
    return [
      {
        id: `eid-r-${fetchCallCount}`,
        pubkey: "pk-resume",
        created_at: 1000 + fetchCallCount,
        kind: 30078,
        content: remotePayload,
        tags: [["d", "channel-sections"]],
        sig: "sig",
      },
    ];
  };
  const origSubscribeLive = relayClient.subscribeLive;
  relayClient.subscribeLive = async () => async () => {};
  const origSubscribeToReconnects = relayClient.subscribeToReconnects;
  relayClient.subscribeToReconnects = () => () => {};
  // publishEvent must succeed so pendingStore is cleared after the publish.
  const origPublishEvent = relayClient.publishEvent;
  relayClient.publishEvent = async () => {};

  // Tauri: encrypt hangs initially (keeps pending), then resolves on demand.
  let resolveEncrypt = null;
  const origTauri = globalThis.window?.__TAURI_INTERNALS__;
  if (typeof globalThis.window === "undefined") globalThis.window = {};
  globalThis.window.__TAURI_INTERNALS__ = {
    invoke: (cmd, args) => {
      if (cmd === "nip44_decrypt_from_self")
        return Promise.resolve(args?.ciphertext ?? "{}");
      if (cmd === "nip44_encrypt_to_self")
        return new Promise((res) => {
          resolveEncrypt = res;
        });
      if (cmd === "sign_event")
        return Promise.resolve(
          JSON.stringify({
            id: "eid-pub",
            pubkey: "pk-resume",
            content: "ct",
            created_at: 0,
            kind: 0,
            tags: [],
            sig: "s",
          }),
        );
      return Promise.reject(new Error(`unmocked: ${cmd}`));
    },
  };

  const pubkey = "pk-resume";
  const relayUrl = "wss://relay.example";

  try {
    const { result, unmount } = renderHook(() =>
      useChannelSections(pubkey, relayUrl),
    );

    // Drain so bootstrap (call 1) throws and retry tick (call 2) starts and hangs.
    await drainAsync();
    assert.ok(
      releaseInitialFetch !== null,
      "retry tick did not start on mount",
    );

    // Create a local edit — sets pendingStore.
    await act(async () => {
      result.current.createSection("PendingEdit");
    });

    // Release the hanging fetch with the remote payload; the pending guard
    // inside the updater must prevent it from being applied.
    releaseInitialFetch([
      {
        id: "eid-r-2",
        pubkey: "pk-resume",
        created_at: 1002,
        kind: 30078,
        content: remotePayload,
        tags: [["d", "channel-sections"]],
        sig: "sig",
      },
    ]);
    await drainAsync();
    assert.ok(
      !result.current.sections.some((s) => s.name === "ResumeSection"),
      "remote applied while pending was set",
    );

    // Advance past the backoff step so a new tick fires (call 3+).
    t.mock.timers.tick(5_000);
    await drainAsync();
    assert.ok(
      !result.current.sections.some((s) => s.name === "ResumeSection"),
      "remote applied on backoff tick while pending still set",
    );

    // Resolve encrypt so the debounce publish completes and clears pending.
    // Debounce timer (2 s) needs to fire first.
    t.mock.timers.tick(2_000);
    resolveEncrypt("ct");
    await drainAsync();

    // Advance to the next retry tick; pending is now clear → remote applied.
    t.mock.timers.tick(10_000);
    await drainAsync();
    assert.ok(
      result.current.sections.some((s) => s.name === "ResumeSection"),
      "remote not applied after pending cleared",
    );

    unmount();
  } finally {
    cleanup();
    t.mock.timers.reset();
    if (origTauri !== undefined)
      globalThis.window.__TAURI_INTERNALS__ = origTauri;
    else delete globalThis.window.__TAURI_INTERNALS__;
    relayClient.fetchEvents = origFetch;
    relayClient.publishEvent = origPublishEvent;
    relayClient.subscribeLive = origSubscribeLive;
    relayClient.subscribeToReconnects = origSubscribeToReconnects;
  }
});

// ---------------------------------------------------------------------------
// 12. Lifecycle fencing: identity change restarts the effect (sections)
//
// When pubkey changes the old effect is cleaned up and a new effect starts.
// The old timer must not fire after the identity change.
// ---------------------------------------------------------------------------
test("useChannelSections identity change restarts retry effect and cancels old timer", async (t) => {
  const { cleanup, renderHook, waitFor } = await import(
    "@testing-library/react"
  );
  const { relayClient } = await import("@/shared/api/relayClient");
  const { useChannelSections } = await import("./useChannelSections.ts");

  t.mock.timers.enable({ apis: ["setTimeout"] });
  const restoreTauri = installTauri("pk-lc-a");

  const fetchCounts = { "pk-lc-a": 0, "pk-lc-b": 0 };
  const origFetch = relayClient.fetchEvents;
  relayClient.fetchEvents = async (opts) => {
    // Identify which identity by the author filter.
    const author = opts?.authors?.[0];
    if (author && author in fetchCounts) fetchCounts[author]++;
    return [];
  };
  const origSubscribeLive = relayClient.subscribeLive;
  relayClient.subscribeLive = async () => async () => {};
  const origSubscribeToReconnects = relayClient.subscribeToReconnects;
  relayClient.subscribeToReconnects = () => () => {};

  const relayUrl = "wss://relay.example";
  let pubkey = "pk-lc-a";

  try {
    const { rerender, unmount } = renderHook(() =>
      useChannelSections(pubkey, relayUrl),
    );

    // Wait for pk-lc-a's first fetch (fires immediately on mount).
    await drainAsync();
    assert.ok(fetchCounts["pk-lc-a"] >= 1, "pk-lc-a did not fetch on mount");

    // Switch identity — old effect cleans up; new effect starts.
    pubkey = "pk-lc-b";
    rerender();

    // pk-lc-b's first tick fires immediately.
    await drainAsync();
    assert.ok(
      fetchCounts["pk-lc-b"] >= 1,
      "pk-lc-b did not fetch after identity change",
    );

    // Advance old backoff step — if old timer leaked it would fetch pk-lc-a again.
    const countA = fetchCounts["pk-lc-a"];
    t.mock.timers.tick(5_000);
    await drainAsync();
    assert.equal(
      fetchCounts["pk-lc-a"],
      countA,
      "old identity timer leaked after identity change",
    );

    unmount();
  } finally {
    cleanup();
    t.mock.timers.reset();
    restoreTauri();
    relayClient.fetchEvents = origFetch;
    relayClient.subscribeLive = origSubscribeLive;
    relayClient.subscribeToReconnects = origSubscribeToReconnects;
  }
});

// ---------------------------------------------------------------------------
// C1. Causal regression: queued local-edit updater executes after remote
//     updater is queued — pending guard inside updater prevents cancellation
// ---------------------------------------------------------------------------
test("useChannelSections pending guard inside updater prevents cancelling a queued local edit", async (t) => {
  const { act, cleanup, renderHook, waitFor } = await import(
    "@testing-library/react"
  );
  const { relayClient } = await import("@/shared/api/relayClient");
  const { useChannelSections } = await import("./useChannelSections.ts");

  // fetchEvents hangs until we resolve so we can control timing.
  let resolveRemote = null;
  const remotePayload = JSON.stringify({
    version: 1,
    sections: [{ id: "s-remote", name: "RemoteSection", order: 0 }],
    assignments: {},
  });
  const origFetch = relayClient.fetchEvents;
  relayClient.fetchEvents = () =>
    new Promise((res) => {
      resolveRemote = res;
    });
  const origSubscribeLive = relayClient.subscribeLive;
  relayClient.subscribeLive = async () => async () => {};
  const origSubscribeToReconnects = relayClient.subscribeToReconnects;
  relayClient.subscribeToReconnects = () => () => {};

  // Tauri: encrypt hangs (keeps pending non-null after local edit).
  const restoreTauri = installHangingTauri("pk-c1");

  const pubkey = "pk-c1";
  const relayUrl = "wss://relay.example";

  try {
    const { result, unmount } = renderHook(() =>
      useChannelSections(pubkey, relayUrl),
    );

    // Wait for the retry tick to be in-flight.
    await waitFor(() => assert.ok(resolveRemote !== null), { timeout: 2000 });

    // Queue local edit while the remote fetch is in flight.
    await act(async () => {
      result.current.createSection("LocalSection");
    });

    // Now resolve the remote response — the updater should see pending and bail.
    resolveRemote([
      {
        id: "eid-remote-c1",
        pubkey: "pk-c1",
        created_at: 5000,
        kind: 30078,
        content: remotePayload,
        tags: [["d", "channel-sections"]],
        sig: "sig",
      },
    ]);

    // Give React time to process both queued updaters.
    await drainAsync();

    // The local section must still be in the store.
    assert.ok(
      result.current.sections.some((s) => s.name === "LocalSection"),
      "local section was lost — pending guard in updater failed",
    );
    // The remote section must NOT have replaced the local one.
    assert.ok(
      !result.current.sections.some((s) => s.name === "RemoteSection"),
      "remote applied despite pending guard",
    );

    unmount();
  } finally {
    cleanup();
    restoreTauri();
    relayClient.fetchEvents = origFetch;
    relayClient.subscribeLive = origSubscribeLive;
    relayClient.subscribeToReconnects = origSubscribeToReconnects;
  }
});

// ---------------------------------------------------------------------------
// C2. Causal regression: delayed read completing after local publish clears
//     pending — mutation revision discards the stale response
// ---------------------------------------------------------------------------
test("useChannelSections mutation revision discards a stale remote response after local publish", async (t) => {
  const { act, cleanup, renderHook, waitFor } = await import(
    "@testing-library/react"
  );
  const { relayClient } = await import("@/shared/api/relayClient");
  const { useChannelSections } = await import("./useChannelSections.ts");

  t.mock.timers.enable({ apis: ["setTimeout"] });

  // Remote payload that must NOT overwrite a successfully published local edit.
  const remotePayload = JSON.stringify({
    version: 1,
    sections: [{ id: "s-stale", name: "StaleRemote", order: 0 }],
    assignments: {},
  });
  let resolveRemote = null;
  const origFetch = relayClient.fetchEvents;
  relayClient.fetchEvents = () =>
    new Promise((res) => {
      resolveRemote = res;
    });
  const origSubscribeLive = relayClient.subscribeLive;
  relayClient.subscribeLive = async () => async () => {};
  const origSubscribeToReconnects = relayClient.subscribeToReconnects;
  relayClient.subscribeToReconnects = () => () => {};

  // Tauri: respond normally so the publish completes and clears pending.
  const restoreTauri = installTauri("pk-c2");

  const pubkey = "pk-c2";
  const relayUrl = "wss://relay.example";

  try {
    const { result, unmount } = renderHook(() =>
      useChannelSections(pubkey, relayUrl),
    );

    // Wait for the retry tick to be in-flight (fetch is hanging).
    // The initial tick fires immediately on mount — drain to let it start.
    await drainAsync();
    assert.ok(resolveRemote !== null, "retry tick did not start on mount");

    // While the fetch hangs, trigger a local edit and let it publish completely.
    // Advance the debounce timer so the publish fires and clears pending.
    await act(async () => {
      result.current.createSection("LocalPublished");
    });
    t.mock.timers.tick(2_000); // debounce
    // Give async sign/send time to complete (Tauri mock is synchronous here).
    await drainAsync();

    // Now resolve the stale remote fetch (started BEFORE the local edit).
    resolveRemote([
      {
        id: "eid-stale",
        pubkey: "pk-c2",
        created_at: 3000,
        kind: 30078,
        content: remotePayload,
        tags: [["d", "channel-sections"]],
        sig: "sig",
      },
    ]);

    await drainAsync();

    // The stale remote must have been discarded (revision changed).
    assert.ok(
      !result.current.sections.some((s) => s.name === "StaleRemote"),
      "stale remote overwrote a successfully published local edit",
    );
    assert.ok(
      result.current.sections.some((s) => s.name === "LocalPublished"),
      "locally published section was lost",
    );

    unmount();
  } finally {
    cleanup();
    t.mock.timers.reset();
    restoreTauri();
    relayClient.fetchEvents = origFetch;
    relayClient.subscribeLive = origSubscribeLive;
    relayClient.subscribeToReconnects = origSubscribeToReconnects;
  }
});

// ---------------------------------------------------------------------------
// C3. Causal regression: one-shot cache-write failure leaves the head
//     retryable — the same head is accepted on the next successful write
// ---------------------------------------------------------------------------
test("useChannelSections one-shot cache-write failure leaves the same head retryable", async (t) => {
  const { cleanup, renderHook, waitFor } = await import(
    "@testing-library/react"
  );
  const { relayClient } = await import("@/shared/api/relayClient");
  const { useChannelSections } = await import("./useChannelSections.ts");

  t.mock.timers.enable({ apis: ["setTimeout"] });
  const restoreTauri = installTauri("pk-c3");

  const TS = 9_000;
  const remotePayload = JSON.stringify({
    version: 1,
    sections: [{ id: "s-c3", name: "ShouldPersist", order: 0 }],
    assignments: {},
  });
  let fetchCallCount = 0;
  const origFetch = relayClient.fetchEvents;
  relayClient.fetchEvents = async () => {
    fetchCallCount++;
    if (fetchCallCount === 1) throw new Error("bootstrap fail");
    // All subsequent fetches return the same head.
    return [
      {
        id: "eid-c3",
        pubkey: "pk-c3",
        created_at: TS,
        kind: 30078,
        content: remotePayload,
        tags: [["d", "channel-sections"]],
        sig: "sig",
      },
    ];
  };
  const origSubscribeLive = relayClient.subscribeLive;
  relayClient.subscribeLive = async () => async () => {};
  const origSubscribeToReconnects = relayClient.subscribeToReconnects;
  relayClient.subscribeToReconnects = () => () => {};

  // Make writes to the sections key fail once (quota exceeded), then restore.
  // Other writes (e.g. watermark) are allowed through so bootstrap proceeds
  // normally; only the write that would apply the remote section data fails.
  // Import storageKey to get the exact key format (encodes relay URL).
  const { storageKey: sectionsStorageKey } = await import(
    "./channelSectionsStorage.ts"
  );
  let writeFailCount = 0;
  // Patch via the Storage prototype so the intercept is visible to all modules
  // that access window.localStorage (patching the instance property is not
  // picked up by JSDOM's internal Storage dispatch).
  const StorageProto = Object.getPrototypeOf(dom.window.localStorage);
  const origSetItem = StorageProto.setItem;

  const pubkey = "pk-c3";
  const relayUrl = "wss://relay.example";

  const targetKey = sectionsStorageKey(pubkey, relayUrl);
  StorageProto.setItem = function (key, value) {
    if (key === targetKey && writeFailCount < 1) {
      writeFailCount++;
      throw new DOMException("QuotaExceededError");
    }
    return origSetItem.call(this, key, value);
  };

  try {
    const { result, unmount } = renderHook(() =>
      useChannelSections(pubkey, relayUrl),
    );

    // First retry tick fires immediately: bootstrap (call 1) fails, retry tick
    // (call 2) returns the head but localStorage.setItem throws → head NOT advanced.
    await drainAsync();
    assert.ok(
      fetchCallCount >= 2,
      `expected ≥2 fetches after mount, got ${fetchCallCount}`,
    );
    // The write failed so the section should not appear yet.
    assert.ok(
      !result.current.sections.some((s) => s.name === "ShouldPersist"),
      "section appeared despite write failure",
    );

    // Advance to next tick; write now succeeds → same head is retried and applied.
    t.mock.timers.tick(5_000);
    await drainAsync();
    assert.ok(
      result.current.sections.some((s) => s.name === "ShouldPersist"),
      "section not applied after write recovered",
    );

    unmount();
  } finally {
    cleanup();
    t.mock.timers.reset();
    StorageProto.setItem = origSetItem;
    restoreTauri();
    relayClient.fetchEvents = origFetch;
    relayClient.subscribeLive = origSubscribeLive;
    relayClient.subscribeToReconnects = origSubscribeToReconnects;
  }
});
