/**
 * Staffing tab behavior tests for AdminConsolePanel. Covers operator
 * add/remove/role-change, display-name integration, self-removal callback,
 * dialog confirmation, canMutate gates, and tab reset on role downgrade.
 */
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
  React,
  act,
  fireEvent,
  createRoot,
  QueryClientProvider,
  CommunitiesProvider,
  AdminConsolePanel,
  setIpcHandler,
  resetTestState,
  mutationReject,
  makeQueryClient,
  mountPanel,
  mountStaffingPanel,
  settle,
  CM_ORIGIN,
  CM_PUBKEY,
  CM_OP_PUBKEY,
} from "./adminConsolePanelTestHelpers.jsdom.mjs";

afterEach(resetTestState);

test("canMutate-false-staffing: staffing add/remove absent in disabled mode", async () => {
  // Mutation: remove {canMutate && …} guards on staffing add/remove → buttons render → RED.
  setIpcHandler("admin_list_reports", () => Promise.resolve([]));
  setIpcHandler("admin_list_feedback", () => Promise.resolve([]));
  setIpcHandler("admin_list_operators", () =>
    Promise.resolve([
      { pubkey: CM_OP_PUBKEY, effectiveRole: "moderator", sources: ["db"] },
    ]),
  );
  const { container, doRender, unmount } = mountPanel({
    origin: CM_ORIGIN,
    pubkey: CM_PUBKEY,
    canMutate: false,
    role: "operator",
    initialTab: "staffing",
  });
  try {
    await doRender();
    await settle(30);
    assert.equal(
      container.querySelector("[data-testid='staffing-add-btn']"),
      null,
      "staffing-add-btn must be absent when canMutate=false",
    );
    assert.equal(
      container.querySelector(
        `[data-testid='staffing-remove-btn-${CM_OP_PUBKEY}']`,
      ),
      null,
      "staffing-remove-btn must be absent when canMutate=false",
    );
  } finally {
    await unmount();
  }
});

// ── P1: Staffing remove confirmation dialog ───────────────────────────────────
//
// The trash button must open a confirmation dialog; the delete IPC must not fire
// until the user clicks Confirm. Self-removal shows a distinct warning.
//
// Mutation evidence:
//   - Bypass the dialog (call deleteAdminOperator directly from the button) →
//     the cancel test goes RED (deleteAdminOperator called on trash click).
//   - Remove the AlertDialog open condition → confirm test goes RED (dialog
//     never opens, Confirm button absent).

test("staffing-remove-cancel: trash click opens dialog; cancel does not invoke deleteAdminOperator", async () => {
  const origin = "https://admin-staffing.example.com";
  const pubkey = "aa".repeat(32);
  const opPubkey = "bb".repeat(32);

  const deleteCalls = [];
  setIpcHandler("admin_delete_operator", (args) => {
    deleteCalls.push(args?.pubkey ?? "?");
    return Promise.resolve();
  });

  const { container, doRender, unmount } = mountStaffingPanel(origin, pubkey, [
    { pubkey: opPubkey, effectiveRole: "moderator", sources: ["db"] },
  ]);
  await doRender();
  await settle(30);

  try {
    // Trash click → dialog opens (no delete yet)
    const removeBtn = container.querySelector(
      `[data-testid='staffing-remove-btn-${opPubkey}']`,
    );
    assert.ok(
      removeBtn !== null,
      "remove button must be present before dialog",
    );
    await act(async () => {
      fireEvent.click(removeBtn);
      await new Promise((r) => setTimeout(r, 10));
    });

    // Dialog should be open — content renders in document.body portal
    const dialog = document.body.querySelector(
      "[data-testid='staffing-remove-dialog']",
    );
    assert.ok(
      dialog !== null,
      "confirmation dialog must open after trash click",
    );
    assert.equal(
      deleteCalls.length,
      0,
      "deleteAdminOperator must not fire before confirmation",
    );

    // Click Cancel
    const cancelBtn = document.body.querySelector(
      "[data-testid='staffing-remove-cancel']",
    );
    assert.ok(cancelBtn !== null, "cancel button must be present in dialog");
    await act(async () => {
      fireEvent.click(cancelBtn);
      await new Promise((r) => setTimeout(r, 10));
    });

    // Dialog closed, row still present, delete still not called
    const dialogAfter = document.body.querySelector(
      "[data-testid='staffing-remove-dialog']",
    );
    assert.equal(dialogAfter, null, "dialog must close after cancel");
    assert.equal(
      deleteCalls.length,
      0,
      "deleteAdminOperator must not be invoked after cancel",
    );
    const rowAfter = container.querySelector(
      `[data-testid='staffing-row-${opPubkey}']`,
    );
    assert.ok(
      rowAfter !== null,
      "operator row must still be present after cancel",
    );
  } finally {
    await unmount();
  }
});

test("staffing-remove-confirm: confirming dialog invokes deleteAdminOperator exactly once with the right pubkey", async () => {
  const origin = "https://admin-staffing.example.com";
  const pubkey = "cc".repeat(32);
  const opPubkey = "dd".repeat(32);

  const deleteCalls = [];
  setIpcHandler("admin_delete_operator", (args) => {
    deleteCalls.push(args?.pubkey ?? "?");
    return Promise.resolve();
  });

  const { container, doRender, unmount } = mountStaffingPanel(origin, pubkey, [
    { pubkey: opPubkey, effectiveRole: "moderator", sources: ["db"] },
  ]);
  await doRender();
  await settle(30);

  try {
    // Open dialog
    const removeBtn = container.querySelector(
      `[data-testid='staffing-remove-btn-${opPubkey}']`,
    );
    assert.ok(removeBtn !== null, "remove button must be present");
    await act(async () => {
      fireEvent.click(removeBtn);
      await new Promise((r) => setTimeout(r, 10));
    });

    const dialog = document.body.querySelector(
      "[data-testid='staffing-remove-dialog']",
    );
    assert.ok(dialog !== null, "confirmation dialog must be open");

    // Click Confirm
    const confirmBtn = document.body.querySelector(
      "[data-testid='staffing-remove-confirm']",
    );
    assert.ok(confirmBtn !== null, "confirm button must be present in dialog");
    await act(async () => {
      fireEvent.click(confirmBtn);
      await new Promise((r) => setTimeout(r, 30));
    });

    // deleteAdminOperator must have been called exactly once with the right pubkey
    assert.equal(
      deleteCalls.length,
      1,
      `deleteAdminOperator must be invoked exactly once; calls: ${JSON.stringify(deleteCalls)}`,
    );
    assert.equal(
      deleteCalls[0],
      opPubkey,
      `deleteAdminOperator must receive the target pubkey; got: ${deleteCalls[0]}`,
    );
  } finally {
    await unmount();
  }
});

test("staffing-remove-self-warning: self-removal dialog shows the distinct self-removal warning", async () => {
  const origin = "https://admin-staffing.example.com";
  // acting pubkey == op pubkey → self-removal
  const pubkey = "ee".repeat(32);

  const deleteCalls = [];
  setIpcHandler("admin_delete_operator", (args) => {
    deleteCalls.push(args?.pubkey ?? "?");
    return Promise.resolve();
  });

  const { container, doRender, unmount } = mountStaffingPanel(origin, pubkey, [
    { pubkey: pubkey, effectiveRole: "operator", sources: ["db"] },
  ]);
  await doRender();
  await settle(30);

  try {
    // Open dialog for the acting user's own row
    const removeBtn = container.querySelector(
      `[data-testid='staffing-remove-btn-${pubkey}']`,
    );
    assert.ok(removeBtn !== null, "own remove button must be present");
    await act(async () => {
      fireEvent.click(removeBtn);
      await new Promise((r) => setTimeout(r, 10));
    });

    const warning = document.body.querySelector(
      "[data-testid='staffing-remove-self-warning']",
    );
    assert.ok(
      warning !== null,
      "self-removal warning must appear when removing own operator access",
    );
  } finally {
    await unmount();
  }
});

// ── P2: activeTab resets when role transitions out of staffing ────────────────
//
// If a mounted panel transitions from operator → moderator/unknown while
// Staffing is selected, the panel must reset to reports rather than leaving
// an empty/invisible state.
//
// Mutation evidence: removing the reset useEffect → this test goes RED
// (no tab content renders after the role downgrade).

test("staffing-tab-reset-on-role-downgrade: panel shows reports content after operator→moderator transition", async () => {
  const origin = "https://admin-rw.example.com";
  const pubkey = "ff".repeat(32);

  setIpcHandler("admin_list_reports", () => Promise.resolve([]));
  setIpcHandler("admin_list_operators", () => Promise.resolve([]));
  setIpcHandler("admin_list_feedback", () => Promise.resolve([]));

  // Mount with operator role + staffing tab active
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const qc = makeQueryClient(pubkey);

  const renderWith = async (role) => {
    await act(async () => {
      root.render(
        React.createElement(
          QueryClientProvider,
          { client: qc },
          React.createElement(
            CommunitiesProvider,
            null,
            React.createElement(AdminConsolePanel, {
              canMutate: true,
              origin,
              pubkey,
              role,
              initialTab: "staffing",
            }),
          ),
        ),
      );
    });
  };
  const unmount = async () => {
    await act(async () => {
      root.unmount();
    });
    document.body.removeChild(container);
  };

  try {
    await renderWith("operator");
    await settle(30);

    // Staffing tab content is visible
    const staffingContent = container.querySelector(
      "[data-testid='staffing-tab']",
    );
    assert.ok(
      staffingContent !== null,
      "staffing tab content must be visible when role=operator",
    );

    // Transition to moderator — staffing tab is now unauthorized
    await renderWith("moderator");
    await settle(20);

    // Staffing content must be gone; reports content must be present
    const staffingAfter = container.querySelector(
      "[data-testid='staffing-tab']",
    );
    assert.equal(
      staffingAfter,
      null,
      "staffing tab content must be absent after role downgrade to moderator",
    );

    // The reset effect must have switched activeTab → reports, so the reports
    // tab wrapper must be in the DOM. Without the reset, activeTab stays on
    // staffing and neither staffing (gated by isOperator) nor reports renders.
    const reportsTabContent = container.querySelector(
      "[data-testid='reports-tab']",
    );
    assert.ok(
      reportsTabContent !== null,
      "reports-tab content must render after reset (without reset, panel is empty)",
    );

    // The reports tab button must exist and not the staffing tab button
    const reportsTabBtn = container.querySelector(
      "[data-testid='admin-tab-reports']",
    );
    assert.ok(
      reportsTabBtn !== null,
      "reports tab button must be visible after reset",
    );
    const staffingTabBtn = container.querySelector(
      "[data-testid='admin-tab-staffing']",
    );
    assert.equal(
      staffingTabBtn,
      null,
      "staffing tab button must be absent after role downgrade to moderator",
    );
  } finally {
    await unmount();
  }
});

// ── P1: Staffing add is create-only — duplicate guard ────────────────────────
//
// Submitting an operator pubkey already present in the loaded roster must
// produce zero PUTs and surface a specific inline error naming the effective
// role. Submitting a new pubkey must produce exactly one PUT with the complete
// body. The Add button must be disabled until the list loads successfully.
//
// Mutation evidence:
//   - Removing the duplicate-guard `if (existing)` block → zero-PUT assertion
//     fails when an existing key is submitted (a PUT fires instead).

test("staffing-add-duplicate-guard: submitting an existing key produces zero PUTs; submitting a new key produces one complete PUT", async () => {
  const origin = "https://admin-staffing.example.com";
  const pubkey = "11".repeat(32);
  const existingPubkey = "22".repeat(32);
  const newPubkey = "33".repeat(32);

  const putCalls = [];
  const roster = [
    {
      pubkey: existingPubkey,
      effectiveRole: "operator",
      sources: ["db"],
    },
    {
      pubkey: "44".repeat(32),
      effectiveRole: "moderator",
      sources: ["db"],
    },
  ];
  setIpcHandler("admin_put_operator", (args) => {
    putCalls.push({ pubkey: args?.pubkey, role: args?.body?.role });
    const newEntry = {
      pubkey: args?.pubkey,
      effectiveRole: args?.body?.role,
      sources: ["db"],
    };
    roster.push(newEntry);
    return Promise.resolve(newEntry);
  });

  const { container, doRender, unmount } = mountStaffingPanel(
    origin,
    pubkey,
    roster,
  );
  await doRender();
  await settle(30);

  try {
    // ── Case 1: submit an existing pubkey with the default role (moderator) ──
    const pubkeyInput = container.querySelector(
      "[data-testid='staffing-add-pubkey-input']",
    );
    assert.ok(pubkeyInput, "pubkey input must be present");

    await act(async () => {
      fireEvent.change(pubkeyInput, { target: { value: existingPubkey } });
      await new Promise((r) => setTimeout(r, 10));
    });

    const addBtn = container.querySelector("[data-testid='staffing-add-btn']");
    assert.ok(addBtn, "Add button must be present");

    await act(async () => {
      fireEvent.click(addBtn);
      await new Promise((r) => setTimeout(r, 20));
    });

    assert.equal(
      putCalls.length,
      0,
      "admin_put_operator must NOT be called for an existing pubkey",
    );

    // An inline error naming the existing effective role must be visible.
    const errEls = Array.from(
      container.querySelectorAll(
        "[data-testid='staffing-tab'] .text-destructive",
      ),
    );
    assert.ok(
      errEls.some((el) => el.textContent.includes("operator")),
      `inline error must name the existing effective role "operator"; found: ${errEls.map((e) => e.textContent).join(", ")}`,
    );

    // The existing row must still be present with its original role after the
    // rejected duplicate submit — the roster must be unmodified.
    await settle(10);
    const existingRow = container.querySelector(
      `[data-testid='staffing-row-${existingPubkey}']`,
    );
    assert.ok(
      existingRow !== null,
      "existing operator row must still render after duplicate-submit rejection",
    );
    assert.ok(
      existingRow.textContent.includes("operator"),
      `existing row must still show the "operator" role after rejection; got: ${existingRow.textContent}`,
    );

    // ── Case 2: clear the input and submit a genuinely new pubkey ──
    await act(async () => {
      fireEvent.change(pubkeyInput, { target: { value: newPubkey } });
      await new Promise((r) => setTimeout(r, 10));
    });

    await act(async () => {
      fireEvent.click(addBtn);
      await new Promise((r) => setTimeout(r, 30));
    });

    assert.equal(
      putCalls.length,
      1,
      `admin_put_operator must be called exactly once for a new pubkey; got ${putCalls.length}`,
    );
    assert.equal(
      putCalls[0].pubkey,
      newPubkey,
      `PUT must carry the new pubkey; got: ${putCalls[0].pubkey}`,
    );
    assert.equal(
      putCalls[0].role,
      "moderator",
      `PUT must carry the selected role; got: ${putCalls[0].role}`,
    );

    // The row for the new pubkey must appear (list refreshed).
    await settle(30);
    const newRow = container.querySelector(
      `[data-testid='staffing-row-${newPubkey}']`,
    );
    assert.ok(
      newRow !== null,
      "new operator row must appear after successful PUT",
    );
  } finally {
    await unmount();
  }
});

// ── P2: Staffing display-name + npub presentation ─────────────────────────────
//
// Behavioral coverage for the useUsersBatchQuery integration.
//
// Mutation evidence:
//   - Suppress the get_users_batch IPC response → display name test goes RED
//     (raw pubkey renders instead of display name).
//   - Remove HoverStaffingIdentity → npub data-testid absent → npub test RED.
//   - Remove putAdminOperator call from handleRoleChange → PUT test goes RED.
//   - Swap 409 check for generic message → rejection copy test goes RED.

test("staffing-display-name: resolved profile name renders in place of raw pubkey", async () => {
  // Verifies that get_users_batch is called and the returned displayName renders
  // in the staffing row — not the fallback truncated pubkey.
  const origin = "https://admin-staffing-name.example.com";
  const pubkey = "a1".repeat(32);
  const opPubkey = "b2".repeat(32);

  setIpcHandler("get_users_batch", (args) => {
    const profiles = {};
    for (const pk of args?.pubkeys ?? []) {
      if (pk === opPubkey) {
        // Raw IPC format uses snake_case (getRawUsersBatchResponse shape).
        profiles[pk] = { display_name: "Alice Operator", avatar_url: null };
      }
    }
    return Promise.resolve({ profiles, missing: [] });
  });

  const { container, doRender, unmount } = mountStaffingPanel(origin, pubkey, [
    { pubkey: opPubkey, effectiveRole: "moderator", sources: ["db"] },
  ]);
  await doRender();
  // admin_list_operators resolves first, populating listedPubkeys, which enables
  // useUsersBatchQuery. A second settle cycle lets React Query fire get_users_batch
  // and commit the result before the assertion.
  await settle(50);
  await settle(100);

  try {
    const nameEl = container.querySelector(
      `[data-testid='staffing-name-${opPubkey}']`,
    );
    assert.ok(
      nameEl !== null,
      "staffing-name element must be present for listed operator",
    );
    assert.ok(
      nameEl.textContent.includes("Alice Operator"),
      `staffing row must render resolved display name "Alice Operator"; got: "${nameEl.textContent}"`,
    );
    // The npub span must also be present alongside the display name.
    // Folded from staffing-npub-hover: the DOM node must exist and start with "npub1".
    const npubEl = container.querySelector(
      `[data-testid='staffing-npub-${opPubkey}']`,
    );
    assert.ok(
      npubEl !== null,
      "staffing-npub element must be present for listed operator",
    );
    assert.ok(
      npubEl.textContent.startsWith("npub1") ||
        npubEl.textContent.includes("npub"),
      `staffing-npub must contain encoded npub prefix; got: "${npubEl.textContent}"`,
    );
  } finally {
    await unmount();
  }
});

test("staffing-role-change-success: role selector change calls putAdminOperator and refreshes the list", async () => {
  // Verifies that selecting a different role triggers one PUT with the new role
  // and the row reflects the update after the list refresh.
  const origin = "https://admin-staffing-role.example.com";
  const pubkey = "e5".repeat(32);
  const opPubkey = "f6".repeat(32);

  const putCalls = [];
  let currentRole = "moderator";
  setIpcHandler("admin_list_reports", () => Promise.resolve([]));
  setIpcHandler("admin_list_operators", () =>
    Promise.resolve([
      { pubkey: opPubkey, effectiveRole: currentRole, sources: ["db"] },
    ]),
  );
  setIpcHandler("admin_put_operator", (args) => {
    putCalls.push({ pubkey: args?.pubkey, role: args?.body?.role });
    currentRole = args?.body?.role;
    return Promise.resolve({
      pubkey: opPubkey,
      effectiveRole: currentRole,
      sources: ["db"],
    });
  });

  const { container, doRender, unmount } = mountPanel({
    origin,
    pubkey,
    canMutate: true,
    role: "operator",
    initialTab: "staffing",
  });
  await doRender();
  await settle(30);

  try {
    const roleSelect = container.querySelector(
      `[data-testid='staffing-role-select-${opPubkey}']`,
    );
    assert.ok(
      roleSelect !== null,
      "role selector must be present for DB-backed operator in canMutate mode",
    );

    // Change to operator
    await act(async () => {
      fireEvent.change(roleSelect, { target: { value: "operator" } });
      await new Promise((r) => setTimeout(r, 30));
    });

    assert.equal(
      putCalls.length,
      1,
      `admin_put_operator must be called exactly once on role change; got ${putCalls.length}`,
    );
    assert.equal(
      putCalls[0].pubkey,
      opPubkey,
      `PUT must carry the operator pubkey; got: ${putCalls[0].pubkey}`,
    );
    assert.equal(
      putCalls[0].role,
      "operator",
      `PUT must carry the new role "operator"; got: ${putCalls[0].role}`,
    );

    // After list refresh the role selector must reflect the updated role
    await settle(30);
    const roleSelectAfter = container.querySelector(
      `[data-testid='staffing-role-select-${opPubkey}']`,
    );
    assert.ok(
      roleSelectAfter !== null,
      "role selector must still be present after refresh",
    );
    assert.equal(
      roleSelectAfter.value,
      "operator",
      `role selector must show updated role "operator" after refresh; got: ${roleSelectAfter.value}`,
    );
  } finally {
    await unmount();
  }
});

test("staffing-role-change-409: a 409 conflict from putAdminOperator surfaces the relay error message", async () => {
  // Verifies that a 409 response to a role change surfaces the relay's parsed
  // error message directly, not a hardcoded "config-backed" copy.
  //
  // Two sub-cases cover the two distinct 409 messages the relay sends:
  //   (a) config-backed key: "pubkey is backed by config ..."
  //   (b) last-operator conflict: "operation would remove the last relay
  //       operator — add a replacement operator first"
  //
  // Before the fix, case (b) was incorrectly classified as config-backed,
  // hiding the relay's recovery guidance. The fix replaces the 409 hardcode
  // with adminErrorMessage(e), which parses the relay's error envelope.
  //
  // Mutation evidence:
  //   - Restore the old adminMutationRelayStatus === 409 branch →
  //     case (b) shows "config-backed" instead of the relay message → RED.
  //   - Remove the adminErrorMessage(e) call → raw JSON renders → RED.
  const origin = "https://admin-staffing-role-reject.example.com";
  const pubkey = "07".repeat(32);
  const opPubkey = "18".repeat(32);

  let putResult = () =>
    mutationReject(
      'admin API error: {"error":{"code":"conflict","message":"pubkey is backed by config (RELAY_OPERATOR_PUBKEYS or owner fallback) — immutable through the API"}}',
      409,
    );
  setIpcHandler("admin_put_operator", () => putResult());

  const { container, doRender, unmount } = mountStaffingPanel(origin, pubkey, [
    { pubkey: opPubkey, effectiveRole: "moderator", sources: ["db"] },
  ]);
  await doRender();
  await settle(30);

  try {
    const roleSelect = container.querySelector(
      `[data-testid='staffing-role-select-${opPubkey}']`,
    );
    assert.ok(roleSelect !== null, "role selector must be present");

    // ── Case (a): config-backed 409 surfaces relay's config-backed message ──
    await act(async () => {
      fireEvent.change(roleSelect, { target: { value: "operator" } });
      await new Promise((r) => setTimeout(r, 30));
    });

    let errEls = Array.from(
      container.querySelectorAll(
        "[data-testid='staffing-tab'] [class*='destructive']",
      ),
    );
    assert.ok(
      errEls.length > 0,
      "an error element must appear after rejected role change",
    );
    assert.ok(
      errEls.some((el) => el.textContent.includes("immutable through the API")),
      `config-backed 409 must surface relay message; got: ${errEls.map((e) => e.textContent).join(", ")}`,
    );
    assert.ok(
      !errEls.some((el) => el.textContent.includes("admin API error")),
      "raw envelope prefix must not render",
    );

    // ── Case (b): last-operator 409 surfaces relay's distinct recovery message ──
    putResult = () =>
      mutationReject(
        'admin API error: {"error":{"code":"conflict","message":"operation would remove the last relay operator — add a replacement operator first"}}',
        409,
      );
    await act(async () => {
      // Re-select moderator first so the change is non-trivial, then operator.
      fireEvent.change(roleSelect, { target: { value: "moderator" } });
      await new Promise((r) => setTimeout(r, 10));
    });
    // roleSelect may have been refreshed — re-query.
    const roleSelectB = container.querySelector(
      `[data-testid='staffing-role-select-${opPubkey}']`,
    );
    await act(async () => {
      fireEvent.change(roleSelectB, { target: { value: "operator" } });
      await new Promise((r) => setTimeout(r, 30));
    });

    errEls = Array.from(
      container.querySelectorAll(
        "[data-testid='staffing-tab'] [class*='destructive']",
      ),
    );
    assert.ok(
      errEls.some((el) =>
        el.textContent.includes("add a replacement operator first"),
      ),
      `last-operator 409 must surface the relay's recovery message, not "config-backed"; got: ${errEls.map((e) => e.textContent).join(", ")}`,
    );
  } finally {
    await unmount();
  }
});

test("staffing-add-409: a typed 409 from putAdminOperator surfaces the relay error message; non-409 renders adminErrorMessage", async () => {
  // handleAdd surfaces adminErrorMessage(e) for ALL errors — a 409 shows the
  // relay's parsed message (config-backed OR last-operator conflict), not a
  // hardcoded copy.
  //
  // Two 409 sub-cases (a) config-backed and (b) last-operator verify that the
  // distinct relay messages reach the UI unchanged.
  //
  // Mutation evidence:
  //   - Restore the old adminMutationRelayStatus === 409 hardcode →
  //     case (b) shows "config-backed" not the relay message → RED.
  //   - Remove adminErrorMessage(e) → raw JSON envelope renders → RED.
  const origin = "https://admin-staffing-add-reject.example.com";
  const pubkey = "07".repeat(32);
  const newPubkey = "19".repeat(32);

  let putResult = () =>
    mutationReject(
      'admin API error: {"error":{"code":"conflict","message":"pubkey is backed by config (RELAY_OPERATOR_PUBKEYS or owner fallback) — immutable through the API"}}',
      409,
    );
  setIpcHandler("admin_put_operator", () => putResult());

  const { container, doRender, unmount } = mountStaffingPanel(origin, pubkey);
  await doRender();
  await settle(30);

  try {
    const pubkeyInput = container.querySelector(
      "[data-testid='staffing-add-pubkey-input']",
    );
    assert.ok(pubkeyInput, "pubkey input must be present");
    const addBtn = container.querySelector("[data-testid='staffing-add-btn']");
    assert.ok(addBtn, "Add button must be present");

    // ── Case (a): config-backed 409 → relay's config-backed message ──
    await act(async () => {
      fireEvent.change(pubkeyInput, { target: { value: newPubkey } });
      await new Promise((r) => setTimeout(r, 10));
    });
    await act(async () => {
      fireEvent.click(addBtn);
      await new Promise((r) => setTimeout(r, 30));
    });

    let errEls = Array.from(
      container.querySelectorAll(
        "[data-testid='staffing-tab'] .text-destructive",
      ),
    );
    assert.ok(
      errEls.some((el) => el.textContent.includes("immutable through the API")),
      `config-backed 409 add must surface relay message; got: ${errEls.map((e) => e.textContent).join(", ")}`,
    );

    // ── Case (b): last-operator 409 → relay's recovery message, not "config-backed" ──
    putResult = () =>
      mutationReject(
        'admin API error: {"error":{"code":"conflict","message":"operation would remove the last relay operator — add a replacement operator first"}}',
        409,
      );
    const anotherPubkey = "2a".repeat(32);
    await act(async () => {
      fireEvent.change(pubkeyInput, { target: { value: anotherPubkey } });
      await new Promise((r) => setTimeout(r, 10));
    });
    await act(async () => {
      fireEvent.click(addBtn);
      await new Promise((r) => setTimeout(r, 30));
    });

    errEls = Array.from(
      container.querySelectorAll(
        "[data-testid='staffing-tab'] .text-destructive",
      ),
    );
    assert.ok(
      errEls.some((el) =>
        el.textContent.includes("add a replacement operator first"),
      ),
      `last-operator 409 add must surface relay recovery message; got: ${errEls.map((e) => e.textContent).join(", ")}`,
    );

    // ── Case (c): non-409 typed failure → adminErrorMessage's envelope text ──
    putResult = () =>
      mutationReject(
        'admin API error: {"error":{"code":"forbidden","message":"pubkey not permitted"}}',
        403,
      );
    const yetAnotherPubkey = "3b".repeat(32);
    await act(async () => {
      fireEvent.change(pubkeyInput, { target: { value: yetAnotherPubkey } });
      await new Promise((r) => setTimeout(r, 10));
    });
    await act(async () => {
      fireEvent.click(addBtn);
      await new Promise((r) => setTimeout(r, 30));
    });

    errEls = Array.from(
      container.querySelectorAll(
        "[data-testid='staffing-tab'] .text-destructive",
      ),
    );
    assert.ok(
      errEls.some((el) => el.textContent.includes("pubkey not permitted")),
      `non-409 add must surface adminErrorMessage envelope text; got: ${errEls.map((e) => e.textContent).join(", ")}`,
    );
    assert.ok(
      !errEls.some((el) => el.textContent.includes("admin API error")),
      "non-409 add must not render the raw serialized error prefix",
    );
  } finally {
    await unmount();
  }
});

test("staffing-remove-409: a typed 409 from deleteAdminOperator surfaces the relay error message; non-409 renders adminErrorMessage", async () => {
  // handleConfirmRemove surfaces adminErrorMessage(e) for ALL errors — a 409
  // shows the relay's parsed message (config-backed OR last-operator conflict).
  //
  // Before the fix, a last-operator 409 was misclassified as "config-backed",
  // hiding the relay's "add a replacement operator first" recovery guidance.
  //
  // Mutation evidence:
  //   - Restore the old adminMutationRelayStatus === 409 branch →
  //     case (b) shows "config-backed" not the relay message → RED.
  //   - Remove adminErrorMessage(e) → raw JSON envelope renders → RED.
  const origin = "https://admin-staffing-remove-reject.example.com";
  const pubkey = "07".repeat(32);
  const opPubkey = "1a".repeat(32);

  let deleteResult = () =>
    mutationReject(
      'admin API error: {"error":{"code":"conflict","message":"pubkey is backed by config (RELAY_OPERATOR_PUBKEYS or owner fallback) — immutable through the API"}}',
      409,
    );
  setIpcHandler("admin_delete_operator", () => deleteResult());

  const { container, doRender, unmount } = mountStaffingPanel(origin, pubkey, [
    { pubkey: opPubkey, effectiveRole: "moderator", sources: ["db"] },
  ]);
  await doRender();
  await settle(30);

  const confirmRemove = async () => {
    const removeBtn = container.querySelector(
      `[data-testid='staffing-remove-btn-${opPubkey}']`,
    );
    assert.ok(removeBtn !== null, "remove button must be present");
    await act(async () => {
      fireEvent.click(removeBtn);
      await new Promise((r) => setTimeout(r, 10));
    });
    const confirmBtn = document.body.querySelector(
      "[data-testid='staffing-remove-confirm']",
    );
    assert.ok(confirmBtn !== null, "confirm button must be present in dialog");
    await act(async () => {
      fireEvent.click(confirmBtn);
      await new Promise((r) => setTimeout(r, 30));
    });
  };

  try {
    // ── Case (a): config-backed 409 → relay's config-backed message ──
    await confirmRemove();

    let errEls = Array.from(
      container.querySelectorAll(
        "[data-testid='staffing-tab'] [class*='destructive']",
      ),
    );
    assert.ok(
      errEls.some((el) => el.textContent.includes("immutable through the API")),
      `config-backed 409 remove must surface relay message; got: ${errEls.map((e) => e.textContent).join(", ")}`,
    );

    // ── Case (b): last-operator 409 → relay's recovery message ──
    deleteResult = () =>
      mutationReject(
        'admin API error: {"error":{"code":"conflict","message":"operation would remove the last relay operator — add a replacement operator first"}}',
        409,
      );
    await confirmRemove();

    errEls = Array.from(
      container.querySelectorAll(
        "[data-testid='staffing-tab'] [class*='destructive']",
      ),
    );
    assert.ok(
      errEls.some((el) =>
        el.textContent.includes("add a replacement operator first"),
      ),
      `last-operator 409 remove must surface relay recovery message, not "config-backed"; got: ${errEls.map((e) => e.textContent).join(", ")}`,
    );

    // ── Case (c): non-409 typed failure → adminErrorMessage's envelope text ──
    deleteResult = () =>
      mutationReject(
        'admin API error: {"error":{"code":"internal","message":"operator store unavailable"}}',
        500,
      );
    await confirmRemove();

    errEls = Array.from(
      container.querySelectorAll(
        "[data-testid='staffing-tab'] [class*='destructive']",
      ),
    );
    assert.ok(
      errEls.some((el) =>
        el.textContent.includes("operator store unavailable"),
      ),
      `non-409 remove must surface adminErrorMessage envelope text; got: ${errEls.map((e) => e.textContent).join(", ")}`,
    );
    assert.ok(
      !errEls.some((el) => el.textContent.includes("admin API error")),
      "non-409 remove must not render the raw serialized error prefix",
    );
  } finally {
    await unmount();
  }
});

test("staffing-self-removal-fires-onSelfMutation: confirming removal of own pubkey calls onSelfMutation", async () => {
  // Verifies that handleConfirmRemove calls onSelfMutation when deleting the
  // current principal's own operator row.
  //
  // Without this callback the parent probe is never re-run after self-removal,
  // leaving the UI showing "Connected as operator" + Staffing tab even after
  // the operator has removed themselves.
  //
  // Mutation evidence:
  //   - Remove the `if (op.pubkey === pubkey) onSelfMutation?.()` guard →
  //     onSelfMutationCalls remains 0 → RED.
  const origin = "https://admin-staffing-self-remove.example.com";
  const pubkey = "ee".repeat(32); // self

  let onSelfMutationCalls = 0;

  setIpcHandler("admin_delete_operator", () => Promise.resolve());

  const { container, doRender, unmount } = mountStaffingPanel(
    origin,
    pubkey,
    [{ pubkey: pubkey, effectiveRole: "operator", sources: ["db"] }],
    {
      onSelfMutation: () => {
        onSelfMutationCalls += 1;
      },
    },
  );
  await doRender();
  await settle(30);

  try {
    // Open confirmation dialog for self-removal
    const removeBtn = container.querySelector(
      `[data-testid='staffing-remove-btn-${pubkey}']`,
    );
    assert.ok(removeBtn !== null, "self remove button must be present");
    await act(async () => {
      fireEvent.click(removeBtn);
      await new Promise((r) => setTimeout(r, 10));
    });

    const confirmBtn = document.body.querySelector(
      "[data-testid='staffing-remove-confirm']",
    );
    assert.ok(confirmBtn !== null, "confirm button must be present in dialog");
    await act(async () => {
      fireEvent.click(confirmBtn);
      await new Promise((r) => setTimeout(r, 30));
    });

    assert.equal(
      onSelfMutationCalls,
      1,
      `onSelfMutation must be called exactly once after self-removal; called ${onSelfMutationCalls} times`,
    );
  } finally {
    await unmount();
  }
});
