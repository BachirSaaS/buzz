import { expect, test, type Page } from "@playwright/test";
import { installMockBridge, TEST_IDENTITIES } from "../helpers/bridge";
import { waitForAnimations } from "../helpers/animations";

async function add(page: Page, query: string, name: RegExp) {
  await page.getByTestId("canvas-add-view").click();
  const dialog = page.getByRole("dialog", { name: "Add a view" });
  await dialog.getByRole("textbox", { name: "Search views" }).fill(query);
  await dialog.getByRole("button", { name }).click();
  await expect(dialog).toHaveCount(0);
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.route("**/__pulse/briefing", (route) =>
    route.fulfill({ json: { highlights: [] } }),
  );
  await page.route("**/__chief", (route) =>
    route.fulfill({ status: 503, json: { error: "Offline for canvas test" } }),
  );
  await installMockBridge(page);
  await page.goto("/#/pulse?feed=conversation");
  await expect(page.getByTestId("canvas-add-view")).toBeEnabled();
});

test("find views, arrange windows, navigate, reload and close without losing the canvas", async ({
  page,
}) => {
  const canvas = page.getByTestId("pulse-canvas");
  await expect(
    page.getByRole("group", { name: "Canvas controls" }),
  ).toHaveCount(0);
  await add(page, "general", /#general/);
  await expect(
    page
      .getByTestId("app-top-chrome")
      .getByRole("group", { name: "Canvas controls" }),
  ).toBeVisible();
  await expect(
    canvas.getByRole("group", { name: "Canvas controls" }),
  ).toHaveCount(0);
  await expect(
    canvas.getByRole("region", { name: "#general window", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Your canvas", { exact: false })).toHaveCount(0);
  expect(
    (await page.getByTestId("pulse-main-container").boundingBox())?.width,
  ).toBe(960);
  const companionBox = await page
    .getByTestId("canvas-window")
    .first()
    .boundingBox();
  expect(companionBox?.width).toBe(584);
  expect(companionBox?.y).toBe(72);
  expect(companionBox && companionBox.y + companionBox.height).toBe(976);
  await add(page, "alice", /Alice/i);
  await add(page, "agent", /^Agent activity Agents$/);
  await expect(page.getByTestId("canvas-window")).toHaveCount(3);
  await expect(page.getByTestId("canvas-add-view")).toBeDisabled();
  await expect(page.getByTestId("canvas-window").last()).toBeFocused();
  await page
    .getByTestId("app-top-chrome")
    .getByRole("button", { name: "Columns layout", exact: true })
    .click();
  const columns = await page
    .getByTestId("canvas-window")
    .evaluateAll((windows) =>
      windows.map((window) => ({
        x: window.getBoundingClientRect().x,
        y: window.getBoundingClientRect().y,
      })),
    );
  expect(columns[0].y).toBe(columns[1].y);
  expect(columns[1].x).toBeGreaterThan(columns[0].x);
  await page
    .getByTestId("app-top-chrome")
    .getByRole("button", { name: "Grid layout", exact: true })
    .click();
  await expect(canvas).toHaveAttribute("data-layout", "grid");
  await canvas
    .getByRole("button", { name: "Move Agent activity earlier" })
    .click();
  await expect(page.getByTestId("canvas-window").nth(1)).toHaveAttribute(
    "data-view-id",
    "agents",
  );
  await expect(
    canvas.getByRole("button", { name: /in main window/ }),
  ).toHaveCount(0);
  await page
    .getByTestId("pulse-app-navigation")
    .getByRole("button", { name: "Messages", exact: true })
    .click();
  await page
    .getByRole("dialog", { name: "Messages destinations" })
    .getByRole("button", { name: "Open channel general", exact: true })
    .click();
  await expect(
    page.getByTestId("pulse-main-container").getByTestId("pulse-message-view"),
  ).toBeVisible();
  await expect(page.getByTestId("canvas-window")).toHaveCount(3);
  await page.reload();
  await expect(canvas).toHaveAttribute("data-layout", "grid");
  await expect(page.getByTestId("canvas-window").nth(1)).toHaveAttribute(
    "data-view-id",
    "agents",
  );
  await waitForAnimations(page);
  await page.screenshot({ path: "test-results/pulse-canvas/grid.png" });
  await canvas
    .getByRole("button", { name: "Close Agent activity window" })
    .click();
  await expect(page.getByTestId("canvas-add-view")).toBeEnabled();
  await expect(page.getByTestId("canvas-add-view")).toBeFocused();
  await page.setViewportSize({ width: 740, height: 900 });
  const boxes = await page.getByTestId("canvas-window").evaluateAll((windows) =>
    windows.map((window) => {
      const box = window.getBoundingClientRect();
      return { x: box.x, width: box.width };
    }),
  );
  for (const box of boxes) {
    expect(box.x).toBeGreaterThanOrEqual(24);
    expect(box.width).toBeLessThanOrEqual(740 - 48);
    expect(box.x + box.width).toBeLessThanOrEqual(740 - 24);
  }
  while (await page.getByTestId("canvas-window").count())
    await page
      .getByTestId("canvas-window")
      .first()
      .getByRole("button", { name: /^Close .* window$/ })
      .click();
  await expect(canvas).toHaveAttribute("data-window-count", "0");
  await expect(page.getByTestId("pulse-main-container")).toHaveAttribute(
    "data-content-width",
    "full",
  );
});

test("projects can be found and placed beside Messages", async ({ page }) => {
  await add(page, "buzz", /^buzz Projects$/);
  const project = page.getByRole("region", {
    name: "buzz window",
    exact: true,
  });
  await expect(
    project.getByText("Relay, desktop, and mobile clients", { exact: false }),
  ).toBeVisible();
  await project
    .getByRole("button", { name: "Open project", exact: true })
    .click();
  await expect(page.getByTestId("pulse-workspace-projects")).toBeVisible();
  await expect(project).toBeVisible();
});

test("keyboard picker supports search, empty results and Escape; failed saves remain retryable", async ({
  page,
}) => {
  const addButton = page.getByTestId("canvas-add-view");
  await addButton.focus();
  await page.keyboard.press("Enter");
  const search = page.getByRole("textbox", { name: "Search views" });
  await expect(search).toBeFocused();
  await search.fill("no-such-view-123");
  await expect(
    page.getByText("No views found.", { exact: false }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(addButton).toBeFocused();
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key.startsWith("buzz-canvas.v1:"))
        throw new DOMException("Full", "QuotaExceededError");
      original.call(this, key, value);
    };
  });
  await addButton.click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: /^Agent activity Agents$/ })
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(
    page.getByText("Could not save your canvas. Please try again."),
  ).toBeVisible();
  await expect(page.getByTestId("canvas-window")).toHaveCount(0);
});

test("channel and DM companions use full conversations with independent threads and composers", async ({
  page,
}) => {
  await add(page, "general", /#general/);
  await add(page, "alice", /Alice/i);
  const channel = page.getByRole("region", {
    name: "#general window",
    exact: true,
  });
  const dm = page.getByTestId("canvas-window").filter({
    has: page.locator('[data-testid="chat-title"]', { hasText: /alice/i }),
  });
  for (const panel of [channel, dm]) {
    await expect(panel.getByTestId("pulse-message-view")).toBeVisible();
    await expect(panel.getByTestId("message-input")).toBeVisible();
    await expect(panel.getByTestId("pulse-conversation")).toHaveCount(0);
    await expect(
      panel.getByRole("button", { name: /in main window/ }),
    ).toHaveCount(0);
  }
  await dm.getByTestId("message-input").fill("Private draft for Alice");
  await page
    .getByTestId("pulse-app-navigation")
    .getByRole("button", { name: "Messages", exact: true })
    .click();
  await page
    .getByRole("dialog", { name: "Messages destinations" })
    .getByRole("button", { name: "Open channel general", exact: true })
    .click();
  const main = page.getByTestId("pulse-main-container");
  await expect(main.getByTestId("chat-title")).toHaveText("general");
  const url = page.url();
  await page.waitForFunction(() =>
    window.__BUZZ_E2E_HAS_MOCK_LIVE_SUBSCRIPTION__?.({
      channelName: "general",
    }),
  );
  await page.evaluate(
    ({ pubkey }) => {
      const emit = window.__BUZZ_E2E_EMIT_MOCK_MESSAGE__;
      if (!emit) throw new Error("Missing mock bridge");
      const root = emit({
        channelName: "general",
        pubkey,
        content: "Independent canvas conversation",
      });
      emit({
        channelName: "general",
        pubkey,
        content: "A reply inside the companion",
        parentEventId: root.id,
      });
    },
    { pubkey: TEST_IDENTITIES.alice.pubkey },
  );
  await channel
    .getByTestId("message-row")
    .filter({ hasText: "Independent canvas conversation" })
    .getByTestId("message-thread-summary")
    .click();
  await expect(
    channel.getByRole("button", { name: "Back to conversation", exact: true }),
  ).toBeVisible();
  await expect(
    channel.getByText("A reply inside the companion", { exact: true }),
  ).toBeVisible();
  await expect(
    main.getByRole("button", { name: "Back to conversation", exact: true }),
  ).toHaveCount(0);
  await expect(main.getByTestId("chat-title")).toHaveText("general");
  expect(page.url()).toBe(url);
  await expect(dm.getByTestId("message-input")).toHaveText(
    "Private draft for Alice",
  );
  await channel
    .getByRole("button", { name: "Back to conversation", exact: true })
    .click();
  await expect(channel.getByTestId("chat-title")).toHaveText("general");
  await dm.getByTestId("message-input").fill("A message from the DM companion");
  await dm.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(
    dm
      .getByTestId("message-body")
      .filter({ hasText: "A message from the DM companion" }),
  ).toBeVisible();
  await expect(
    main.getByText("A message from the DM companion", { exact: true }),
  ).toHaveCount(0);
  expect(page.url()).toBe(url);
  await waitForAnimations(page);
  await page.screenshot({
    path: "test-results/pulse-canvas/conversation-panels.png",
  });
});

test("canvas dividers resize immediately, persist once, support keyboard, and cancel cleanly", async ({
  page,
}) => {
  const main = page.getByTestId("pulse-main-container");
  await expect(main).toHaveCSS("max-width", "960px");
  await add(page, "general", /#general/);
  const divider = page.getByRole("separator", {
    name: "Resize main view and side panels",
  });
  await expect(divider).toBeVisible();
  await page.evaluate(() => {
    const setItem = Storage.prototype.setItem;
    (window as unknown as { canvasWrites: number }).canvasWrites = 0;
    Storage.prototype.setItem = function (key, value) {
      if (key.startsWith("buzz-canvas.v1:"))
        (window as unknown as { canvasWrites: number }).canvasWrites++;
      setItem.call(this, key, value);
    };
  });
  const box = await divider.boundingBox();
  if (!box) throw new Error("Missing divider");
  await page.mouse.move(box.x + box.width / 2, box.y + 100);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 - 140, box.y + 100, { steps: 5 });
  await expect(divider).toHaveAttribute("aria-valuenow", "820");
  expect(
    await page.evaluate(
      () => (window as unknown as { canvasWrites: number }).canvasWrites,
    ),
  ).toBe(0);
  await page.mouse.up();
  expect(
    await page.evaluate(
      () => (window as unknown as { canvasWrites: number }).canvasWrites,
    ),
  ).toBe(1);
  expect((await main.boundingBox())?.width).toBe(820);
  expect((await page.getByTestId("canvas-window").boundingBox())?.width).toBe(
    724,
  );
  await divider.focus();
  await page.keyboard.press("ArrowRight");
  await expect(divider).toHaveAttribute("aria-valuenow", "830");
  await page.keyboard.press("Shift+ArrowRight");
  await expect(divider).toHaveAttribute("aria-valuenow", "870");
  await page.reload();
  await expect(divider).toHaveAttribute("aria-valuenow", "870");
  const restored = await divider.boundingBox();
  if (!restored) throw new Error("Missing restored divider");
  await page.mouse.move(restored.x + restored.width / 2, restored.y + 100);
  await page.mouse.down();
  await page.mouse.move(restored.x - 100, restored.y + 100);
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await expect(divider).toHaveAttribute("aria-valuenow", "870");
  await expect(page.locator("body")).not.toHaveCSS("cursor", "col-resize");
  await divider.focus();
  await page.keyboard.press("Home");
  await expect(divider).toHaveAttribute("aria-valuenow", "240");
  await page.keyboard.press("End");
  await expect(divider).toHaveAttribute("aria-valuenow", "1304");
  expect((await main.boundingBox())?.width).toBe(1304);
  expect((await page.getByTestId("canvas-window").boundingBox())?.width).toBe(
    240,
  );
  await page.reload();
  await expect(divider).toHaveAttribute("aria-valuenow", "1304");
  expect((await main.boundingBox())?.width).toBe(1304);
  await page
    .getByRole("button", { name: "Freeform layout", exact: true })
    .click();
  expect((await main.boundingBox())?.width).toBe(1304);
  await page.getByRole("button", { name: "Focus layout", exact: true }).click();
  await divider.focus();
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("Enter");
  await expect(divider).toHaveAttribute("aria-valuenow", "960");
  await page
    .getByRole("button", { name: "Close #general window", exact: true })
    .click();
  expect((await main.boundingBox())?.width).toBe(960);
});

test("columns resize adjacent panels and a failed save restores the previous widths", async ({
  page,
}) => {
  await add(page, "general", /#general/);
  await add(page, "alice", /Alice/i);
  await page
    .getByRole("button", { name: "Columns layout", exact: true })
    .click();
  const first = page.getByRole("separator", {
    name: "Resize main view and side panels",
  });
  const second = page.getByRole("separator", {
    name: "Resize side panels 1 and 2",
  });
  await expect(first).toHaveAttribute("aria-valuenow", "960");
  await expect(second).toHaveAttribute("aria-valuenow", "288");
  await second.focus();
  await page.keyboard.press("Shift+ArrowRight");
  await expect(second).toHaveAttribute("aria-valuenow", "328");
  await expect(first).toHaveAttribute("aria-valuenow", "960");
  expect(
    (await page.getByTestId("canvas-window").last().boundingBox())?.width,
  ).toBe(248);
  await page.evaluate(() => {
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key.startsWith("buzz-canvas.v1:"))
        throw new DOMException("Full", "QuotaExceededError");
      setItem.call(this, key, value);
    };
  });
  const box = await second.boundingBox();
  if (!box) throw new Error("Missing divider");
  await page.mouse.move(box.x + 6, box.y + 100);
  await page.mouse.down();
  await page.mouse.move(box.x - 40, box.y + 100);
  await page.mouse.up();
  await expect(
    page.getByText("Could not save your canvas. Please try again."),
  ).toBeVisible();
  await expect(second).toHaveAttribute("aria-valuenow", "328");
  await page.setViewportSize({ width: 740, height: 900 });
  await expect(first).toHaveCount(0);
  await expect(second).toHaveCount(0);
  await expect(page.locator("body")).not.toHaveCSS("cursor", "col-resize");
});

async function dragCorner(
  page: Page,
  window: import("@playwright/test").Locator,
  dx: number,
  dy: number,
) {
  // The restored grip's hit area follows the curved stroke outside the corner.
  const path = window.locator("[data-resize-hit]");
  const point = await path.evaluate((element) => {
    const path = element as SVGPathElement;
    const midpoint = path.getPointAtLength(path.getTotalLength() / 2);
    const matrix = path.getScreenCTM();
    if (!matrix) throw new Error("Missing corner transform");
    return new DOMPoint(midpoint.x, midpoint.y)
      .matrixTransform(matrix)
      .toJSON();
  });
  await page.mouse.move(point.x, point.y);
  await waitForAnimations(page);
  const settled = await path.evaluate((element) => {
    const path = element as SVGPathElement;
    const p = path.getPointAtLength(path.getTotalLength() / 2);
    const matrix = path.getScreenCTM();
    if (!matrix) throw new Error("Missing corner transform");
    return new DOMPoint(p.x, p.y).matrixTransform(matrix).toJSON();
  });
  await page.mouse.move(settled.x, settled.y);
  await page.mouse.down();
  await page.mouse.move(settled.x + dx, settled.y + dy, { steps: 8 });
  await page.mouse.up();
}

test("corner resizer restores free sizing, overlapping windows, and return to tiled layouts", async ({
  page,
}) => {
  const canvas = page.getByTestId("pulse-canvas");
  const main = canvas.locator('[data-canvas-frame="main"]');
  await expect(
    main.getByRole("button", { name: "Resize main window", exact: true }),
  ).toBeVisible();
  const initial = await main.boundingBox();
  await dragCorner(page, main, -100, -100);
  await expect(canvas).toHaveAttribute("data-layout", "freeform");
  await expect(
    page.getByRole("button", { name: "Freeform layout", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  const resized = await main.boundingBox();
  expect(resized?.width).toBeCloseTo((initial?.width ?? 0) - 100, 0);
  expect(resized?.height).toBeCloseTo((initial?.height ?? 0) - 100, 0);
  await add(page, "general", /#general/);
  const panel = page.getByRole("region", {
    name: "#general window",
    exact: true,
  });
  await expect(panel.getByTestId("message-input")).toBeVisible();
  await panel
    .getByTestId("message-input")
    .fill("Draft stays through layout changes");
  const move = panel.getByRole("button", {
    name: "Move #general window",
    exact: true,
  });
  const handle = await move.boundingBox();
  const before = await panel.boundingBox();
  if (!handle || !before) throw new Error("Missing freeform window");
  await page.mouse.move(
    handle.x + handle.width / 2,
    handle.y + handle.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    handle.x + handle.width / 2 + 160,
    handle.y + handle.height / 2 + 80,
    { steps: 8 },
  );
  await page.mouse.up();
  const moved = await panel.boundingBox();
  expect(moved?.x).toBeCloseTo(before.x + 160, 0);
  expect(moved?.y).toBeCloseTo(before.y + 80, 0);
  expect(moved?.x).toBeLessThan((resized?.x ?? 0) + (resized?.width ?? 0));
  await dragCorner(page, panel, 80, -60);
  const free = await panel.boundingBox();
  expect(free?.width).toBeCloseTo((moved?.width ?? 0) + 80, 0);
  expect(free?.height).toBeCloseTo((moved?.height ?? 0) - 60, 0);
  await page.getByRole("button", { name: "Grid layout", exact: true }).click();
  await expect(canvas).toHaveAttribute("data-layout", "grid");
  await expect(panel.getByTestId("message-input")).toHaveText(
    "Draft stays through layout changes",
  );
  await expect(
    canvas.getByRole("separator", { name: "Resize main view and side panels" }),
  ).toBeVisible();
  const tiledMain = await main.boundingBox();
  const tiledPanel = await panel.boundingBox();
  expect(tiledPanel?.x).toBeCloseTo(
    (tiledMain?.x ?? 0) + (tiledMain?.width ?? 0) + 8,
    0,
  );
  await page
    .getByRole("button", { name: "Freeform layout", exact: true })
    .click();
  expect(await panel.boundingBox()).toEqual(free);
  await page.reload();
  await expect(canvas).toHaveAttribute("data-layout", "freeform");
  await expect(panel.getByTestId("message-input")).toBeVisible();
  expect(await panel.boundingBox()).toEqual(free);
  await waitForAnimations(page);
  await page.screenshot({ path: "test-results/pulse-canvas/freeform.png" });
});

test("freeform keyboard movement, cancellation, stacking, viewport bounds, and close cleanup", async ({
  page,
}) => {
  await add(page, "general", /#general/);
  await page
    .getByRole("button", { name: "Freeform layout", exact: true })
    .click();
  const canvas = page.getByTestId("pulse-canvas");
  const panel = page.getByRole("region", {
    name: "#general window",
    exact: true,
  });
  const mover = panel.getByRole("button", {
    name: "Move #general window",
    exact: true,
  });
  await mover.focus();
  await page.keyboard.press("Shift+ArrowLeft");
  await page.keyboard.press("Shift+ArrowDown");
  const before = await panel.boundingBox();
  const handle = await mover.boundingBox();
  if (!before || !handle) throw new Error("Missing movable window");
  await page.mouse.move(handle.x + 20, handle.y + 12);
  await page.mouse.down();
  await page.mouse.move(handle.x - 150, handle.y + 30, { steps: 3 });
  await page.keyboard.press("Escape");
  await page.mouse.up();
  expect(await panel.boundingBox()).toEqual(before);
  await expect(page.locator("body")).not.toHaveCSS("cursor", "grabbing");
  const mainMover = canvas.getByRole("button", {
    name: "Move Messages window",
    exact: true,
  });
  await mainMover.focus();
  await page.keyboard.press("ArrowRight");
  const mainZ = await mainMover.evaluate((element) => {
    const window = element.closest(".pulse-canvas-primary");
    if (!window) throw new Error("Missing main window");
    return Number(getComputedStyle(window).zIndex);
  });
  expect(mainZ).toBeGreaterThan(
    Number(await panel.evaluate((element) => getComputedStyle(element).zIndex)),
  );
  await mover.focus();
  expect(
    Number(await panel.evaluate((element) => getComputedStyle(element).zIndex)),
  ).toBeGreaterThan(1);
  const resize = panel.getByRole("button", {
    name: "Resize #general window",
    exact: true,
  });
  await resize.focus();
  await page.keyboard.press("Shift+ArrowLeft");
  await page.keyboard.press("Shift+ArrowUp");
  expect((await panel.boundingBox())?.width).toBeCloseTo(before.width - 40, 0);
  await page.setViewportSize({ width: 740, height: 700 });
  await expect
    .poll(async () => {
      const rect = await panel.boundingBox();
      return (
        rect &&
        rect.x >= 24 &&
        rect.y >= 72 &&
        rect.x + rect.width <= 716 &&
        rect.y + rect.height <= 676
      );
    })
    .toBe(true);
  const id = await panel.getAttribute("data-view-id");
  await panel
    .getByRole("button", { name: "Close #general window", exact: true })
    .click();
  const stored = await page.evaluate(() =>
    JSON.parse(
      Object.entries(localStorage).find(([key]) =>
        key.startsWith("buzz-canvas.v1:"),
      )?.[1] ?? "{}",
    ),
  );
  if (!id) throw new Error("Missing window id");
  expect(stored.freeform.frames[id]).toBeUndefined();
  expect(stored.freeform.order).not.toContain(id);
});

test("standalone Freeform stretches past reading widths and uses an exterior unframed grip", async ({
  page,
}) => {
  const canvas = page.getByTestId("pulse-canvas");
  const main = canvas.locator('[data-canvas-frame="main"]');
  await dragCorner(page, main, 250, -100);
  await expect(canvas).toHaveAttribute("data-layout", "freeform");
  expect((await main.boundingBox())?.width).toBe(1210);
  await expect(page.getByTestId("pulse-main-container")).toHaveCSS(
    "max-width",
    "none",
  );
  const handle = main.getByRole("button", {
    name: "Move Messages window",
    exact: true,
  });
  await expect(handle).toHaveText("");
  const grip = handle.locator("svg");
  await page.getByTestId("canvas-add-view").focus();
  await page.mouse.move(5, 5);
  await expect(grip).toHaveCSS("opacity", "0.5");
  await expect(handle).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  const rect = await main.boundingBox();
  const handleRect = await handle.boundingBox();
  if (!rect || !handleRect) throw new Error("Missing frame or grip");
  expect(handleRect.x + handleRect.width).toBeLessThanOrEqual(rect.x);
  expect(handleRect.y + handleRect.height).toBeLessThanOrEqual(rect.y);
  await handle.hover();
  await expect(grip).toHaveCSS("opacity", "0.8");
  await expect(handle).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  await page.mouse.move(5, 5);
  await handle.focus();
  await expect(handle).toBeFocused();
  await expect(grip).toHaveCSS("opacity", "0.5");
  await page.keyboard.press("ArrowLeft");
  await page.reload();
  await expect(canvas).toHaveAttribute("data-layout", "freeform");
  expect((await main.boundingBox())?.width).toBe(1210);
  await page
    .getByTestId("pulse-app-navigation")
    .getByRole("button", { name: "Messages", exact: true })
    .click();
  await page
    .getByRole("dialog", { name: "Messages destinations" })
    .getByRole("button", { name: "Open Messages", exact: true })
    .click();
  await expect(
    main.getByRole("button", { name: "Move Messages window", exact: true }),
  ).toHaveText("");
  expect((await main.boundingBox())?.width).toBe(1210);
  await page.getByRole("button", { name: "Focus layout", exact: true }).click();
  expect((await main.boundingBox())?.width).toBe(960);
});

test("new widgets enter above previously focused windows and keep their stacking on reload", async ({
  page,
}) => {
  const canvas = page.getByTestId("pulse-canvas");
  const main = canvas.locator('[data-canvas-frame="main"]');
  await dragCorner(page, main, -100, -100);
  await add(page, "weather", /^Weather Widgets$/);
  const weather = page.getByRole("region", {
    name: "Weather window",
    exact: true,
  });
  // Click without moving: this exercises the temporary focus order, not saved order.
  await main
    .getByRole("button", { name: "Move Messages window", exact: true })
    .focus();
  const z = async (selector: string) =>
    canvas
      .locator(selector)
      .evaluate((el) => Number(getComputedStyle(el).zIndex));
  expect(await z(".pulse-canvas-primary")).toBeGreaterThan(
    await z('[data-view-id="widget:weather"]'),
  );
  await add(page, "music", /^Music Widgets$/);
  const music = page.getByRole("region", { name: "Music window", exact: true });
  await expect(music).toBeVisible();
  expect(await z('[data-view-id="widget:music"]')).toBeGreaterThan(
    await z(".pulse-canvas-primary"),
  );
  expect(await z('[data-view-id="widget:music"]')).toBeGreaterThan(
    await z('[data-view-id="widget:weather"]'),
  );
  await page.reload();
  await expect(music).toBeVisible();
  expect(await z('[data-view-id="widget:music"]')).toBeGreaterThan(
    await z(".pulse-canvas-primary"),
  );
  await music
    .getByRole("button", { name: "Close Music window", exact: true })
    .click();
  await weather
    .getByRole("button", { name: "Move Weather window", exact: true })
    .focus();
  await add(page, "music", /^Music Widgets$/);
  expect(await z('[data-view-id="widget:music"]')).toBeGreaterThan(
    await z('[data-view-id="widget:weather"]'),
  );
});

test("Home stays centered at 720px across layouts, widget gestures, reloads and viewport changes", async ({
  page,
}) => {
  const canvas = page.getByTestId("pulse-canvas");
  const main = page.getByTestId("pulse-main-container");
  // Start with a saved moved/stretched Messages frame, then visit Home.
  await dragCorner(
    page,
    canvas.locator('[data-canvas-frame="main"]'),
    150,
    -100,
  );
  const messageFrame = await main.boundingBox();
  const select = async (name: string) => {
    await page
      .getByTestId("pulse-app-navigation")
      .getByRole("button", { name, exact: true })
      .click();
    await page
      .getByRole("dialog", { name: `${name} destinations` })
      .getByRole("button", { name: `Open ${name}`, exact: true })
      .click();
  };
  const centered = async (width = 1600, height = 1000) => {
    await expect(main).toHaveCSS("max-width", "720px");
    await expect
      .poll(async () => await main.boundingBox())
      .toEqual({
        x: (width - Math.min(720, width - 48)) / 2,
        y: 72,
        width: Math.min(720, width - 48),
        height: height - 96,
      });
    await expect(
      canvas.locator('[data-canvas-frame="main"] [data-canvas-gesture]'),
    ).toHaveCount(0);
    await expect(canvas.getByRole("separator")).toHaveCount(0);
  };
  await select("Home");
  await centered();
  await add(page, "weather", /^Weather Widgets$/);
  const weather = page.getByRole("region", {
    name: "Weather window",
    exact: true,
  });
  await centered();
  await weather
    .getByRole("button", { name: "Move Weather window", exact: true })
    .focus();
  await page.keyboard.press("Shift+ArrowRight");
  await dragCorner(page, weather, 60, -60);
  await centered();
  // Clicking Home does not raise it over floating widgets.
  await main.click({ position: { x: 600, y: 20 } });
  expect(
    Number(await weather.evaluate((el) => getComputedStyle(el).zIndex)),
  ).toBeGreaterThan(
    Number(
      await canvas
        .locator(".pulse-canvas-primary")
        .evaluate((el) => getComputedStyle(el).zIndex),
    ),
  );
  await select("Messages");
  expect(await main.boundingBox()).toEqual(messageFrame);
  await select("Home");
  await add(page, "music", /^Music Widgets$/);
  for (const name of ["Focus", "Grid", "Columns", "Freeform"]) {
    await page
      .getByRole("button", { name: `${name} layout`, exact: true })
      .click();
    await centered();
  }
  await page.reload();
  await centered();
  await page.setViewportSize({ width: 740, height: 700 });
  await centered(740, 700);
  await page.setViewportSize({ width: 1800, height: 1000 });
  await centered(1800, 1000);
  await waitForAnimations(page);
  await page.screenshot({
    path: "test-results/pulse-canvas/anchored-home.png",
  });
});

test("widget grips stay outside their windows and dragging lifts a tiled widget into Freeform", async ({
  page,
}) => {
  await page.goto("/#/pulse");
  await add(page, "weather", /^Weather Widgets$/);
  const panel = page.getByRole("region", {
    name: "Weather window",
    exact: true,
  });
  const mover = panel.getByRole("button", {
    name: "Move Weather window",
    exact: true,
  });
  const checkGrip = async () => {
    await expect(mover).toHaveText("");
    await expect(panel.locator("header [data-canvas-gesture]")).toHaveCount(0);
    const windowBox = await panel.boundingBox();
    const gripBox = await mover.boundingBox();
    if (!windowBox || !gripBox) throw new Error("Missing widget or grip");
    expect(gripBox.x + gripBox.width).toBeLessThanOrEqual(windowBox.x);
    expect(gripBox.y + gripBox.height).toBeLessThanOrEqual(windowBox.y);
    return { windowBox, gripBox };
  };
  const { windowBox, gripBox } = await checkGrip();
  await page.mouse.move(gripBox.x + 12, gripBox.y + 12);
  await page.mouse.down();
  await expect(mover).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  await page.mouse.move(gripBox.x - 68, gripBox.y + 72, { steps: 5 });
  await page.mouse.up();
  await expect(page.getByTestId("pulse-canvas")).toHaveAttribute(
    "data-layout",
    "freeform",
  );
  const moved = await checkGrip();
  expect(moved.windowBox.x).toBeCloseTo(windowBox.x - 80, 0);
  expect(moved.windowBox.y).toBeCloseTo(windowBox.y + 60, 0);
  await mover.focus();
  await page.keyboard.press("ArrowLeft");
  expect((await panel.boundingBox())?.x).toBeCloseTo(windowBox.x - 90, 0);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.getByTestId("canvas-add-view").focus();
  await mover.hover();
  await expect(mover).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  await expect(mover.locator("svg")).toHaveCSS("opacity", "0.8");
  await waitForAnimations(page);
  await page.screenshot({
    path: "test-results/pulse-canvas/exterior-widget-grip.png",
  });
});
