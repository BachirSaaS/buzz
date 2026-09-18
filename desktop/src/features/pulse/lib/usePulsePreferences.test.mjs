import { test } from "node:test";
import assert from "node:assert/strict";
import { parsePulsePreferences } from "./usePulsePreferences.ts";

test("pins and filters restore without persisting chat content", () => {
  assert.deepEqual(
    parsePulsePreferences(
      JSON.stringify({
        pinnedDms: ["alice", "alice", "bob"],
        excludedSources: ["general"],
        includeNotes: false,
        messages: ["not preferences"],
      }),
    ),
    {
      pinnedDms: ["alice", "bob"],
      excludedSources: ["general"],
      includeNotes: false,
    },
  );
});
test("malformed preference records recover and every persisted list is bounded", () => {
  assert.deepEqual(parsePulsePreferences("not-json"), {
    pinnedDms: [],
    excludedSources: [],
    includeNotes: true,
  });
  const parsed = parsePulsePreferences(
    JSON.stringify({
      pinnedDms: [null, "", "x".repeat(513), "a", "b", "c", "d", "e"],
      excludedSources: Array.from({ length: 5001 }, (_, i) => `channel-${i}`),
    }),
  );
  assert.deepEqual(parsed.pinnedDms, ["a", "b", "c", "d"]);
  assert.equal(parsed.excludedSources.length, 5000);
});
