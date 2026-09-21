import { openWindowPicker } from "../helpers/canvas";
import { expect, test, type Page } from "@playwright/test";
import { installMockBridge } from "../helpers/bridge";
import { waitForAnimations } from "../helpers/animations";
type WindowAnimation = { id: string; duration: number; frames: Keyframe[] };
async function recordWindowAnimations(page: Page) {
  await page.evaluate(() => {
    const records: WindowAnimation[] = [];
    (
      window as unknown as { windowAnimations: WindowAnimation[] }
    ).windowAnimations = records;
    const original = Element.prototype.animate;
    Element.prototype.animate = function (
      this: Element,
      ...args: Parameters<Element["animate"]>
    ) {
      const element = this as HTMLElement;
      const id =
        element.dataset.contentId ??
        (element.dataset.canvasMotionGhost !== undefined ? "exit" : undefined);
      const options = args[1];
      if (id && records.length < 100)
        records.push({
          id,
          duration:
            typeof options === "object"
              ? Number(options.duration)
              : Number(options),
          frames: args[0] as Keyframe[],
        });
      return original.apply(this, args);
    };
  });
}
const recorded = (page: Page) =>
  page.evaluate(
    () =>
      (window as unknown as { windowAnimations: WindowAnimation[] })
        .windowAnimations,
  );
test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 1000 });
  await page.route("**/__pulse/briefing", (r) =>
    r.fulfill({ json: { highlights: [] } }),
  );
  await page.route("**/__chief", (r) => r.fulfill({ status: 503, json: {} }));
  await installMockBridge(page);
  await page.goto("/#/pulse?feed=conversation");
});
test("categories stay in a left sidebar; grouped previews are one accessible choice each", async ({
  page,
}) => {
  await page
    .getByRole("button", { name: "Split Messages window", exact: true })
    .click();
  const picker = page.getByTestId("empty-split-view");
  await expect(picker.getByText("Choose a view", { exact: true })).toHaveCount(
    0,
  );
  await expect(
    picker.getByText("Open a conversation, project, agent, or widget here."),
  ).toHaveCount(0);
  const filters = picker.getByRole("navigation", { name: "Window categories" });
  const boxes = await filters
    .getByRole("button")
    .evaluateAll((items) =>
      items.map((item) => item.getBoundingClientRect().x),
    );
  expect(new Set(boxes).size).toBe(1);
  await filters.getByRole("button", { name: "Widgets", exact: true }).click();
  await expect(
    picker.getByRole("heading", { name: "Widgets", exact: true }),
  ).toBeVisible();
  const cards = picker.locator(".canvas-view-card");
  expect(await cards.count()).toBeGreaterThan(10);
  await expect(picker.locator(".canvas-preview")).toHaveCount(
    await cards.count(),
  );
  await expect(picker.locator("audio,video")).toHaveCount(0);
  await expect(
    picker.locator(
      '[data-widget][data-size="medium"], [data-widget][data-size="large"]',
    ),
  ).toHaveCount(0);
  expect(
    await picker.locator('[data-widget][data-size="small"]').count(),
  ).toBeGreaterThan(14);
  await expect(
    picker.locator(".canvas-widget-preview:not([inert])"),
  ).toHaveCount(0);
  await expect(
    picker.getByRole("button", { name: "Play", exact: true }),
  ).toHaveCount(0);
  await expect(picker.locator("button button")).toHaveCount(0);
  await waitForAnimations(page);
  await page.screenshot({
    path: "test-results/canvas-picker/inline-gallery.png",
  });
  await picker.getByRole("textbox", { name: "Search views" }).fill("weather");
  await expect(cards).toHaveCount(1);
  await expect(cards.locator('[data-preview="weather"]')).toBeVisible();
  await waitForAnimations(page);
  await page.screenshot({
    path: "test-results/canvas-picker/inline-preview.png",
  });
  await picker
    .getByRole("textbox", { name: "Search views" })
    .press("ArrowDown");
  await expect(cards.locator(".canvas-view-select")).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("region", { name: "Weather view", exact: true }),
  ).toBeVisible();
  await expect(page.getByTestId("empty-split-view")).toHaveCount(0);
});
test("picker opens and closes repeatedly, and new windows animate without blocking their controls", async ({
  page,
}) => {
  await recordWindowAnimations(page);
  const trigger = page.getByTestId("canvas-options");
  for (let i = 0; i < 2; i++) {
    await openWindowPicker(page);
    const dialog = page.getByRole("dialog", { name: "Add a window" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Close", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
  }
  await openWindowPicker(page);
  const dialog = page.getByRole("dialog", { name: "Add a window" });
  await dialog
    .getByRole("navigation", { name: "Window categories" })
    .getByRole("button", { name: "Widgets", exact: true })
    .click();
  await waitForAnimations(page);
  await page.screenshot({ path: "test-results/canvas-picker/gallery.png" });
  await dialog.getByRole("textbox", { name: "Search views" }).fill("weather");
  // Clicking the miniature itself selects the card, rather than its inner controls.
  const miniature = await dialog
    .locator('[data-preview="weather"]')
    .boundingBox();
  if (!miniature) throw new Error("Missing weather preview");
  await page.mouse.click(
    miniature.x + miniature.width / 2,
    miniature.y + miniature.height / 2,
  );
  const added = page.locator('[data-content-id="widget:weather"]');
  await expect(added).toBeVisible();
  expect(
    (await recorded(page)).some(
      (item) =>
        item.id === "widget:weather" &&
        item.duration === 120 &&
        item.frames[0].opacity === 1 &&
        String(item.frames[0].transform).includes("0.995"),
    ),
  ).toBe(true);
  await expect(dialog).toHaveCount(0);
  await added
    .getByRole("button", { name: "Close Weather window", exact: true })
    .click();
  await expect(page.locator("[data-canvas-motion-ghost]")).toHaveCount(0);
  await expect(added).toHaveCount(0);
  expect(
    (await recorded(page)).some(
      (item) => item.id === "exit" && item.duration === 120,
    ),
  ).toBe(true);
  await openWindowPicker(page, true);
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
});
test("reduced motion and keyboard additions retain usable focus and settled window geometry", async ({
  page,
}) => {
  await recordWindowAnimations(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openWindowPicker(page, true);
  const dialog = page.getByRole("dialog", { name: "Add a window" });
  const input = dialog.getByRole("textbox", { name: "Search views" });
  await input.fill("weather");
  await input.press("ArrowDown");
  await page.keyboard.press("Enter");
  const view = page.locator('[data-content-id="widget:weather"]');
  await expect(view).toBeVisible();
  await expect(dialog).toHaveCount(0);
  expect(await recorded(page)).toEqual([]);
  expect(
    await view.evaluate(
      (el) =>
        el.getAnimations().filter((a) => a.playState === "running").length,
    ),
  ).toBe(0);
  await view
    .getByRole("button", { name: "Close Weather window", exact: true })
    .focus();
  await page.keyboard.press("Enter");
  await expect(view).toHaveCount(0);
  await expect(page.locator("[data-canvas-motion-ghost]")).toHaveCount(0);
});

test("window title drills into destinations and switches the main view without losing connected panes", async ({
  page,
}) => {
  await page
    .getByRole("button", { name: "Split Messages window", exact: true })
    .click();
  const picker = page.getByTestId("empty-split-view");
  await picker.getByRole("textbox", { name: "Search views" }).fill("weather");
  await picker
    .getByRole("button", { name: "Weather Widgets", exact: true })
    .click();
  const weather = page.locator('[data-content-id="widget:weather"]');
  await expect(weather).toBeVisible();
  const trigger = page.getByRole("button", {
    name: "Switch view, Messages",
    exact: true,
  });
  await expect(trigger.locator("svg")).toHaveCount(0);
  await trigger.click();
  const menu = page.getByRole("dialog", { name: "Switch window view" });
  await expect(menu).toBeVisible();
  await menu.getByRole("button", { name: "Messages", exact: true }).click();
  await expect(
    menu.getByRole("button", { name: "Open Messages", exact: true }),
  ).toBeFocused();
  await expect(
    menu.getByText("Recent conversations", { exact: true }),
  ).toBeVisible();
  await waitForAnimations(page);
  await page.screenshot({
    path: "test-results/canvas-picker/title-switcher.png",
  });
  await menu
    .getByRole("button", { name: /^Open (DM with|channel) / })
    .first()
    .click();
  await expect(menu).toHaveCount(0);
  await expect(page.getByTestId("pulse-message-view")).toBeVisible();
  await expect(weather).toBeVisible();
  await trigger.click();
  await menu.getByRole("button", { name: "Projects", exact: true }).click();
  await menu
    .getByRole("button", { name: "Open project buzz", exact: true })
    .click();
  await expect(page.getByTestId("pulse-workspace-projects")).toBeVisible();
  await expect(weather).toBeVisible();
  await page.getByRole("button", { name: "Switch view, Projects" }).click();
  await menu.getByRole("button", { name: "Agents", exact: true }).click();
  await menu.getByRole("button", { name: "Open Agents", exact: true }).click();
  await expect(page.getByTestId("pulse-workspace-agents")).toBeVisible();
  await expect(weather).toBeVisible();
});

test("title switcher supports keyboard drill, back, cancel, and direct area selection", async ({
  page,
}) => {
  const trigger = page.getByRole("button", {
    name: "Switch view, Messages",
    exact: true,
  });
  await trigger.focus();
  await page.keyboard.press("Enter");
  const menu = page.getByRole("dialog", { name: "Switch window view" });
  await expect(
    menu.getByRole("button", { name: "Home", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(
    menu.getByRole("button", { name: "Open Messages", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await expect(
    menu.getByRole("button", { name: "Messages", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await expect(
    menu.getByRole("button", { name: "Open Home", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("pulse-home")).toBeVisible();
});
