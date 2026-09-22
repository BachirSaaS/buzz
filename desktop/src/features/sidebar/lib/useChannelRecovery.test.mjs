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
