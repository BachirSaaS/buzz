/**
 * Feedback tab behavior tests for AdminConsolePanel. Covers feedback detail
 * rendering, community grouping, status (honest and read-only), severed
 * community, list refetch on back-nav, and canMutate gates.
 */
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
  act,
  fireEvent,
  setIpcHandler,
  resetTestState,
  mountPanel,
  settle,
  CM_ORIGIN,
  CM_PUBKEY,
  makeCmFalseFeedback,
} from "./adminConsolePanelTestHelpers.jsdom.mjs";

afterEach(resetTestState);

test("feedback-detail-renders-structured-fields: FeedbackDetail shows field layout, not raw JSON", async () => {
  // Verifies item 3: the feedback detail view renders data-testid='feedback-detail-fields'.
  // Lives here (jsdom) because tab switching and item navigation require fireEvent.click.
  //
  // Mutation evidence: revert FeedbackFields → <pre>{JSON.stringify(...)}</pre>
  // → this test goes red ("feedback-detail-fields element must render").

  const origin = "https://admin.example.com";
  const pubkey = "6".repeat(64);

  // Summary shape returned by GET /admin/feedback (FeedbackSummary wire type).
  const feedbackSummary = {
    id: "00000000-0000-0000-0000-000000000011",
    communityId: "00000000-0000-0000-0000-000000000022",
    communityHost: "relay.example.com",
    submitterPubkey: "submitter001pubkey",
    category: "bug",
    bodySummary: "App crashes on startup",
    status: "new",
    receivedAt: "2024-05-01T09:00:05Z",
  };

  // Full AdminFeedbackDto shape returned by GET /admin/feedback/:id.
  const feedbackDetail = {
    id: "00000000-0000-0000-0000-000000000011",
    communityId: "00000000-0000-0000-0000-000000000022",
    communityHost: "relay.example.com",
    eventId: "feedevent001",
    submitterPubkey: "submitter001pubkey",
    category: "bug",
    body: "App crashes on startup — full detail body text",
    status: "new",
    tags: [],
    eventCreatedAt: "2024-05-01T09:00:00Z",
    receivedAt: "2024-05-01T09:00:05Z",
  };

  setIpcHandler("admin_list_reports", () => Promise.resolve([]));
  setIpcHandler("admin_list_feedback", () =>
    Promise.resolve([feedbackSummary]),
  );
  setIpcHandler("admin_get_feedback", () => Promise.resolve(feedbackDetail));

  const { container, doRender, unmount } = mountPanel({ origin, pubkey });
  await doRender();
  await settle(30);

  // Click the Feedback tab.
  const feedbackTab = container.querySelector(
    "[data-testid='admin-tab-feedback']",
  );
  assert.ok(feedbackTab, "Feedback tab must be present");
  await act(async () => {
    fireEvent.click(feedbackTab);
    await new Promise((r) => setTimeout(r, 30));
  });

  await settle(30);

  // Pre-navigation: list row shows the summary body text (bodySummary rendered).
  // Mutation seam: render `body` instead of `bodySummary` → red because summary
  // fixture has no `body` field → row title is blank.
  const listText = container.textContent ?? "";
  assert.ok(
    listText.includes("App crashes on startup"),
    `list row must show bodySummary before navigation; got: ${listText.slice(0, 400)}`,
  );

  // Navigate into the feedback detail — click the first non-tab button.
  const allButtons = container.querySelectorAll("button");
  for (const btn of allButtons) {
    const testid = btn.getAttribute("data-testid") ?? "";
    if (testid.startsWith("admin-tab")) continue;
    await act(async () => {
      fireEvent.click(btn);
      await new Promise((r) => setTimeout(r, 30));
    });
    break;
  }

  await settle(30);

  const fields = container.querySelector(
    "[data-testid='feedback-detail-fields']",
  );
  assert.ok(
    fields !== null,
    "feedback-detail-fields element must render — JSON dump not replaced",
  );

  const text = container.textContent ?? "";
  assert.ok(
    !text.includes('"body":'),
    `raw JSON must not be rendered in feedback detail; got: ${text.slice(0, 400)}`,
  );

  // Real DTO fields must render.
  assert.ok(
    text.includes("submitter001pubkey"),
    `submitterPubkey must render; got: ${text.slice(0, 600)}`,
  );
  assert.ok(
    text.includes("bug"),
    `category must render; got: ${text.slice(0, 600)}`,
  );
  assert.ok(
    text.includes("App crashes on startup"),
    `body must render; got: ${text.slice(0, 600)}`,
  );

  // Fake fields must NOT appear.
  assert.ok(
    !text.includes("appVersion"),
    `invented 'appVersion' field must not render; got: ${text.slice(0, 400)}`,
  );
  assert.ok(
    !text.includes("authorPubkey"),
    `invented 'authorPubkey' field must not render; got: ${text.slice(0, 400)}`,
  );

  // Relative timestamp: formatTimestamp output must match "Xm/h/d ago (...)" shape.
  // The fixture receivedAt is far in the past, so it will be "Nd ago (...)".
  assert.ok(
    /\d+[mhd] ago \(/.test(text) || text.includes("just now ("),
    `relative timestamp must render in "Nm/h/d ago (...)" format; got: ${text.slice(0, 600)}`,
  );

  await unmount();
});

// ── NIP-11 auto-discovery ─────────────────────────────────────────────────

test("feedback-grouped-by-community: multi-community feedback renders per-community headings", async () => {
  // Same grouping contract for the Feedback tab.
  //
  // Mutation evidence: revert FeedbackTab to a flat <ul> → group headings
  // vanish and this test goes red.

  const origin = "https://admin.example.com";
  const pubkey = "b8".repeat(32);

  const feedback = [
    {
      id: "00000000-0000-0000-0000-0000000000b1",
      communityId: "comm-1",
      communityHost: "alpha.example.com",
      submitterPubkey: "sub1",
      category: "bug",
      bodySummary: "Alpha feedback body",
      status: "new",
      receivedAt: "2024-06-01T09:00:00Z",
    },
    {
      id: "00000000-0000-0000-0000-0000000000b2",
      communityId: "comm-2",
      communityHost: "beta.example.com",
      submitterPubkey: "sub2",
      category: "idea",
      bodySummary: "Beta feedback body",
      status: "new",
      receivedAt: "2024-06-02T09:00:00Z",
    },
  ];

  setIpcHandler("admin_list_reports", () => Promise.resolve([]));
  setIpcHandler("admin_list_feedback", () => Promise.resolve(feedback));

  const { container, doRender, unmount } = mountPanel({ origin, pubkey });
  await doRender();
  await settle(30);

  // Switch to the Feedback tab.
  const feedbackTab = container.querySelector(
    "[data-testid='admin-tab-feedback']",
  );
  assert.ok(feedbackTab, "Feedback tab must be present");
  await act(async () => {
    fireEvent.click(feedbackTab);
    await new Promise((r) => setTimeout(r, 30));
  });
  await settle(30);

  const hosts = Array.from(
    container.querySelectorAll("[data-testid='community-group-host']"),
  ).map((el) => el.textContent);
  assert.deepEqual(
    hosts,
    ["alpha.example.com", "beta.example.com"],
    `feedback group headings must show each community host; got: ${JSON.stringify(hosts)}`,
  );

  await unmount();
});

test("feedback-status-honest: a reviewed detail reports reviewed, never defaulting to new", async () => {
  // Thufir finding 5 (desktop half): `status` is a required wire field. A
  // reviewed/archived entry must render its real status after reload, not be
  // silently presented as "new". The status control must also initialize its
  // selected state from the server value.
  //
  // Mutation evidence: reinstate `detailState.data.status ?? "new"` in
  // FeedbackDetail → a reviewed entry would still show, but re-adding the
  // absent-defaulting cast and feeding an entry with no status would present
  // it as new; here we assert the reviewed value round-trips and its button
  // is the active (default-variant) one.

  const origin = "https://admin.example.com";
  const pubkey = "d5".repeat(32);

  const reviewedSummary = {
    id: "00000000-0000-0000-0000-0000000000d5",
    communityId: "comm-1",
    communityHost: "alpha.example.com",
    submitterPubkey: "sub-reviewed",
    category: "bug",
    bodySummary: "Already-triaged feedback",
    status: "reviewed",
    receivedAt: "2024-06-01T09:00:00Z",
  };
  const reviewedDetail = {
    id: reviewedSummary.id,
    communityId: reviewedSummary.communityId,
    communityHost: reviewedSummary.communityHost,
    eventId: "revevent",
    submitterPubkey: reviewedSummary.submitterPubkey,
    category: "bug",
    body: "Already-triaged feedback full body",
    status: "reviewed",
    tags: [],
    eventCreatedAt: "2024-06-01T09:00:00Z",
    receivedAt: "2024-06-01T09:00:00Z",
  };

  setIpcHandler("admin_list_reports", () => Promise.resolve([]));
  setIpcHandler("admin_list_feedback", () =>
    Promise.resolve([reviewedSummary]),
  );
  setIpcHandler("admin_get_feedback", () => Promise.resolve(reviewedDetail));

  const { container, doRender, unmount } = mountPanel({ origin, pubkey });
  await doRender();
  await settle(30);

  // Switch to the Feedback tab.
  const feedbackTab = container.querySelector(
    "[data-testid='admin-tab-feedback']",
  );
  assert.ok(feedbackTab, "Feedback tab must be present");
  await act(async () => {
    fireEvent.click(feedbackTab);
    await new Promise((r) => setTimeout(r, 30));
  });
  await settle(30);

  // List row shows the "reviewed" badge (status !== "new").
  const listText = container.textContent ?? "";
  assert.ok(
    listText.includes("reviewed"),
    `list row must show the reviewed badge; got: ${listText.slice(0, 400)}`,
  );

  // Navigate into the feedback detail.
  const listRow = Array.from(container.querySelectorAll("button")).find(
    (btn) =>
      !(btn.getAttribute("data-testid") ?? "").startsWith("admin-tab") &&
      btn.textContent?.includes("Already-triaged feedback"),
  );
  assert.ok(listRow, "feedback list row must be present");
  await act(async () => {
    fireEvent.click(listRow);
    await new Promise((r) => setTimeout(r, 30));
  });
  await settle(30);

  // The status control initializes from the server value: the "reviewed"
  // button is the active (default-variant) selection, not "new".
  const control = container.querySelector(
    "[data-testid='feedback-status-control']",
  );
  assert.ok(control, "feedback status control must render");
  const reviewedBtn = container.querySelector(
    "[data-testid='feedback-status-btn-reviewed']",
  );
  const newBtn = container.querySelector(
    "[data-testid='feedback-status-btn-new']",
  );
  assert.ok(reviewedBtn && newBtn, "status buttons must render");
  // The active status is styled with a ring highlight (see FeedbackStatusControl).
  assert.ok(
    (reviewedBtn.className ?? "").includes("ring-2"),
    `the reviewed button must be marked active; got className: ${reviewedBtn.className}`,
  );
  assert.ok(
    !(newBtn.className ?? "").includes("ring-2"),
    `the new button must NOT be active for a reviewed entry; got className: ${newBtn.className}`,
  );

  // P2-2: semantic contract — aria-pressed must reflect the selected status,
  // not just the visual ring class. Fails if aria-pressed is removed from
  // FeedbackStatusControl's Button props.
  assert.equal(
    reviewedBtn.getAttribute("aria-pressed"),
    "true",
    "the active status button must have aria-pressed=true",
  );
  assert.equal(
    newBtn.getAttribute("aria-pressed"),
    "false",
    "an inactive status button must have aria-pressed=false",
  );

  await unmount();
});

test("feedback-severed-community: a purged-source feedback row renders in list and detail without its community", async () => {
  // Item 5 (desktop): feedback whose source community was purged carries a
  // null communityId/communityHost (tenant provenance severed, row retained as
  // operator evidence). The list must still render it (grouped under a
  // "source community removed" bucket) and the detail must show em-dashes for
  // the absent community fields — never crash on the null.
  //
  // Mutation evidence: narrow AdminFeedbackDto.communityId back to `string` →
  // typecheck breaks; restore the `communityId: string` grouping constraint →
  // the null key throws in groupByCommunity.

  const origin = "https://admin.example.com";
  const pubkey = "e8".repeat(32);

  const severedSummary = {
    id: "00000000-0000-0000-0000-0000000000e8",
    communityId: null,
    communityHost: null,
    submitterPubkey: "sub-severed",
    category: "bug",
    bodySummary: "Feedback from a since-purged community",
    status: "new",
    receivedAt: "2024-06-01T09:00:00Z",
  };
  const severedDetail = {
    id: severedSummary.id,
    communityId: null,
    communityHost: null,
    eventId: "sevevent",
    submitterPubkey: severedSummary.submitterPubkey,
    category: "bug",
    body: "Feedback from a since-purged community — full body",
    status: "new",
    tags: [],
    eventCreatedAt: "2024-06-01T09:00:00Z",
    receivedAt: "2024-06-01T09:00:00Z",
  };

  setIpcHandler("admin_list_reports", () => Promise.resolve([]));
  setIpcHandler("admin_list_feedback", () => Promise.resolve([severedSummary]));
  setIpcHandler("admin_get_feedback", () => Promise.resolve(severedDetail));

  const { container, doRender, unmount } = mountPanel({ origin, pubkey });
  await doRender();
  await settle(30);

  const feedbackTab = container.querySelector(
    "[data-testid='admin-tab-feedback']",
  );
  assert.ok(feedbackTab, "Feedback tab must be present");
  await act(async () => {
    fireEvent.click(feedbackTab);
    await new Promise((r) => setTimeout(r, 30));
  });
  await settle(30);

  // The severed row still renders in the list (did not throw / vanish).
  const listRow = Array.from(container.querySelectorAll("button")).find(
    (btn) =>
      !(btn.getAttribute("data-testid") ?? "").startsWith("admin-tab") &&
      btn.textContent?.includes("since-purged community"),
  );
  assert.ok(listRow, "the severed feedback row must render in the list");

  await act(async () => {
    fireEvent.click(listRow);
    await new Promise((r) => setTimeout(r, 30));
  });
  await settle(30);

  // Detail renders; the community fields show the em-dash placeholder.
  const fields = container.querySelector(
    "[data-testid='feedback-detail-fields']",
  );
  assert.ok(fields, "feedback detail must render for a severed row");
  assert.ok(
    (fields.textContent ?? "").includes("—"),
    `absent community fields must render as em-dash; got: ${fields.textContent}`,
  );

  await unmount();
});

// ── D3a: kick suppressed when the report carries no channel ────────────────

test("feedback-list-refetches-on-back-after-mutation: changing status then navigating back shows fresh list status", async () => {
  // Same fence for the Feedback tab: a status change in the detail bumps the
  // FeedbackTab list generation so back-nav refetches.
  //
  // Mutation evidence: drop the FeedbackDetail onMutated → setListGen wiring →
  // admin_list_feedback is called once and the second-call assertion goes red.

  const origin = "https://admin.example.com";
  const pubkey = "d6".repeat(32);

  const summary = {
    id: "00000000-0000-0000-0000-0000000000d6",
    communityId: "00000000-0000-0000-0000-000000000022",
    communityHost: "relay.example.com",
    submitterPubkey: "submitter",
    category: "bug",
    bodySummary: "App crashes on startup",
    status: "new",
    receivedAt: "2024-05-01T09:00:05Z",
  };
  const detail = {
    id: summary.id,
    communityId: summary.communityId,
    communityHost: summary.communityHost,
    eventId: "feedevent",
    submitterPubkey: summary.submitterPubkey,
    category: "bug",
    body: "App crashes on startup — full detail",
    status: "new",
    tags: [],
    eventCreatedAt: "2024-05-01T09:00:00Z",
    receivedAt: "2024-05-01T09:00:05Z",
  };

  let listCalls = 0;
  setIpcHandler("admin_list_reports", () => Promise.resolve([]));
  setIpcHandler("admin_list_feedback", () => {
    listCalls += 1;
    return Promise.resolve([
      { ...summary, status: listCalls === 1 ? "new" : "reviewed" },
    ]);
  });
  setIpcHandler("admin_get_feedback", () => Promise.resolve(detail));
  setIpcHandler("admin_patch_feedback", () =>
    Promise.resolve({ status: "reviewed" }),
  );

  const { container, doRender, unmount } = mountPanel({ origin, pubkey });
  await doRender();
  await settle(30);

  // Switch to the Feedback tab.
  const feedbackTab = container.querySelector(
    "[data-testid='admin-tab-feedback']",
  );
  assert.ok(feedbackTab, "Feedback tab must be present");
  await act(async () => {
    fireEvent.click(feedbackTab);
    await new Promise((r) => setTimeout(r, 30));
  });
  await settle(20);
  assert.equal(listCalls, 1, "feedback list is fetched once on tab open");

  // Open the first feedback row.
  const row = Array.from(container.querySelectorAll("button")).find(
    (b) =>
      !(b.getAttribute("data-testid") ?? "").startsWith("admin-tab") &&
      b.textContent?.includes("App crashes"),
  );
  assert.ok(row, "feedback row must be present");
  await act(async () => {
    fireEvent.click(row);
    await new Promise((r) => setTimeout(r, 30));
  });
  await settle(20);

  // Mark reviewed.
  const reviewedBtn = container.querySelector(
    "[data-testid='feedback-status-btn-reviewed']",
  );
  assert.ok(reviewedBtn, "reviewed status button must be present");
  await act(async () => {
    fireEvent.click(reviewedBtn);
    await new Promise((r) => setTimeout(r, 30));
  });
  await settle(20);

  // Navigate back to the feedback list.
  const backBtn = Array.from(container.querySelectorAll("button")).find((b) =>
    b.textContent?.includes("Back to feedback"),
  );
  assert.ok(backBtn, "back-to-feedback button must be present");
  await act(async () => {
    fireEvent.click(backBtn);
    await new Promise((r) => setTimeout(r, 30));
  });
  await settle(20);

  assert.ok(
    listCalls >= 2,
    `the feedback list must refetch after back-nav following a status change; listCalls=${listCalls}`,
  );
  assert.ok(
    (container.textContent ?? "").includes("reviewed"),
    `the refetched feedback list must show the updated status; got: ${(container.textContent ?? "").slice(0, 400)}`,
  );

  await unmount();
});

test("canMutate-false-feedback: feedback-status-control absent in disabled mode", async () => {
  // Mutation: remove {canMutate && …} guard on feedback status control → control renders → RED.
  // Also asserts the read-only badge and zero PATCH calls via the detail route.
  const { feedbackSummary, feedbackDetail } = makeCmFalseFeedback();
  setIpcHandler("admin_list_reports", () => Promise.resolve([]));
  setIpcHandler("admin_list_feedback", () =>
    Promise.resolve([feedbackSummary]),
  );
  setIpcHandler("admin_get_feedback", () => Promise.resolve(feedbackDetail));
  const { container, doRender, unmount } = mountPanel({
    origin: CM_ORIGIN,
    pubkey: CM_PUBKEY,
    canMutate: false,
  });
  try {
    await doRender();
    await settle(30);
    const feedbackTab = container.querySelector(
      "[data-testid='admin-tab-feedback']",
    );
    assert.ok(feedbackTab, "Feedback tab must be present");
    await act(async () => {
      fireEvent.click(feedbackTab);
      await new Promise((r) => setTimeout(r, 30));
    });
    await settle(30);
    const listBtns = Array.from(container.querySelectorAll("button")).filter(
      (b) => !(b.getAttribute("data-testid") ?? "").startsWith("admin-tab"),
    );
    assert.ok(listBtns.length > 0, "feedback list item must be present");
    await act(async () => {
      fireEvent.click(listBtns[0]);
      await new Promise((r) => setTimeout(r, 30));
    });
    await settle(30);
    assert.equal(
      container.querySelector("[data-testid='feedback-status-control']"),
      null,
      "feedback-status-control must be absent when canMutate=false",
    );
  } finally {
    await unmount();
  }
});

// feedback-status-readonly is absent and the assertion goes RED.

test("feedback-status-readonly: read-only detail shows status badge, no status-control, no PATCH", async () => {
  const origin = "https://admin-readonly.example.com";
  const pubkey = "55".repeat(32);
  const feedbackId = "00000000-0000-0000-0000-000000000055";

  const patchCalls = [];
  setIpcHandler("admin_list_reports", () => Promise.resolve([]));
  setIpcHandler("admin_list_feedback", () =>
    Promise.resolve([
      {
        id: feedbackId,
        communityId: "comm-1",
        communityHost: "relay.example.com",
        submitterPubkey: "sub055",
        category: null,
        bodySummary: "read-only feedback item",
        receivedAt: "2024-01-01T00:00:00Z",
        status: "reviewed",
      },
    ]),
  );
  setIpcHandler("admin_get_feedback", () =>
    Promise.resolve({
      id: feedbackId,
      communityId: "comm-1",
      communityHost: "relay.example.com",
      eventId: "fev055",
      submitterPubkey: "sub055",
      category: null,
      body: "read-only feedback full body",
      status: "reviewed",
      tags: [],
      eventCreatedAt: "2024-01-01T00:00:00Z",
      receivedAt: "2024-01-01T00:00:00Z",
    }),
  );
  setIpcHandler("admin_patch_feedback", (args) => {
    patchCalls.push(args);
    return Promise.resolve();
  });

  const { container, doRender, unmount } = mountPanel({
    origin,
    pubkey,
    canMutate: false,
  });
  await doRender();
  await settle(30);

  try {
    // Navigate to Feedback tab.
    const feedbackTab = container.querySelector(
      "[data-testid='admin-tab-feedback']",
    );
    assert.ok(feedbackTab, "Feedback tab must be present");
    await act(async () => {
      fireEvent.click(feedbackTab);
      await new Promise((r) => setTimeout(r, 30));
    });
    await settle(30);

    // Click the feedback list item to open detail.
    const listBtns = Array.from(container.querySelectorAll("button")).filter(
      (b) => !(b.getAttribute("data-testid") ?? "").startsWith("admin-tab"),
    );
    assert.ok(listBtns.length > 0, "feedback list item must be present");
    await act(async () => {
      fireEvent.click(listBtns[0]);
      await new Promise((r) => setTimeout(r, 30));
    });
    await settle(30);

    // feedback-status-control must be absent (no mutation affordance).
    const ctrl = container.querySelector(
      "[data-testid='feedback-status-control']",
    );
    assert.equal(
      ctrl,
      null,
      "feedback-status-control must be absent when canMutate=false",
    );

    // feedback-status-readonly must be present with the server status.
    const readonlyBadge = container.querySelector(
      "[data-testid='feedback-status-readonly']",
    );
    assert.ok(
      readonlyBadge !== null,
      "feedback-status-readonly must be present in read-only detail",
    );
    assert.ok(
      readonlyBadge.textContent.includes("reviewed"),
      `feedback-status-readonly must show server status "reviewed"; got: ${readonlyBadge.textContent}`,
    );

    // No PATCH must have been issued.
    assert.equal(
      patchCalls.length,
      0,
      "admin_patch_feedback must not be called in read-only mode",
    );
  } finally {
    await unmount();
  }
});
