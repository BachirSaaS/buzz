import assert from "node:assert/strict";
import { test } from "node:test";
import { JSDOM } from "jsdom";

test("split resize previews avoid synchronous layout reads and persist only on completion", async () => {
  const dom = new JSDOM("<!doctype html><body></body>");
  const originals = Object.getOwnPropertyDescriptors(globalThis);
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    ResizeObserver: class {
      observe() {}
      disconnect() {}
    },
    cancelAnimationFrame: () => {},
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  const React = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { usePanelGestures } = await import("./usePanelGestures.ts");
  const { initialLayout, measureLayout } = await import("./panelLayout.ts");
  const stage = document.body.appendChild(document.createElement("div"));
  const panes = ["a", "b"].map((id) => {
    const el = stage.appendChild(document.createElement("div"));
    el.className = "panel-dock-placement";
    return [id, el];
  });
  let flushes = 0,
    captures = false;
  Object.defineProperties(stage, {
    clientWidth: { value: 1000 },
    clientHeight: { value: 700 },
    offsetWidth: {
      get: () => {
        flushes++;
        return 1000;
      },
    },
  });
  stage.setPointerCapture = () => {
    captures = true;
  };
  stage.hasPointerCapture = () => captures;
  stage.releasePointerCapture = () => {
    captures = false;
  };
  const saved = [];
  let gestures, layout;
  function Probe() {
    const [state, setState] = React.useState(() => initialLayout(["a", "b"]));
    layout = state;
    const ref = React.useRef(stage);
    gestures = usePanelGestures(ref, state, (next) => {
      saved.push(next);
      setState(next);
      return true;
    });
    for (const [id, el] of panes) gestures.elements.current.set(id, el);
    return null;
  }
  const root = createRoot(
    document.body.appendChild(document.createElement("div")),
  );
  const pointer = (type, x) =>
    Object.assign(
      new dom.window.MouseEvent(type, {
        clientX: x,
        clientY: 10,
      }),
      { pointerId: 1, isPrimary: true },
    );
  const start = () => {
    const split = measureLayout(layout.root, gestures.bounds, 8).splits[0];
    gestures.separatorProps(split).onPointerDown({
      button: 0,
      isPrimary: true,
      pointerId: 1,
      clientX: 500,
      clientY: 10,
      currentTarget: stage,
      preventDefault() {},
    });
  };
  try {
    await React.act(async () => root.render(React.createElement(Probe)));
    const initialWidth = panes[0][1].style.width;
    flushes = 0;
    await React.act(async () => {
      start();
      for (const x of [510, 520, 530, 540])
        window.dispatchEvent(pointer("pointermove", x));
    });
    assert.notEqual(panes[0][1].style.width, initialWidth);
    assert.equal(
      flushes,
      0,
      "CSS already disables resize transitions; previews must not force layout",
    );
    assert.equal(saved.length, 0);
    await React.act(async () =>
      window.dispatchEvent(pointer("pointerup", 540)),
    );
    assert.equal(saved.length, 1);
    assert.ok(
      flushes > 0,
      "completion still settles transforms before restoring transitions",
    );
    assert.equal(captures, false);
    const committedWidth = panes[0][1].style.width;
    await React.act(async () => {
      start();
      window.dispatchEvent(pointer("pointermove", 570));
      window.dispatchEvent(
        new dom.window.KeyboardEvent("keydown", {
          key: "Escape",
          cancelable: true,
        }),
      );
    });
    assert.equal(panes[0][1].style.width, committedWidth);
    assert.equal(saved.length, 1, "cancelled previews never persist");
    assert.equal(document.body.style.cursor, "");
    await React.act(async () => {
      const split = measureLayout(layout.root, gestures.bounds, 8).splits[0];
      gestures
        .separatorProps(split)
        .onKeyDown({ key: "ArrowRight", shiftKey: true, preventDefault() {} });
    });
    assert.equal(saved.length, 2, "keyboard resize still commits atomically");
    assert.notEqual(panes[0][1].style.width, committedWidth);
  } finally {
    await React.act(async () => root.unmount());
    dom.window.close();
    for (const key of [
      "window",
      "document",
      "ResizeObserver",
      "cancelAnimationFrame",
      "IS_REACT_ACT_ENVIRONMENT",
    ]) {
      if (originals[key])
        Object.defineProperty(globalThis, key, originals[key]);
      else delete globalThis[key];
    }
  }
});
