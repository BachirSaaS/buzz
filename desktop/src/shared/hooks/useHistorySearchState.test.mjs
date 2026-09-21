import assert from "node:assert/strict";
import { test } from "node:test";
import { JSDOM } from "jsdom";

test("search consumers render only for their own keys; local windows ignore URL navigation", async () => {
  // The router's Node export otherwise forces server mode (no subscriptions).
  const nodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "test";
  const dom = new JSDOM("<!doctype html><body></body>", {
    url: "http://localhost",
  });
  const originals = Object.getOwnPropertyDescriptors(globalThis);
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    self: dom.window,
    history: dom.window.history,
    addEventListener: dom.window.addEventListener.bind(dom.window),
    removeEventListener: dom.window.removeEventListener.bind(dom.window),
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  const React = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { createRouter, createRootRoute, createMemoryHistory, RouterProvider } =
    await import("@tanstack/react-router");
  const { useHistorySearchState } = await import("./useHistorySearchState.ts");
  const { LocalHistorySearchProvider } = await import(
    "./LocalHistorySearchProvider.tsx"
  );
  const counts = { thread: 0, profile: 0, local: 0 };
  const hooks = {};
  const Probe = React.memo(function Probe({ name, keys }) {
    hooks[name] = useHistorySearchState(keys);
    counts[name]++;
    return null;
  });
  const rootRoute = createRootRoute({
    validateSearch: (search) => search,
    component: () =>
      React.createElement(
        React.Fragment,
        null,
        React.createElement(Probe, { name: "thread", keys: ["thread"] }),
        React.createElement(Probe, { name: "profile", keys: ["profile"] }),
        React.createElement(
          LocalHistorySearchProvider,
          null,
          React.createElement(Probe, { name: "local", keys: ["thread"] }),
        ),
      ),
  });
  const history = createMemoryHistory({ initialEntries: ["/?thread=first"] });
  const router = createRouter({ routeTree: rootRoute, history });
  const root = createRoot(
    document.body.appendChild(document.createElement("div")),
  );
  try {
    await router.load();
    await React.act(async () =>
      root.render(React.createElement(RouterProvider, { router })),
    );
    const before = { ...counts };
    const threadValues = hooks.thread.values;
    await React.act(async () =>
      router.navigate({
        to: "/",
        search: { thread: "first", profile: "alice" },
      }),
    );
    assert.equal(
      counts.thread,
      before.thread,
      "unrelated keys must not rerender thread consumers",
    );
    assert.equal(
      counts.local,
      before.local,
      "URL changes must not wake local windows",
    );
    assert.equal(hooks.thread.values, threadValues);
    assert.equal(hooks.profile.values.profile, "alice");
    assert.equal(hooks.local.values.thread, null);
    await React.act(async () => {
      hooks.local.applyPatch({ thread: "local", profile: "ignored" });
    });
    assert.equal(hooks.local.values.thread, "local");
    assert.equal(router.state.location.search.thread, "first");
    const localRenders = counts.local;
    const index = history.location.state.__TSR_index;
    await React.act(async () => {
      hooks.thread.applyPatch({ thread: "second" });
      hooks.thread.applyPatch({ thread: "third" });
    });
    assert.equal(hooks.thread.values.thread, "third");
    assert.equal(router.state.location.search.profile, "alice");
    assert.equal(
      history.location.state.__TSR_index,
      index + 1,
      "one action produces one history entry",
    );
    assert.equal(counts.local, localRenders);
    await React.act(async () => history.back());
    assert.equal(hooks.thread.values.thread, "first");
    assert.equal(hooks.local.values.thread, "local");
  } finally {
    await React.act(async () => root.unmount());
    dom.window.close();
    if (nodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = nodeEnv;
    for (const key of [
      "window",
      "document",
      "self",
      "history",
      "addEventListener",
      "removeEventListener",
      "IS_REACT_ACT_ENVIRONMENT",
    ]) {
      if (originals[key])
        Object.defineProperty(globalThis, key, originals[key]);
      else delete globalThis[key];
    }
  }
});
