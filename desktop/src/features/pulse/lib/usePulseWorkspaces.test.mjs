import assert from "node:assert/strict";
import { test } from "node:test";
import { JSDOM } from "jsdom";

test("workspace saves retain unchanged window identities without sharing across scopes", async () => {
  const dom = new JSDOM("<!doctype html><body></body>", {
    url: "http://localhost",
  });
  const originals = Object.getOwnPropertyDescriptors(globalThis);
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    localStorage: dom.window.localStorage,
    Event: dom.window.Event,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  const React = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { usePulseWorkspaces } = await import("./usePulseWorkspaces.ts");
  const { parseWorkspaces, WORKSPACE_ROUTE_KEYS } = await import(
    "./pulseWorkspaces.ts"
  );
  const values = Object.fromEntries(
    WORKSPACE_ROUTE_KEYS.map((key) => [key, null]),
  );
  Object.assign(values, { workspace: "messages", feed: "conversation" });
  const seed = parseWorkspaces(null);
  seed.items.find((item) => item.id === "messages").canvas = {
    layout: "freeform",
    windows: ["app:messages"],
    routes: {
      "app:messages": { feed: "conversation", conversation: "general" },
    },
  };
  for (const scope of ["one", "two"])
    localStorage.setItem(`buzz-workspaces.v1:${scope}`, JSON.stringify(seed));
  let latest;
  function Probe({ scope }) {
    latest = usePulseWorkspaces(scope, values, () => {}, false);
    return null;
  }
  const root = createRoot(
    document.body.appendChild(document.createElement("div")),
  );
  const render = (scope) =>
    React.act(async () => root.render(React.createElement(Probe, { scope })));
  try {
    await render("one");
    const home = latest.items[0];
    const route = latest.active.canvas.routes["app:messages"];
    const windows = latest.active.canvas.windows;
    await React.act(async () => {
      assert.equal(
        latest.saveCanvas({ ...latest.active.canvas, layout: "columns" }),
        true,
      );
    });
    assert.equal(latest.active.canvas.routes["app:messages"], route);
    assert.equal(latest.active.canvas.windows, windows);
    assert.equal(latest.items[0], home);
    await React.act(async () => {
      latest.saveCanvas({
        ...latest.active.canvas,
        routes: { "app:messages": { feed: "search" } },
      });
    });
    assert.notEqual(latest.active.canvas.routes["app:messages"], route);
    assert.equal(latest.active.canvas.routes["app:messages"].feed, "search");
    const staleSave = latest.saveCanvas;
    await React.act(async () => latest.select("home"));
    Object.assign(values, { workspace: "home", feed: "home" });
    await render("one");
    await React.act(async () => {
      assert.equal(staleSave({ layout: "freeform", windows: [] }), false);
      assert.equal(
        latest.saveCanvas({ ...latest.active.canvas, layout: "grid" }),
        true,
      );
    });
    await React.act(async () => latest.select("messages"));
    Object.assign(values, { workspace: "messages", feed: "conversation" });
    await render("one");
    assert.equal(latest.active.canvas.layout, "columns");
    assert.equal(
      latest.items.find((item) => item.id === "home").canvas.layout,
      "grid",
    );
    await render("two");
    assert.notEqual(
      latest.items[0],
      home,
      "scope changes must discard retained references",
    );
    assert.notEqual(latest.active.canvas.routes["app:messages"], route);
    assert.equal(
      latest.active.canvas.routes["app:messages"].conversation,
      "general",
    );
    await React.act(async () => {
      latest.saveCanvas({ ...latest.active.canvas, windows: [], routes: {} });
    });
    assert.deepEqual(latest.active.canvas.routes, {});
  } finally {
    await React.act(async () => root.unmount());
    dom.window.close();
    for (const key of [
      "window",
      "document",
      "localStorage",
      "Event",
      "IS_REACT_ACT_ENVIRONMENT",
    ]) {
      if (originals[key])
        Object.defineProperty(globalThis, key, originals[key]);
      else delete globalThis[key];
    }
  }
});
