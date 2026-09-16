import assert from "node:assert/strict";
import { test } from "node:test";
import { summaryReferences } from "./summaryReferences.ts";
test("model references remain short and map only to supplied source events", () => {
  const input = {
    scope: "private-cache-scope",
    timezone: "UTC",
    conversations: [
      {
        id: "channel:long-event-id",
        channelId: "channel",
        messages: [
          {
            id: "long-message-id",
            conversationId: "channel:long-event-id",
            body: "Original content",
          },
          {
            id: "other-message",
            conversationId: "channel:another-thread",
            body: "More context",
          },
        ],
      },
    ],
  };
  const refs = summaryReferences(input);
  assert.equal(refs.payload.scope, undefined);
  assert.equal(refs.payload.conversations[0].id, "c1");
  assert.equal(refs.payload.conversations[0].messages[0].id, "m1");
  assert.equal(refs.payload.conversations[0].messages[1].conversationId, "c2");
  assert.deepEqual(
    refs.decode({
      highlights: [
        {
          summary: "A recap",
          conversationIds: ["c1", "c2"],
          messageIds: ["m2"],
        },
      ],
    }).highlights[0],
    {
      summary: "A recap",
      conversationIds: ["channel:long-event-id", "channel:another-thread"],
      messageIds: ["other-message"],
    },
  );
  assert.throws(() =>
    refs.decode({ highlights: [{ conversationIds: ["invented"] }] }),
  );
  assert.throws(() =>
    refs.decode({
      highlights: [{ conversationIds: ["c1"], messageIds: ["invented"] }],
    }),
  );
});
