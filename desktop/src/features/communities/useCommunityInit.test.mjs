import assert from "node:assert/strict";
import { after, before, mock, test } from "node:test";

import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "http://localhost",
});

before(() => {
  Object.assign(globalThis, {
    document: dom.window.document,
    HTMLElement: dom.window.HTMLElement,
    IS_REACT_ACT_ENVIRONMENT: true,
    localStorage: dom.window.localStorage,
    window: dom.window,
  });
});

after(() => dom.window.close());

function installTauriInvoke(handler) {
  const previous = globalThis.window.__TAURI_INTERNALS__;
  globalThis.window.__TAURI_INTERNALS__ = { invoke: handler };
  return () => {
    if (previous === undefined) delete globalThis.window.__TAURI_INTERNALS__;
    else globalThis.window.__TAURI_INTERNALS__ = previous;
  };
}

function testCommunity() {
  return {
    id: "community-1",
    name: "Enterprise",
    relayUrl: "wss://enterprise.example",
    token: "token-1",
    reposDir: "/tmp/buzz-repos",
    addedAt: "2026-09-17T00:00:00.000Z",
  };
}

test("useCommunityInit gates enterprise login before applying the community", async () => {
  const { cleanup, renderHook, waitFor } = await import(
    "@testing-library/react"
  );
  const { useCommunityInit } = await import("./useCommunityInit.ts");
  const calls = [];
  const restore = installTauriInvoke(async (command, args) => {
    calls.push([command, args]);
    if (command === "get_identity") {
      return { pubkey: "pubkey-1", display_name: "Tester" };
    }
    if (command === "enterprise_login_gate") {
      return { status: "notRequired" };
    }
    if (command === "apply_workspace") {
      return null;
    }
    throw new Error(`unexpected command: ${command}`);
  });

  try {
    const community = testCommunity();
    const hook = renderHook(() =>
      useCommunityInit(community, "community-key", false, true),
    );

    await waitFor(() => assert.equal(hook.result.current.isReady, true));

    assert.deepEqual(
      calls.map(([command]) => command),
      ["get_identity", "enterprise_login_gate", "apply_workspace"],
    );
    assert.deepEqual(calls[1], [
      "enterprise_login_gate",
      { relayUrl: community.relayUrl },
    ]);
    assert.deepEqual(calls[2], [
      "apply_workspace",
      {
        relayUrl: community.relayUrl,
        nsec: null,
        token: community.token,
        reposDir: community.reposDir,
        agentManagedProfiles: false,
      },
    ]);
    hook.unmount();
  } finally {
    restore();
    cleanup();
    mock.reset();
  }
});

test("useCommunityInit blocks community apply when enterprise login gate fails", async () => {
  const { cleanup, renderHook, waitFor } = await import(
    "@testing-library/react"
  );
  const { useCommunityInit } = await import("./useCommunityInit.ts");
  const consoleError = mock.method(console, "error", () => {});
  const calls = [];
  const restore = installTauriInvoke(async (command, args) => {
    calls.push([command, args]);
    if (command === "get_identity") {
      return { pubkey: "pubkey-1", display_name: "Tester" };
    }
    if (command === "enterprise_login_gate") {
      throw new Error("enterprise login unavailable");
    }
    if (command === "apply_workspace") {
      throw new Error("apply_workspace must not run");
    }
    throw new Error(`unexpected command: ${command}`);
  });

  try {
    const hook = renderHook(() =>
      useCommunityInit(testCommunity(), "community-key", false, true),
    );

    await waitFor(() =>
      assert.equal(hook.result.current.error, "enterprise login unavailable"),
    );

    assert.deepEqual(
      calls.map(([command]) => command),
      ["get_identity", "enterprise_login_gate"],
    );
    assert.equal(consoleError.mock.calls.length, 1);
    hook.unmount();
  } finally {
    restore();
    cleanup();
    mock.reset();
  }
});
