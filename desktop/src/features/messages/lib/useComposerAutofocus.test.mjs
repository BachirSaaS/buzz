import assert from "node:assert/strict";
import { after, test } from "node:test";
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "http://localhost",
});
Object.assign(globalThis, {
  document: dom.window.document,
  HTMLElement: dom.window.HTMLElement,
  window: dom.window,
  IS_REACT_ACT_ENVIRONMENT: true,
});
after(() => dom.window.close());

test("a late-mounting composer preserves an open navigation popover's focus", async () => {
  const React = await import("react");
  const { render, cleanup } = await import("@testing-library/react");
  const { useComposerAutofocus } = await import("./useComposerAutofocus.ts");
  const popover = document.createElement("div");
  popover.dataset.slot = "popover-content";
  popover.dataset.state = "open";
  const destination = document.createElement("button");
  destination.textContent = "Open Agents";
  popover.append(destination);
  document.body.append(popover);
  destination.focus();
  let focusCalls = 0;
  const focus = () => {
    focusCalls += 1;
  };
  function Composer({ draft }) {
    useComposerAutofocus(focus, draft, false);
    return null;
  }
  try {
    const view = render(React.createElement(Composer, { draft: "first" }));
    assert.equal(focusCalls, 0);
    assert.equal(document.activeElement, destination);
    popover.remove();
    view.rerender(React.createElement(Composer, { draft: "second" }));
    assert.equal(
      focusCalls,
      1,
      "normal conversation navigation still focuses its composer",
    );
  } finally {
    popover.remove();
    cleanup();
  }
});

test("a late composer keeps keyboard focus on canvas resize controls", async () => {
  const React = await import("react");
  const { render, cleanup } = await import("@testing-library/react");
  const { useComposerAutofocus } = await import("./useComposerAutofocus.ts");
  let focusCalls = 0;
  const focus = () => {
    focusCalls += 1;
  };
  function Composer({ draft }) {
    useComposerAutofocus(focus, draft, false);
    return null;
  }
  const divider = document.createElement("div");
  divider.role = "separator";
  divider.tabIndex = 0;
  document.body.append(divider);
  divider.focus();
  try {
    const view = render(React.createElement(Composer, { draft: "resize" }));
    assert.equal(focusCalls, 0);
    assert.equal(document.activeElement, divider);
    divider.removeAttribute("role");
    divider.dataset.canvasGesture = "resize";
    view.rerender(React.createElement(Composer, { draft: "corner" }));
    assert.equal(focusCalls, 0);
    divider.remove();
    view.rerender(React.createElement(Composer, { draft: "normal" }));
    assert.equal(focusCalls, 1);
  } finally {
    divider.remove();
    cleanup();
  }
});
