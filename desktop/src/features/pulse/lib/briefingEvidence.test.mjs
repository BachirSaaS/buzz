import assert from "node:assert/strict";
import { test } from "node:test";
import { selectBriefingEvidence } from "./briefingEvidence.ts";
test("evidence uses original messages, prefers artifacts, and stays bounded", () => {
  const messages = [
    { id: "hello", body: "hey!", createdAt: 10 },
    { id: "repo", body: "https://github.com/block/buzz", createdAt: 2 },
    { id: "image", body: "https://example.com/design.png", createdAt: 3 },
    {
      id: "text",
      body: "A detailed review of the project that provides useful context about the work",
      createdAt: 4,
    },
    {
      id: "pending",
      body: "https://github.com/private/pending",
      createdAt: 5,
      pending: true,
    },
  ];
  const conversations = new Map([["thread", { messages }]]);
  const group = { ids: new Set(["thread"]) };
  assert.deepEqual(
    selectBriefingEvidence(group, conversations).map(
      ({ message }) => message.id,
    ),
    ["repo", "image"],
  );
  const evidence = selectBriefingEvidence(
    { ...group, evidenceIds: ["text"] },
    conversations,
  );
  assert.equal(evidence[0].message, messages[3]);
  assert.deepEqual(
    selectBriefingEvidence(
      { ...group, evidenceIds: ["missing", "pending"] },
      conversations,
    ),
    [],
  );
});
