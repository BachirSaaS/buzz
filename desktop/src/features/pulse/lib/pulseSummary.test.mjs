import assert from "node:assert/strict";
import { test } from "node:test";
import { buildSummaryInput, parsePulseSummary } from "./pulseSummary.ts";
const now = 1_800_000_000;
const reads = { isThreadMuted: () => false, isFollowingThread: () => false };
const item = (id, extra = {}) => ({
  id,
  rootId: id,
  latestAt: now,
  channel: { id: "dm", name: "Alice", channelType: "dm" },
  messages: [
    {
      id,
      pubkey: "alice",
      author: "Alice",
      body: "Can you review the layout?",
      createdAt: now,
    },
  ],
  ...extra,
});

test("summary context joins sequential DM messages so later answers can resolve questions", () => {
  const input = buildSummaryInput(
    [
      item("question"),
      item("answer", {
        messages: [
          {
            id: "answer",
            pubkey: "me",
            author: "You",
            body: "Yes, approved.",
            createdAt: now + 1,
          },
        ],
      }),
    ],
    "me",
    reads,
    "scope",
    now,
  );
  assert.equal(input.conversations[0].messages.length, 2);
  assert.equal(input.conversations[0].messages[1].isViewer, true);
  assert.equal(input.conversations[0].messages[1].author, "You");
  assert.equal(input.conversations[0].messages[1].body, "Yes, approved.");
});
test("viewer identity uses keys, carries profile aliases, and does not claim namesakes", () => {
  const mine = item("mine", {
    messages: [
      {
        id: "mine",
        pubkey: " ME ",
        author: "Arjun",
        body: "I shipped it",
        createdAt: now,
      },
    ],
  });
  const namesake = item("namesake", {
    messages: [
      {
        id: "namesake",
        pubkey: "someone-else",
        author: "Arjun",
        body: "I reviewed it",
        createdAt: now + 1,
      },
    ],
  });
  const input = buildSummaryInput(
    [mine, namesake],
    "me",
    reads,
    "scope",
    now,
    "Arjun Mahanti",
  );
  assert.deepEqual(input.viewer, {
    names: ["Arjun Mahanti", "Arjun"],
    addressAs: "you",
  });
  const messages = input.conversations[0].messages;
  assert.equal(messages[0].author, "You");
  assert.equal(messages[0].isViewer, true);
  assert.equal(messages[1].author, "Arjun");
  assert.equal(messages[1].isViewer, false);
  const unknown = buildSummaryInput(
    [
      item("unknown", {
        messages: [
          {
            id: "unknown",
            pubkey: "",
            author: "Unknown",
            body: "hello",
            createdAt: now,
          },
        ],
      }),
    ],
    "",
    reads,
    "scope",
    now,
  );
  assert.equal(unknown.conversations[0].messages[0].isViewer, false);
});
test("summary input bounds channels and context and excludes muted or old activity", () => {
  const input = buildSummaryInput(
    Array.from({ length: 100 }, (_, i) => item(String(i))),
    "me",
    reads,
    "scope",
    now,
  );
  assert.equal(input.conversations.length, 3);
  assert.ok(input.conversations.every((c) => c.messages.length <= 8));
  assert.equal(
    buildSummaryInput(
      [item("old", { latestAt: now - 49 * 3600 })],
      "me",
      reads,
      "scope",
      now,
    ).conversations.length,
    0,
  );
  assert.equal(
    buildSummaryInput(
      [item("muted")],
      "me",
      { ...reads, isThreadMuted: () => true },
      "scope",
      now,
    ).conversations.length,
    0,
  );
});
test("model summaries retain exact sources and reject invented links and malformed output", () => {
  const valid = {
    highlights: [
      {
        summary: "Alice has a question about the layout",
        conversationIds: ["question"],
      },
    ],
  };
  const result = parsePulseSummary(valid, new Set(["question"]));
  assert.equal(result[0].label, valid.highlights[0].summary);
  assert.deepEqual([...result[0].ids], ["question"]);
  for (const value of [
    null,
    {},
    { highlights: [{ summary: "Invented", conversationIds: ["missing"] }] },
    { highlights: [{ summary: "", conversationIds: ["question"] }] },
  ]) {
    assert.throws(() => parsePulseSummary(value, new Set(["question"])));
  }
});

test("briefing accepts ten grounded highlights and rejects overflow", () => {
  const highlights = Array.from({ length: 11 }, (_, i) => ({
    summary: `Person ${i} has an update on their project`,
    conversationIds: [`source-${i}`],
  }));
  const allowed = new Set(highlights.flatMap((item) => item.conversationIds));
  assert.equal(
    parsePulseSummary({ highlights: highlights.slice(0, 10) }, allowed).length,
    10,
  );
  assert.throws(() => parsePulseSummary({ highlights }, allowed));
});

test("summary evidence must come from its exact channel and conversations", () => {
  const sources = new Map([
    ["m1", "c1"],
    ["m2", "c2"],
  ]);
  const channels = new Map([
    ["c1", "dm"],
    ["c2", "public"],
  ]);
  const allowed = new Set(channels.keys());
  const parse = (conversationIds, messageIds) =>
    parsePulseSummary(
      {
        highlights: [
          { summary: "A grounded recap", conversationIds, messageIds },
        ],
      },
      allowed,
      sources,
      channels,
    );
  assert.deepEqual(parse(["c1"], ["m1"])[0].evidenceIds, ["m1"]);
  assert.throws(() => parse(["c1"], ["m2"]));
  assert.throws(() => parse(["c1"], ["invented"]));
  assert.throws(() => parse(["c1"], ["m1", "m1"]));
  assert.throws(() => parse(["c1", "c2"], ["m1", "m2"]));
  assert.equal(
    buildSummaryInput(
      [item("note", { channel: undefined })],
      "me",
      reads,
      "scope",
      now,
    ).conversations.length,
    0,
  );
});
