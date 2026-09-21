import { expect, test, type Page } from "@playwright/test";
import { installMockBridge } from "../helpers/bridge";
import {
  arrangeWindows,
  openWindowPicker,
  expectCanAddWindow,
} from "../helpers/canvas";
import { waitForAnimations } from "../helpers/animations";
async function add(page: Page, name: string) {
  await openWindowPicker(page);
  const dialog = page.getByRole("dialog", { name: "Add a window" });
  await dialog.getByRole("textbox", { name: "Search views" }).fill(name);
  await dialog
    .getByRole("button", { name: `${name} Widgets`, exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
}
const tab = (page: Page, name: string) =>
  page.getByRole("tab", { name, exact: true });
const window = (page: Page, id: string) =>
  page.locator(`[data-content-id="widget:${id}"]`);
async function store(page: Page) {
  return page.evaluate(() =>
    JSON.parse(
      Object.entries(localStorage).find(([key]) =>
        key.startsWith("buzz-workspaces.v1:"),
      )?.[1] ?? "{}",
    ),
  );
}
test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.route("**/__pulse/briefing", (r) =>
    r.fulfill({ json: { highlights: [] } }),
  );
  await page.route("**/__chief", (r) => r.fulfill({ status: 503, json: {} }));
  await installMockBridge(page);
  await page.goto("/#/pulse");
  await expect(tab(page, "Home")).toHaveAttribute("aria-selected", "true");
  await expect(page).toHaveURL(/workspace=home/);
});
test("windows, connected splits, layouts and selected views belong to their workspace", async ({
  page,
}) => {
  await add(page, "Weather");
  await expect(window(page, "weather")).toBeVisible();
  await tab(page, "Messages").click();
  await expect(window(page, "weather")).toHaveCount(0);
  await page
    .getByRole("button", { name: "Split Messages window", exact: true })
    .click();
  const empty = page.getByTestId("empty-split-view");
  await empty.getByRole("textbox", { name: "Search views" }).fill("Music");
  await empty
    .getByRole("button", { name: "Music Widgets", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Switch view, Messages", exact: true })
    .click();
  const menu = page.getByRole("dialog", { name: "Switch window view" });
  await menu.getByRole("button", { name: "Projects", exact: true }).click();
  await menu
    .getByRole("button", { name: "Open project buzz", exact: true })
    .click();
  await expect(tab(page, "Messages")).toHaveAttribute("aria-selected", "true");
  await expect(
    page.getByRole("button", { name: "Switch view, Projects", exact: true }),
  ).toBeVisible();
  await expect(window(page, "music")).toBeVisible();
  // Canonical navigation inside a project must retain this workspace too.
  await page
    .getByTestId("pulse-projects-list")
    .getByRole("button", { name: "Open project buzz", exact: true })
    .click();
  await expect(tab(page, "Messages")).toHaveAttribute("aria-selected", "true");
  await expect(window(page, "music")).toBeVisible();
  const saved = (await store(page)).items.find(
    (item: { id: string }) => item.id === "messages",
  );
  await tab(page, "Home").click();
  await expect(window(page, "weather")).toBeVisible();
  await expect(window(page, "music")).toHaveCount(0);
  await tab(page, "Messages").click();
  await expect(page.getByTestId("pulse-workspace-projects")).toBeVisible();
  await expect(window(page, "music")).toBeVisible();
  expect(
    (await store(page)).items.find(
      (item: { id: string }) => item.id === "messages",
    ).canvas,
  ).toEqual(saved.canvas);
  await page.reload();
  await expect(tab(page, "Messages")).toHaveAttribute("aria-selected", "true");
  await expect(window(page, "music")).toBeVisible();
  await expect(page.getByTestId("pulse-workspace-projects")).toBeVisible();
  await waitForAnimations(page);
  await page.screenshot({ path: "test-results/workspaces/isolated.png" });
});
test("create, rename with keyboard, close and browser history preserve neighboring workspaces", async ({
  page,
}) => {
  await add(page, "Weather");
  await page
    .getByRole("button", { name: "New workspace", exact: true })
    .click();
  await page.getByRole("button", { name: "Custom", exact: true }).click();
  const custom = tab(page, "Workspace 1");
  await expect(custom).toHaveAttribute("aria-selected", "true");
  await expect(window(page, "weather")).toHaveCount(0);
  await expect(page.getByTestId("empty-workspace")).toBeVisible();
  await expect(page.locator("[data-content-id=main]")).toHaveCount(0);
  await custom.focus();
  await page.keyboard.press("F2");
  const input = page.getByRole("textbox", { name: "Workspace name" });
  await input.fill("Design desk");
  await input.press("Enter");
  await expect(tab(page, "Design desk")).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await add(page, "Activity");
  await tab(page, "Home").click();
  await expect(window(page, "weather")).toBeVisible();
  await page.goBack();
  await expect(tab(page, "Design desk")).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(window(page, "activity")).toBeVisible();
  await page.reload();
  await expect(tab(page, "Design desk")).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(window(page, "activity")).toBeVisible();
  await tab(page, "Design desk").click({ button: "right" });
  await page
    .getByRole("menuitem", { name: "Close workspace", exact: true })
    .click();
  await expect(tab(page, "Design desk")).toHaveCount(0);
  await tab(page, "Home").click();
  await expect(window(page, "weather")).toBeVisible();
});
test("legacy shared canvas migrates into Home only", async ({ page }) => {
  await page.evaluate(() => {
    const key = Object.keys(localStorage).find((key) =>
      key.startsWith("buzz-workspaces.v1:"),
    );
    if (!key) throw new Error("Missing workspace store");
    localStorage.setItem(
      key.replace("buzz-workspaces.v1:", "buzz-canvas.v1:"),
      JSON.stringify({ layout: "freeform", windows: ["widget:weather"] }),
    );
    localStorage.removeItem(key);
  });
  await page.reload();
  await expect(window(page, "weather")).toBeVisible();
  await expect(page.getByTestId("pulse-canvas")).toHaveAttribute(
    "data-layout",
    "freeform",
  );
  await tab(page, "Messages").click();
  await expect(window(page, "weather")).toHaveCount(0);
  await expect(page.getByTestId("pulse-canvas")).toHaveAttribute(
    "data-layout",
    "focus",
  );
  await tab(page, "Home").click();
  await expect(window(page, "weather")).toBeVisible();
});
test("failed workspace creation is retryable and leaves ownership unchanged", async ({
  page,
}) => {
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (
        key.startsWith("buzz-workspaces.v1:") &&
        !(globalThis as unknown as { allowWorkspaceSave: boolean })
          .allowWorkspaceSave
      )
        throw new Error("storage unavailable");
      return original.call(this, key, value);
    };
  });
  await page
    .getByRole("button", { name: "New workspace", exact: true })
    .click();
  await page.getByRole("button", { name: "Custom", exact: true }).click();
  await expect(tab(page, "Workspace 1")).toHaveCount(0);
  await expect(tab(page, "Home")).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Escape");
  await page.evaluate(() => {
    (
      globalThis as unknown as { allowWorkspaceSave: boolean }
    ).allowWorkspaceSave = true;
  });
  await page
    .getByRole("button", { name: "New workspace", exact: true })
    .click();
  await page.getByRole("button", { name: "Custom", exact: true }).click();
  await expect(tab(page, "Workspace 1")).toHaveAttribute(
    "aria-selected",
    "true",
  );
});

test("empty workspaces host independent core apps and preserve their own navigation", async ({
  page,
}) => {
  await page
    .getByRole("button", { name: "New workspace", exact: true })
    .click();
  await page.getByRole("button", { name: "Custom", exact: true }).click();
  await expect(page.getByTestId("empty-workspace")).toBeVisible();
  await page.reload();
  await expect(page.getByTestId("empty-workspace")).toBeVisible();
  await expect(page.locator("[data-content-id=main]")).toHaveCount(0);
  const workspaceUrl = page.url();
  await page.getByRole("button", { name: "Add your first window" }).click();
  const picker = page.getByRole("dialog", { name: "Add a window" });
  const categories = picker.getByRole("navigation", {
    name: "Window categories",
  });
  await categories
    .getByRole("button", { name: "Messages", exact: true })
    .click();
  await expect(
    picker.getByRole("button", { name: "Messages Full apps", exact: true }),
  ).toBeVisible();
  await expect(
    picker.getByRole("heading", { name: "Channels", exact: true }),
  ).toBeVisible();
  await expect(
    picker.getByRole("heading", { name: "Direct messages", exact: true }),
  ).toBeVisible();
  await expect(
    picker.locator('[data-widget][data-size="small"]').first(),
  ).toBeVisible();
  await picker
    .getByRole("button", { name: "Messages Full apps", exact: true })
    .click();
  const messages = page.locator('[data-content-id="app:messages"]');
  await expect(messages.getByTestId("pulse-combined-view")).toBeVisible();
  await messages
    .getByRole("button", { name: "Open channel random", exact: true })
    .click();
  await expect(messages.getByTestId("pulse-message-view")).toBeVisible();
  expect(page.url()).toBe(workspaceUrl);
  await openWindowPicker(page);
  await categories
    .getByRole("button", { name: "Projects", exact: true })
    .click();
  await picker
    .getByRole("button", { name: "Projects Full apps", exact: true })
    .click();
  const projects = page.locator('[data-content-id="app:projects"]');
  await projects
    .getByRole("button", { name: "Open project buzz", exact: true })
    .click();
  await expect(projects.getByTestId("pulse-workspace-projects")).toBeVisible();
  await expect(projects.getByTestId("project-channel-home")).toBeVisible();
  expect(page.url()).toBe(workspaceUrl);
  const saved = (await store(page)).items.find(
    (item: { name: string }) => item.name === "Workspace 1",
  ).canvas;
  expect(saved.routes["app:projects"].projectId).toBeTruthy();
  expect(saved.routes["app:messages"].conversation).toBeTruthy();
  await tab(page, "Home").click();
  await expect(messages).toHaveCount(0);
  await tab(page, "Workspace 1").click();
  await page.reload();
  await expect(messages.getByTestId("pulse-message-view")).toBeVisible();
  await expect(projects.getByTestId("pulse-workspace-projects")).toBeVisible();
  await expect(page.locator("[data-content-id=main]")).toHaveCount(0);
  expect(
    (await store(page)).items.find(
      (item: { name: string }) => item.name === "Workspace 1",
    ).canvas,
  ).toEqual(saved);
  await expect(projects.getByTestId("project-channel-home")).toBeVisible();
  await waitForAnimations(page);
  await page.screenshot({ path: "test-results/workspaces/core-windows.png" });
  await projects
    .getByRole("button", { name: "Close Projects window", exact: true })
    .click();
  await messages
    .getByRole("button", { name: "Close Messages window", exact: true })
    .click();
  await expect(page.getByTestId("empty-workspace")).toBeVisible();
  const empty = (await store(page)).items.find(
    (item: { name: string }) => item.name === "Workspace 1",
  ).canvas;
  expect(empty.routes).toEqual({});
});

test("a widget can be the first window and connect to a full app without an implicit main", async ({
  page,
}) => {
  await page
    .getByRole("button", { name: "New workspace", exact: true })
    .click();
  await page.getByRole("button", { name: "Custom", exact: true }).click();
  await add(page, "Weather");
  await page
    .getByRole("button", { name: "Split Weather window", exact: true })
    .click();
  const picker = page.getByTestId("empty-split-view");
  await picker
    .getByRole("navigation", { name: "Window categories" })
    .getByRole("button", { name: "Agents", exact: true })
    .click();
  await expect(
    picker.getByRole("button", { name: "Agents Full apps", exact: true }),
  ).toBeVisible();
  await picker
    .getByRole("button", { name: "Agents Full apps", exact: true })
    .click();
  await expect(page.getByTestId("pulse-workspace-agents")).toBeVisible();
  await expect(page.locator("[data-parent-interior]")).toHaveCount(1);
  await page.reload();
  await expect(page.getByTestId("pulse-workspace-agents")).toBeVisible();
  await expect(page.locator("[data-content-id=main]")).toHaveCount(0);
  await page
    .getByRole("button", { name: "Close Weather window", exact: true })
    .click();
  await expect(page.getByTestId("pulse-workspace-agents")).toBeVisible();
  await expect(page.locator('[data-parent-interior="app:agents"]')).toHaveCount(
    1,
  );
});

test("four explicit windows survive freeform and tiled layouts without a phantom main", async ({
  page,
}) => {
  await page
    .getByRole("button", { name: "New workspace", exact: true })
    .click();
  await page.getByRole("button", { name: "Custom", exact: true }).click();
  await add(page, "Weather");
  await add(page, "Music");
  await add(page, "Location");
  await add(page, "Activity");
  await expectCanAddWindow(page, false);
  await arrangeWindows(page, "Freeform");
  await expect(page.locator("[data-floating-frame]")).toHaveCount(4);
  await expect(page.locator('[data-floating-frame="main"]')).toHaveCount(0);
  await page.reload();
  await expect(page.locator("[data-floating-frame]")).toHaveCount(4);
  await expectCanAddWindow(page, false);
  await arrangeWindows(page, "Grid");
  await expect(page.locator("[data-content-id]")).toHaveCount(4);
  await expect(page.locator("[data-content-id=main]")).toHaveCount(0);
  await page
    .getByRole("button", { name: "Close Music window", exact: true })
    .click();
  await expectCanAddWindow(page, true);
});

test("Home keeps its centered summary when adding apps and widgets", async ({
  page,
}) => {
  const main = page.locator('[data-content-id="main"]');
  const assertSummary = async () => {
    await expect(main.getByTestId("pulse-home")).toBeVisible();
    await expect(
      main.getByRole("button", { name: /^Switch view,/ }),
    ).toHaveCount(0);
    await expect
      .poll(async () => {
        const box = await main.boundingBox();
        return box && { x: box.x, width: box.width };
      })
      .toEqual({ x: 400, width: 720 });
  };
  await assertSummary();
  await add(page, "Weather");
  await assertSummary();
  await openWindowPicker(page);
  const picker = page.getByRole("dialog", { name: "Add a window" });
  await picker.getByRole("textbox", { name: "Search views" }).fill("Messages");
  await picker
    .getByRole("button", { name: "Messages Full apps", exact: true })
    .click();
  await expect(page.locator('[data-content-id="app:messages"]')).toBeVisible();
  await expect(main.locator("[data-parent-interior]")).toHaveCount(0);
  for (const layout of ["Grid", "Columns", "Freeform"]) {
    await arrangeWindows(page, layout);
    await assertSummary();
  }
  await tab(page, "Projects").click();
  await tab(page, "Home").click();
  await assertSummary();
  await page.reload();
  await assertSummary();
  await expect(window(page, "weather")).toBeVisible();
  await expect(page.locator('[data-content-id="app:messages"]')).toBeVisible();
  await waitForAnimations(page);
  await page.screenshot({ path: "test-results/workspaces/permanent-home.png" });
});

test("links from Home open Messages without replacing its summary or companions", async ({
  page,
}) => {
  await add(page, "Weather");
  // This is the route used by a Home card opening a channel.
  await page.goto(
    "/#/pulse?workspace=home&feed=conversation&conversation=general",
  );
  await expect(tab(page, "Messages")).toHaveAttribute("aria-selected", "true");
  await expect(page).toHaveURL(/conversation=general/);
  await tab(page, "Home").click();
  await expect(page.getByTestId("pulse-home")).toBeVisible();
  await expect(window(page, "weather")).toBeVisible();
});
