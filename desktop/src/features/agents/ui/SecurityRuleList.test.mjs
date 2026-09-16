import assert from "node:assert/strict";
import { after, afterEach, before, test } from "node:test";
import { JSDOM } from "jsdom";
import { SecurityRuleList } from "./SecurityRuleList.tsx";
const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "http://localhost",
});
before(() =>
  Object.assign(globalThis, {
    document: dom.window.document,
    HTMLElement: dom.window.HTMLElement,
    IS_REACT_ACT_ENVIRONMENT: true,
    window: dom.window,
    requestAnimationFrame: () => 0,
  }),
);
afterEach(async () => (await import("@testing-library/react")).cleanup());
after(() => dom.window.close());

test("Enter adds a draft rule without submitting; remove edits only the controlled list", async () => {
  const { render, fireEvent } = await import("@testing-library/react");
  const React = await import("react");
  const edits = [];
  const props = {
    label: "Allowed domains",
    description: "Only these hosts",
    values: ["api.example.com"],
    onChange: (value) => edits.push(value),
    disabled: false,
    placeholder: "example.com",
    addLabel: "Add domain",
  };
  const view = render(React.createElement(SecurityRuleList, props));
  const prevented = !fireEvent.keyDown(view.getByRole("textbox"), {
    key: "Enter",
    cancelable: true,
  });
  assert.equal(prevented, true);
  assert.deepEqual(edits, [["api.example.com", ""]]);
  assert.equal(view.getAllByRole("textbox").length, 1, "parent owns the draft");
  view.rerender(
    React.createElement(SecurityRuleList, { ...props, values: edits[0] }),
  );
  fireEvent.keyDown(view.getAllByRole("textbox")[1], { key: "Enter" });
  assert.equal(edits.length, 1, "empty Enter never adds more blank rows");
  fireEvent.click(
    view.getByRole("button", { name: "Remove allowed domains 1" }),
  );
  assert.deepEqual(edits[1], [""]);
});
