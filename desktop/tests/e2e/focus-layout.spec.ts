import { expect, test, type Page } from "@playwright/test";
import { installMockBridge } from "../helpers/bridge";
import {
  arrangeWindows,
  openWindowPicker,
  readActiveCanvas,
} from "../helpers/canvas";
import { openCommandInput } from "../helpers/interfaceCommands";
import { waitForAnimations } from "../helpers/animations";

async function add(page: Page, name: string) {
  await openWindowPicker(page);
  const picker = page.getByRole("dialog", { name: "Add a window" });
  await picker.getByRole("textbox", { name: "Search views" }).fill(name);
  await picker
    .getByRole("button", { name: new RegExp(`^${name} Widgets$`, "i") })
    .click();
  await expect(picker).toHaveCount(0);
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.route("**/__pulse/briefing", (route) =>
    route.fulfill({ json: { highlights: [] } }),
  );
  await page.route("**/__pulse/workspace-icons", (route) =>
    route.fulfill({ status: 503 }),
  );
  await installMockBridge(page);
  await page.goto("/#/pulse");
  await expect(
    page.getByRole("tab", { name: "Home", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
});

test("Focus is one centered scroll column and new picker/command windows appear at the top", async ({
  page,
}) => {
  await arrangeWindows(page, "Focus");
  const stack = page.getByRole("region", {
    name: "Focus windows",
    exact: true,
  });
  const main = await page.getByTestId("pulse-main-container").boundingBox();
  if (!main) throw new Error("Home is missing");
  expect(Math.abs(main.x + main.width / 2 - 720)).toBeLessThan(1);
  await add(page, "Weather");
  await add(page, "Music");
  const windows = page.getByTestId("canvas-window");
  await expect(windows).toHaveCount(2);
  await expect(windows.first()).toHaveAttribute("data-view-id", "widget:music");
  expect((await readActiveCanvas(page)).windows).toEqual([
    "widget:music",
    "widget:weather",
  ]);
  const boxes = await windows.evaluateAll((elements) =>
    elements.map((el) => {
      const { x, y, width, height } = el.getBoundingClientRect();
      return { x, y, width, height };
    }),
  );
  expect(boxes[0].width).toBe(720);
  expect(Math.abs(boxes[0].x + boxes[0].width / 2 - 720)).toBeLessThan(1);
  const stackBox = await stack.boundingBox();
  if (!stackBox) throw new Error("Focus scroll area is missing");
  expect(
    Math.abs(
      boxes[0].x + boxes[0].width / 2 - (stackBox.x + stackBox.width / 2),
    ),
  ).toBeLessThan(1);
  expect(boxes[0].x).toBe(boxes[1].x);
  expect(boxes[1].y).toBeGreaterThanOrEqual(boxes[0].y + boxes[0].height + 16);
  const home = await page
    .getByRole("region", { name: "Home summary", exact: true })
    .boundingBox();
  expect(home?.y).toBeGreaterThanOrEqual(boxes[1].y + boxes[1].height);
  await expect(page.locator(".pulse-canvas-divider")).toHaveCount(0);
  await expect
    .poll(() => stack.evaluate((el) => el.scrollHeight > el.clientHeight))
    .toBe(true);
  await stack.evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  await expect
    .poll(() => stack.evaluate((el) => el.scrollTop))
    .toBeGreaterThan(0);

  await page.route("**/__pulse/intent", (route) => {
    const { questions } = route.request().postDataJSON();
    const answers: Record<string, string> = {
      action: "open_windows",
      count: "1",
      target_1: "app:projects",
      layout: "auto",
    };
    return route.fulfill({
      json: Object.fromEntries(
        Object.keys(questions).map((key) => [
          key,
          { choice: answers[key] ?? "none", probability: 0.98, margin: 0.95 },
        ]),
      ),
    });
  });
  const dialog = await openCommandInput(page);
  await dialog
    .getByRole("textbox", { name: "Interface command" })
    .fill("show my projects");
  await dialog
    .getByRole("textbox", { name: "Interface command" })
    .press("Enter");
  await expect(windows).toHaveCount(3);
  await expect(windows.first()).toHaveAttribute("data-view-id", "app:projects");
  await expect.poll(() => stack.evaluate((el) => el.scrollTop)).toBe(0);
  await expect(
    dialog.getByRole("textbox", { name: "Interface command" }),
  ).toBeFocused();
  await waitForAnimations(page);
  await page.screenshot({ path: "test-results/focus-layout/stack.png" });
  await page.reload();
  await expect(windows.first()).toHaveAttribute("data-view-id", "app:projects");
  await expect(stack).toBeVisible();
  await page.setViewportSize({ width: 700, height: 800 });
  const narrow = await windows.first().boundingBox();
  if (!narrow) throw new Error("Focus window is not rendered");
  expect(narrow.width).toBeLessThan(700);
  expect(narrow.x + narrow.width).toBeLessThanOrEqual(700);
  expect(Math.abs(narrow.x + narrow.width / 2 - 350)).toBeLessThan(1);
  const dock = page.getByTestId("pulse-app-navigation");
  const dockBox = await dock.boundingBox();
  if (!dockBox) throw new Error("Dock is missing");
  expect(narrow.x).toBeLessThan(dockBox.x + dockBox.width);
  expect(
    await dock.evaluate((el) => {
      const rect = el.getBoundingClientRect();
      return el.contains(
        document.elementFromPoint(
          rect.x + rect.width / 2,
          rect.y + rect.height / 2,
        ),
      );
    }),
  ).toBe(true);
  await page.getByRole("tab", { name: "Messages", exact: true }).click();
  await expect(
    page.getByRole("tab", { name: "Messages", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
});

test("switching Focus and tiled layouts preserves mounted content", async ({
  page,
}) => {
  await page.getByRole("tab", { name: "Messages", exact: true }).click();
  await add(page, "Music");
  await add(page, "Weather");
  await arrangeWindows(page, "Grid");
  await expect(page.getByTestId("pulse-canvas")).toHaveAttribute(
    "data-layout",
    "grid",
  );
  // Mark the actual mounted main host to detect destructive layout remounts.
  await page.locator('[data-testid="pulse-main-container"]').evaluate((el) => {
    el.dataset.focusContinuity = "retained";
  });
  await arrangeWindows(page, "Focus");
  await expect(
    page.getByRole("region", { name: "Focus windows", exact: true }),
  ).toBeVisible();
  await expect(page.locator('[data-focus-continuity="retained"]')).toHaveCount(
    1,
  );
  await expect(page.getByTestId("canvas-window")).toHaveCount(2);
  await arrangeWindows(page, "Columns");
  await expect(page.getByTestId("pulse-canvas")).toHaveAttribute(
    "data-layout",
    "columns",
  );
  await expect(page.locator('[data-focus-continuity="retained"]')).toHaveCount(
    1,
  );
});

test("workspaces can exceed four windows and keep independent layouts across switches and reload", async ({
  page,
}) => {
  const canvas = page.getByTestId("pulse-canvas");
  for (const name of [
    "Music",
    "Weather",
    "Inbox",
    "News",
    "Location",
    "Activity",
  ])
    await add(page, name);
  await expect(page.getByTestId("canvas-window")).toHaveCount(6);
  const homeIds = (await readActiveCanvas(page)).windows;
  await arrangeWindows(page, "Grid");
  await expect(page.getByTestId("canvas-window")).toHaveCount(6);
  await page.getByRole("tab", { name: "Messages", exact: true }).click();
  await arrangeWindows(page, "Freeform");
  await page.getByRole("tab", { name: "Home", exact: true }).click();
  await expect(canvas).toHaveAttribute("data-layout", "grid");
  expect((await readActiveCanvas(page)).windows).toEqual(homeIds);
  await page.reload();
  await expect(canvas).toHaveAttribute("data-layout", "grid");
  await expect(page.getByTestId("canvas-window")).toHaveCount(6);
  await page.getByRole("tab", { name: "Messages", exact: true }).click();
  await expect(canvas).toHaveAttribute("data-layout", "freeform");
  await page.getByRole("tab", { name: "Home", exact: true }).click();
  await arrangeWindows(page, "Focus");
  await page.route("**/__pulse/intent", (route) => {
    const { questions } = route.request().postDataJSON();
    const answers: Record<string, string> = {
      action: "open_windows",
      count: "1",
      target_1: "app:projects",
      layout: "auto",
    };
    return route.fulfill({
      json: Object.fromEntries(
        Object.keys(questions).map((key) => [
          key,
          { choice: answers[key] ?? "none", probability: 0.98, margin: 0.95 },
        ]),
      ),
    });
  });
  const dialog = await openCommandInput(page);
  await dialog
    .getByRole("textbox", { name: "Interface command" })
    .fill("show my projects");
  await dialog
    .getByRole("textbox", { name: "Interface command" })
    .press("Enter");
  await expect(page.getByTestId("canvas-window")).toHaveCount(7);
  await expect(page.getByTestId("canvas-window").first()).toHaveAttribute(
    "data-view-id",
    "app:projects",
  );
  await page.reload();
  await expect(page.getByTestId("canvas-window")).toHaveCount(7);
  const stack = page.getByRole("region", {
    name: "Focus windows",
    exact: true,
  });
  expect(
    await stack.evaluate((el) =>
      parseFloat(getComputedStyle(el).borderBottomLeftRadius),
    ),
  ).toBeGreaterThan(0);
  await stack.evaluate((el) => {
    el.scrollTop = 120;
  });
  await waitForAnimations(page);
  await page.screenshot({
    path: "test-results/focus-layout/rounded-scroll.png",
  });
});
