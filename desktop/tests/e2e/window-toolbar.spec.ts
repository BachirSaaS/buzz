import {
  arrangeWindows,
  openWindowPicker,
  expectCanAddWindow,
} from "../helpers/canvas";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { installMockBridge } from "../helpers/bridge";
import { waitForAnimations } from "../helpers/animations";
async function add(page: Page, query: string, name: RegExp) {
  await openWindowPicker(page);
  const dialog = page.getByRole("dialog", { name: "Add a window" });
  await dialog.getByRole("textbox", { name: "Search views" }).fill(query);
  await dialog.getByRole("button", { name }).click();
}
async function box(el: Locator) {
  const result = await el.boundingBox();
  if (!result) throw new Error("Missing window");
  return result;
}
const snapshot = (page: Page) =>
  page.evaluate(() => {
    const state = JSON.parse(
      Object.entries(localStorage).find(([key]) =>
        key.startsWith("buzz-workspaces.v1:"),
      )?.[1] ?? "{}",
    );
    return JSON.stringify(
      state.items?.find((item: { id: string }) => item.id === state.active)
        ?.canvas,
    );
  });
test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.route("**/__pulse/briefing", (r) =>
    r.fulfill({ json: { highlights: [] } }),
  );
  await page.route("**/__chief", (r) => r.fulfill({ status: 503, json: {} }));
  await installMockBridge(page);
  await page.goto("/#/pulse?feed=conversation");
  await expectCanAddWindow(page, true);
});
test("all window types share plain-title toolbars and split actions in every layout", async ({
  page,
}) => {
  await expect(page.getByTestId("window-toolbar")).toHaveCount(1);
  await expect(
    page.getByRole("button", { name: "Split Messages window", exact: true }),
  ).toBeVisible();
  await add(page, "weather", /^Weather Widgets$/);
  await add(page, "general", /#general/);
  for (const layout of ["Focus", "Columns", "Grid", "Freeform"]) {
    await arrangeWindows(page, layout);
    await expect(page.getByTestId("window-toolbar")).toHaveCount(3);
    for (const toolbar of await page.getByTestId("window-toolbar").all()) {
      expect((await box(toolbar)).height).toBe(40);
      await expect(
        toolbar.getByRole("button", { name: /^Split .* window$/ }),
      ).toBeVisible();
      const title = toolbar
        .locator('.panel-window-title, [role="tab"]')
        .first();
      await expect(title).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    }
  }
});
test("plus opens a connected empty pane; choosing content preserves the target and other windows", async ({
  page,
}) => {
  await add(page, "general", /#general/);
  const channel = page.getByRole("region", {
    name: "#general window",
    exact: true,
  });
  await channel.getByTestId("message-input").fill("Keep my existing draft");
  const main = page.locator('[data-pane="main"]'),
    before = await box(main);
  await channel
    .getByRole("button", { name: "Split #general window", exact: true })
    .click();
  const picker = page.getByTestId("empty-split-view");
  await expect(picker).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Add a window" })).toHaveCount(
    0,
  );
  const search = picker.getByRole("textbox", { name: "Search views" });
  await expect(search).toBeFocused();
  expect(await box(main)).toEqual(before);
  const empty = picker.locator("xpath=ancestor::section[@data-content-id]"),
    emptyBox = await box(empty);
  const target = await box(channel.locator("[data-content-id]").first());
  expect(emptyBox.x).toBeCloseTo(target.x + target.width, 0);
  await search.fill("weather");
  await search.press("ArrowDown");
  await expect(
    picker.getByRole("button", { name: /^Weather Widgets/ }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  const weather = page.getByRole("region", {
    name: "Weather view",
    exact: true,
  });
  await expect(weather).toBeVisible();
  expect(await box(weather)).toEqual(emptyBox);
  await expect(channel.getByTestId("message-input")).toHaveText(
    "Keep my existing draft",
  );
  await page.reload();
  await expect(weather).toBeVisible();
  expect(await box(weather)).toEqual(emptyBox);
  await waitForAnimations(page);
  await page.screenshot({ path: "test-results/window-toolbar/connected.png" });
});
test("empty panes survive reload, can be closed, and the last slot can be filled at the limit", async ({
  page,
}) => {
  await page
    .getByRole("button", { name: "Split Messages window", exact: true })
    .click();
  await expect(page.getByTestId("empty-split-view")).toBeVisible();
  await page.reload();
  await expect(page.getByTestId("empty-split-view")).toBeVisible();
  await page
    .getByRole("button", { name: "Close New view window", exact: true })
    .click();
  await expect(page.getByTestId("empty-split-view")).toHaveCount(0);
  await add(page, "weather", /^Weather Widgets$/);
  await add(page, "music", /^Music Widgets$/);
  await page
    .getByRole("button", { name: "Split Music window", exact: true })
    .click();
  await expectCanAddWindow(page, false);
  for (const button of await page
    .getByRole("button", { name: /^Split .* window$/ })
    .all())
    await expect(button).toBeDisabled();
  const empty = page.getByTestId("empty-split-view");
  await empty.getByRole("textbox", { name: "Search views" }).fill("agent");
  await empty.getByRole("button", { name: /^Agent activity Activity/ }).click();
  await expect(
    page.getByRole("region", { name: "Agent activity view", exact: true }),
  ).toBeVisible();
});
test("failed split creation and selection leave a usable retry", async ({
  page,
}) => {
  const before = await snapshot(page);
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    (window as unknown as { failCanvas: boolean }).failCanvas = true;
    Storage.prototype.setItem = function (key, value) {
      if (
        key.startsWith("buzz-workspaces.v1:") &&
        (window as unknown as { failCanvas: boolean }).failCanvas
      )
        throw new DOMException("Full", "QuotaExceededError");
      original.call(this, key, value);
    };
  });
  await page
    .getByRole("button", { name: "Split Messages window", exact: true })
    .click();
  expect(await snapshot(page)).toBe(before);
  await expect(page.getByTestId("empty-split-view")).toHaveCount(0);
  await page.evaluate(() => {
    (window as unknown as { failCanvas: boolean }).failCanvas = false;
  });
  await page
    .getByRole("button", { name: "Split Messages window", exact: true })
    .click();
  const empty = page.getByTestId("empty-split-view");
  await empty.getByRole("textbox", { name: "Search views" }).fill("weather");
  await page.evaluate(() => {
    (window as unknown as { failCanvas: boolean }).failCanvas = true;
  });
  await empty.getByRole("button", { name: /^Weather Widgets/ }).click();
  await expect(empty).toBeVisible();
  await expect(
    empty.getByRole("textbox", { name: "Search views" }),
  ).toHaveValue("weather");
  await page.evaluate(() => {
    (window as unknown as { failCanvas: boolean }).failCanvas = false;
  });
  await empty.getByRole("button", { name: /^Weather Widgets/ }).click();
  await expect(empty).toHaveCount(0);
});

test("connected interiors stay flush and move and resize as a single freeform parent", async ({
  page,
}) => {
  await page
    .getByRole("button", { name: "Resize Messages window se", exact: true })
    .focus();
  await page.keyboard.press("Shift+ArrowUp");
  const parent = page.locator('[data-canvas-frame="main"]');
  const frame = page.locator('[data-floating-frame="main"]');
  const header = page.getByTestId("window-toolbar").first();
  const hb = await box(header);
  await page.mouse.move(hb.x + 100, hb.y + 20);
  await page.mouse.down();
  await page.mouse.move(hb.x + 160, hb.y + 80, { steps: 8 });
  await page.mouse.up();
  await page
    .getByRole("button", { name: "Split Messages window", exact: true })
    .click();
  await expect(page.getByTestId("empty-split-view")).toBeVisible();
  await expect(page.getByTestId("pulse-canvas")).toHaveAttribute(
    "data-layout",
    "freeform",
  );
  await expect(page.locator("[data-canvas-frame]")).toHaveCount(1);
  const views = parent.locator("[data-content-id]");
  const a = await box(views.nth(0)),
    b = await box(views.nth(1));
  expect(b.x).toBeCloseTo(a.x + a.width, 0);
  await expect(parent.locator(".panel-dock-surface").first()).toHaveCSS(
    "border-radius",
    "16px",
  );
  await expect(parent.locator(".panel-dock-surface").first()).toHaveCSS(
    "background-color",
    "rgb(255, 255, 255)",
  );
  await expect(page.getByTestId("pulse-main-container")).toHaveCSS(
    "border-radius",
    "0px",
  );
  await expect(page.locator(".canvas-move-handle")).toHaveCount(0);
  const childHeader = views.nth(1).getByTestId("window-toolbar");
  const ch = await box(childHeader.locator(".panel-dock-header-space"));
  await page.mouse.move(ch.x + 80, ch.y + 20);
  await page.mouse.down();
  await page.mouse.move(ch.x + 120, ch.y + 50, { steps: 8 });
  await page.mouse.up();
  expect((await box(views.nth(0))).x - a.x).toBeCloseTo(40, 0);
  expect((await box(views.nth(1))).x - b.x).toBeCloseTo(40, 0);
  const divider = page.getByRole("separator", {
    name: "Resize connected views 1",
  });
  await divider.focus();
  await divider.press("ArrowLeft");
  expect((await box(views.nth(1))).x).toBeCloseTo(
    (await box(views.nth(0))).x + (await box(views.nth(0))).width,
    0,
  );
  for (const corner of ["nw", "ne", "sw", "se"]) {
    const handle = parent.locator(`[data-corner="${corner}"]`);
    await page.mouse.move(5, 5);
    await header.focus();
    await expect(handle.locator(".window-corner-stroke")).toHaveCSS(
      "opacity",
      "0",
    );
    const hx = corner.includes("w") ? 9 : 23;
    const hy = corner.includes("n") ? 9 : 23;
    await handle.hover({ position: { x: hx, y: hy } });
    await expect(handle.locator(".window-corner-stroke")).toHaveCSS(
      "opacity",
      "0.8",
    );
    const before = await box(frame),
      h = await box(handle);
    const dx = corner.includes("w") ? 20 : -20,
      dy = corner.includes("n") ? 20 : -20;
    await page.mouse.move(h.x + hx, h.y + hy);
    await page.mouse.down();
    await page.mouse.move(h.x + hx + dx, h.y + hy + dy, { steps: 8 });
    await page.mouse.up();
    const after = await box(frame);
    expect(after.width).toBeCloseTo(before.width - 20, 0);
    expect(after.height).toBeCloseTo(before.height - 20, 0);
    expect(corner.includes("w") ? after.x + after.width : after.x).toBeCloseTo(
      corner.includes("w") ? before.x + before.width : before.x,
      0,
    );
    expect(corner.includes("n") ? after.y + after.height : after.y).toBeCloseTo(
      corner.includes("n") ? before.y + before.height : before.y,
      0,
    );
  }
  const before = await snapshot(page),
    fb = await box(frame),
    ch2 = await box(childHeader.locator(".panel-dock-header-space"));
  await page.mouse.move(ch2.x + 70, ch2.y + 20);
  await page.mouse.down();
  await page.mouse.move(ch2.x + 100, ch2.y + 50);
  await page.keyboard.press("Escape");
  await page.mouse.up();
  expect(await snapshot(page)).toEqual(before);
  expect(await box(frame)).toEqual(fb);
  await waitForAnimations(page);
  await page.screenshot({
    path: "test-results/window-toolbar/parent-connected.png",
  });
});
