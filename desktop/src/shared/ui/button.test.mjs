import assert from "node:assert/strict";
import { after, afterEach, test } from "node:test";
import { JSDOM } from "jsdom";
const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "http://localhost",
});
Object.assign(globalThis, {
  window: dom.window,
  document: dom.window.document,
  HTMLElement: dom.window.HTMLElement,
  Element: dom.window.Element,
  Node: dom.window.Node,
  IS_REACT_ACT_ENVIRONMENT: true,
});
const { createElement: h } = await import("react");
const { render, fireEvent, cleanup } = await import("@testing-library/react");
const { Button } = await import("./button.tsx");
afterEach(cleanup);
after(() => dom.window.close());

test("loading retains the action name and blocks duplicate submits until ready", () => {
  let submits = 0;
  const action = (loading) =>
    h(
      "form",
      {
        onSubmit: (e) => {
          e.preventDefault();
          submits++;
        },
      },
      h(Button, { loading, type: "submit" }, "Create channel"),
    );
  const view = render(action(true));
  const button = view.getByRole("button", { name: "Create channel" });
  fireEvent.click(button);
  fireEvent.keyDown(button, { key: "Enter" });
  fireEvent.keyUp(button, { key: " " });
  assert.equal(submits, 0);
  view.rerender(action(false));
  fireEvent.click(view.getByRole("button", { name: "Create channel" }));
  assert.equal(submits, 1);
});

test("a disabled rendered link cannot invoke child or wrapper activation", () => {
  let clicks = 0;
  const view = render(
    h(
      Button,
      { asChild: true, disabled: true, onClick: () => clicks++ },
      h("a", { href: "#destination", onClick: () => clicks++ }, "Open project"),
    ),
  );
  const link = view.getByText("Open project").closest("a");
  assert.equal(link.getAttribute("aria-disabled"), "true");
  fireEvent.click(link);
  fireEvent.keyDown(link, { key: "Enter" });
  fireEvent.keyUp(link, { key: " " });
  assert.equal(clicks, 0);
});

test("a rendered action remains one control and composes activation once", () => {
  let childClicks = 0;
  let parentClicks = 0;
  const view = render(
    h(
      Button,
      { asChild: true, onClick: () => parentClicks++ },
      h("button", { onClick: () => childClicks++ }, "Save"),
    ),
  );
  assert.equal(view.getAllByRole("button").length, 1);
  fireEvent.click(view.getByRole("button", { name: "Save" }));
  assert.equal(childClicks, 1);
  assert.equal(parentClicks, 1);
});
