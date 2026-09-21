import assert from "node:assert/strict";
import { test } from "node:test";
import { fetchPulseFeed } from "./fetchPulseFeed.ts";

test("feed reads overlap independent requests with bounded concurrency and stable ordering", async () => {
  let releaseSources, releaseEdits;
  const sources = new Promise((resolve) => {
    releaseSources = resolve;
  });
  const edits = new Promise((resolve) => {
    releaseEdits = resolve;
  });
  let active = 0,
    peak = 0,
    sourceCalls = 0,
    editCalls = 0,
    retractionCalls = 0;
  const event = (id, channel, kind = 9) => ({
    id,
    kind,
    pubkey: "me",
    content: id,
    created_at: 1,
    sig: "",
    tags: channel ? [["h", channel]] : [],
  });
  const result = fetchPulseFeed(
    ["dm", "channel"],
    ["me"],
    async (filter) => {
      active++;
      peak = Math.max(peak, active);
      try {
        if (filter["#h"] || filter.authors) {
          sourceCalls++;
          await sources;
          const channel = filter["#h"]?.[0];
          return Array.from({ length: channel ? 100 : 50 }, (_, i) =>
            event(`${channel ?? "note"}-${i}`, channel, channel ? 9 : 1),
          );
        }
        if (filter.kinds.includes(40003)) {
          editCalls++;
          await edits;
          return [event(`edit-${filter["#e"][0]}`, "channel", 40003)];
        }
        retractionCalls++;
        assert.equal(filter["#e"].length, 1);
        assert.ok(filter["#e"][0].startsWith("edit-"));
        return [event(`delete-${filter["#e"][0]}`, "channel", 5)];
      } finally {
        active--;
      }
    },
    ["dm"],
  );
  try {
    assert.equal(
      sourceCalls,
      3,
      "a slow DM read must not delay channels or notes",
    );
    assert.equal(editCalls, 0, "structural reads require their source IDs");
    releaseSources();
    await new Promise(setImmediate);
    assert.equal(editCalls, 3, "independent structural batches overlap");
    assert.equal(retractionCalls, 0, "retractions must wait for edit IDs");
  } finally {
    releaseSources();
    releaseEdits();
  }
  const events = await result;
  assert.equal(peak, 3);
  assert.equal(active, 0);
  assert.equal(retractionCalls, 3);
  assert.equal(events.length, 256);
  assert.equal(events[0].id, "dm-0");
  assert.equal(events[100].id, "channel-0");
  assert.equal(events[200].id, "note-0");
  assert.deepEqual(
    events.slice(250).map((entry) => entry.id),
    [
      "edit-dm-0",
      "delete-edit-dm-0",
      "edit-channel-0",
      "delete-edit-channel-0",
      "edit-note-0",
      "delete-edit-note-0",
    ],
  );
});
