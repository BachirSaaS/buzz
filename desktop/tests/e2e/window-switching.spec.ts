import { expect, test, type Page, type Locator } from "@playwright/test";
import { installMockBridge } from "../helpers/bridge";
import { arrangeWindows, readActiveCanvas } from "../helpers/canvas";
import { waitForAnimations } from "../helpers/animations";

async function add(page: Page, query: string, name: RegExp) {
  await page.getByTestId("canvas-add-view").click();
  const picker = page.getByRole("dialog", { name: "Add a window" });
  await picker.getByRole("textbox", { name: "Search views" }).fill(query);
  await picker.getByRole("button", { name }).click();
}
const menu = (page: Page) =>
  page.getByRole("dialog", { name: "Switch window view" });
async function area(page: Page, window: Locator, name: string) {
  await window.getByRole("button", { name: /^Switch view,/ }).click();
  await menu(page).getByRole("button", { name, exact: true }).click();
}
test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.route("**/__pulse/briefing", (r) =>
    r.fulfill({ json: { highlights: [] } }),
  );
  await page.route("**/__chief", (r) => r.fulfill({ status: 503, json: {} }));
  await installMockBridge(page);
  await page.goto("/#/pulse?feed=conversation");
  await expect(page.getByTestId("canvas-add-view")).toBeEnabled();
});

test("a floating widget swaps locally, retains its frame, and restores after reload", async ({
  page,
}) => {
  await add(page, "weather", /^Weather Widgets$/);
  await arrangeWindows(page, "Freeform");
  const widget = page.locator('[data-content-id="widget:weather"]');
  const frame = page.locator('[data-floating-frame="widget:weather"]');
  const before = await frame.boundingBox();
  const snapshot = await readActiveCanvas(page);
  const url = page.url();
  await area(page, widget, "Agents");
  await menu(page)
    .getByRole("button", { name: "Open Agents", exact: true })
    .click();
  await expect(widget.getByTestId("pulse-workspace-agents")).toBeVisible();
  await expect(
    page.locator('[data-content-id="main"]').getByTestId("pulse-combined-view"),
  ).toBeVisible();
  expect(page.url()).toBe(url);
  expect(await frame.boundingBox()).toEqual(before);
  const after = await readActiveCanvas(page);
  expect(after.windows).toEqual(snapshot.windows);
  expect(after.freeform).toEqual(snapshot.freeform);
  await page.reload();
  await expect(widget.getByTestId("pulse-workspace-agents")).toBeVisible();
  expect(await frame.boundingBox()).toEqual(before);
  await area(page, widget, "Projects");
  await menu(page)
    .getByRole("button", { name: "Open project buzz", exact: true })
    .click();
  await expect(widget.getByTestId("project-channel-home")).toBeVisible();
});

test("connected empty panes and conversation panes can swap without disturbing their parent", async ({
  page,
}) => {
  await add(page, "general", /#general/);
  const channel = page.getByRole("region", {
    name: "#general view",
    exact: true,
  });
  await channel.getByTestId("message-input").fill("Keep the parent's draft");
  await channel
    .getByRole("button", { name: "Split #general window", exact: true })
    .click();
  const empty = page.locator('[data-content-id^="empty:"]');
  await expect(empty).toBeVisible();
  const id = await empty.getAttribute("data-content-id");
  const before = await empty.boundingBox();
  const snapshot = await readActiveCanvas(page);
  await area(page, empty, "Messages");
  await menu(page)
    .getByRole("button", { name: /^Open channel / })
    .first()
    .click();
  await expect(empty.getByTestId("message-input")).toBeVisible();
  await expect(empty.getByTestId("pulse-combined-view")).toHaveCount(0);
  await expect(channel.getByTestId("message-input")).toHaveText(
    "Keep the parent's draft",
  );
  expect(await empty.boundingBox()).toEqual(before);
  expect((await readActiveCanvas(page)).interiors).toEqual(snapshot.interiors);
  await area(page, empty, "Agents");
  await menu(page)
    .getByRole("button", { name: "Open Agents", exact: true })
    .click();
  await expect(empty.getByTestId("pulse-workspace-agents")).toBeVisible();
  await page.reload();
  const restored = page.locator(`[data-content-id="${id}"]`);
  await expect(restored.getByTestId("pulse-workspace-agents")).toBeVisible();
  expect(await restored.boundingBox()).toEqual(before);
});

test("a failed swap keeps the old content and menu available for retry", async ({
  page,
}) => {
  await add(page, "weather", /^Weather Widgets$/);
  const widget = page.locator('[data-content-id="widget:weather"]');
  const before = await readActiveCanvas(page);
  await area(page, widget, "Agents");
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key.startsWith("buzz-workspaces.v1:")) {
        Storage.prototype.setItem = original;
        throw new DOMException("Full", "QuotaExceededError");
      }
      original.call(this, key, value);
    };
  });
  await menu(page)
    .getByRole("button", { name: "Open Agents", exact: true })
    .click();
  await expect(menu(page)).toBeVisible();
  await expect(
    widget.getByRole("button", { name: "Switch view, Weather" }),
  ).toBeVisible();
  expect(await readActiveCanvas(page)).toEqual(before);
  await menu(page)
    .getByRole("button", { name: "Open Agents", exact: true })
    .click();
  await expect(widget.getByTestId("pulse-workspace-agents")).toBeVisible();
  await expect(menu(page)).toHaveCount(0);
});

test("grouped window titles swap with keyboard while retaining all tabs and their content", async ({
  page,
}) => {
  await add(page, "weather", /^Weather Widgets$/);
  await add(page, "general", /#general/);
  await arrangeWindows(page, "Columns");
  await page.evaluate(() => {
    const entry = Object.entries(localStorage).find(([key]) =>
      key.startsWith("buzz-workspaces.v1:"),
    );
    if (!entry) throw new Error("Missing workspace");
    const state = JSON.parse(entry[1]);
    const canvas = state.items.find(
      (item: { id: string }) => item.id === state.active,
    ).canvas;
    canvas.panels["workspace:columns"] = {
      root: { type: "pane", id: "main" },
      groups: [
        {
          id: "main",
          tabs: ["main", ...canvas.windows],
          selected: "widget:weather",
        },
      ],
    };
    localStorage.setItem(entry[0], JSON.stringify(state));
  });
  await page.reload();
  const tabs = page.getByRole("tablist", { name: "Window tabs" });
  const weather = tabs.getByRole("tab", { name: "Weather", exact: true });
  await weather.focus();
  await page.keyboard.press("Enter");
  await expect(
    menu(page).getByRole("button", { name: "Messages", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await expect(
    page
      .locator('[data-content-id="widget:weather"]')
      .getByTestId("pulse-combined-view"),
  ).toBeVisible();
  await expect(tabs.getByRole("tab")).toHaveCount(3);
  const general = tabs.getByRole("tab", { name: "#general", exact: true });
  await general.click();
  await expect(menu(page)).toHaveCount(0);
  await expect(page.getByTestId("message-input")).toBeVisible();
  await general.focus();
  await page.keyboard.press("ArrowLeft");
  await expect(tabs.getByRole("tab").nth(1)).toBeFocused();
  await expect(tabs.getByRole("tab").nth(1)).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await page.keyboard.press("Enter");
  await expect(menu(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(tabs.getByRole("tab").nth(1)).toBeFocused();
  await waitForAnimations(page);
  await page.screenshot({ path: "test-results/window-switching/grouped.png" });
});

test("a DM window has the same title switcher", async ({ page }) => {
  await add(page, "alice", /^alice Direct messages$/);
  const dm = page.getByRole("region", { name: "alice view", exact: true });
  const id = await dm.getAttribute("data-content-id");
  await area(page, dm, "Projects");
  await menu(page)
    .getByRole("button", { name: "Open Projects", exact: true })
    .click();
  await expect(
    page
      .locator(`[data-content-id="${id}"]`)
      .getByTestId("pulse-workspace-projects"),
  ).toBeVisible();
});
