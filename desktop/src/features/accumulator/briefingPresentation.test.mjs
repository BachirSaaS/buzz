import test from "node:test";
import assert from "node:assert/strict";
import { briefingPresentation } from "./briefingPresentation.ts";
const a = "a".repeat(64);
const b = "b".repeat(64);

test("each explicit takeaway keeps only its own references, including nested content", () => {
  const items = briefingPresentation(
    `1. **Decision:** ship Friday. [event:${a}]\n   - Keep the rollback.\n2. Review Thursday. [event:${b}] [event:${b}]`,
    [a, b],
  );
  assert.equal(items.length, 2);
  assert.equal(items[0].text, "Decision: ship Friday. Keep the rollback.");
  assert.deepEqual(
    items.map((item) => item.sources),
    [[a], [b]],
  );
});
test("prose stays intact and unknown citations never borrow an unrelated input", () => {
  const items = briefingPresentation(
    `A paragraph. [event:${b}]\n\nMore context.`,
    [a],
  );
  assert.equal(items.length, 1);
  assert.deepEqual(items[0].sources, []);
  assert.equal(items[0].unavailable, true);
  assert.equal(items[0].text, "A paragraph. More context.");
});
test("uncited and malformed inputs do not become evidence", () => {
  const items = briefingPresentation(
    "- A takeaway without citations.\n- Unknown. [event:bad]",
    [a, "bad"],
  );
  assert.deepEqual(
    items.map((item) => item.sources),
    [[], []],
  );
  assert.deepEqual(
    items.map((item) => item.unavailable),
    [false, true],
  );
});
