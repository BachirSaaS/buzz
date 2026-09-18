import { expect, test, type Page } from "@playwright/test";
import { installMockBridge } from "../helpers/bridge";
import { waitForAnimations } from "../helpers/animations";
import { readActiveCanvas } from "../helpers/canvas";

async function pinAlice(page: Page) {
  await page.getByRole("button", { name: "Pin a DM", exact: true }).click();
  const picker = page.getByRole("dialog", { name: "Pin a DM", exact: true });
  await picker
    .getByRole("textbox", { name: "Search DMs to pin" })
    .fill("alice");
  await picker.getByRole("button", { name: "Pin alice", exact: true }).click();
  const chat = page.getByRole("dialog", {
    name: "Chat with alice",
    exact: true,
  });
  await expect(chat.getByTestId("message-input")).toBeVisible();
  return chat;
}
async function preferences(page: Page) {
  return page.evaluate(() =>
    JSON.parse(
      Object.entries(localStorage).find(([key]) =>
        key.startsWith("buzz-pulse-preferences.v1:"),
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
  await expect(page.getByTestId("pulse-home")).toBeVisible();
});

test("Home has floating cards, no accumulator, and canvas controls anchored bottom right", async ({
  page,
}) => {
  const home = page.getByRole("region", { name: "Home summary", exact: true });
  await expect(home.getByTestId("window-toolbar")).toHaveCount(0);
  await expect(home.locator(".panel-dock-surface")).toHaveCount(0);
  await expect(page.getByTestId("pulse-main-container")).toHaveCSS(
    "background-color",
    "rgba(0, 0, 0, 0)",
  );
  await expect(
    page.getByText(
      /Local briefings are unavailable|Start your local Accumulator/,
    ),
  ).toHaveCount(0);
  const box = await home.boundingBox();
  expect(box?.x).toBe(360);
  expect(box?.width).toBe(720);
  const controls = page.getByRole("toolbar", { name: "Canvas controls" });
  const before = await controls.boundingBox();
  expect(before?.y).toBeGreaterThan(900);
  expect((before?.x ?? 0) + (before?.width ?? 0)).toBe(1424);
  await page.getByRole("button", { name: "Arrange windows" }).click();
  await expect(
    page.getByRole("menuitemradio", { name: "Grid layout" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await controls
    .getByRole("button", { name: "Add window", exact: true })
    .click();
  const picker = page.getByRole("dialog", { name: "Add a window" });
  await picker.getByRole("textbox", { name: "Search views" }).fill("weather");
  await picker
    .getByRole("button", { name: "Weather Widgets", exact: true })
    .click();
  await expect(home).toBeVisible();
  await expect(home.getByTestId("window-toolbar")).toHaveCount(0);
  await page.getByRole("tab", { name: "Messages", exact: true }).click();
  expect(await controls.boundingBox()).toEqual(before);
  await page.getByRole("tab", { name: "Home", exact: true }).click();
  await waitForAnimations(page);
  await page.screenshot({ path: "test-results/home-chats/floating-home.png" });
});

test("pinned DMs open dropdown chats with working composer, draft recovery and no canvas mutation", async ({
  page,
}) => {
  const before = await readActiveCanvas(page);
  const url = page.url();
  const chat = await pinAlice(page);
  const chatBox = await chat.boundingBox();
  expect(chatBox?.width).toBe(380);
  expect(chatBox?.height).toBeLessThanOrEqual(520);
  expect(await readActiveCanvas(page)).toEqual(before);
  expect(page.url()).toBe(url);
  await chat.getByTestId("message-input").fill("Keep this quick chat draft");
  await page.keyboard.press("Escape");
  await expect(chat).toHaveCount(0);
  const shortcut = page.getByRole("button", {
    name: /^Open pinned chat with alice/,
  });
  await expect(shortcut).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(chat.getByTestId("message-input")).toHaveText(
    "Keep this quick chat draft",
  );
  await chat
    .getByTestId("message-input")
    .fill("A message from the pinned dropdown");
  await chat.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(
    chat.getByText("A message from the pinned dropdown", { exact: true }),
  ).toBeVisible();
  await waitForAnimations(page);
  await page.screenshot({ path: "test-results/home-chats/pinned-dm.png" });
  await page.getByRole("tab", { name: "Projects", exact: true }).click();
  await expect(shortcut).toBeVisible();
  await page.reload();
  await shortcut.click();
  await expect(chat.getByTestId("message-input")).toBeVisible();
  await chat.getByRole("button", { name: "Unpin alice", exact: true }).click();
  await expect(shortcut).toHaveCount(0);
  expect((await preferences(page)).pinnedDms).toEqual([]);
  await expect(
    page.getByRole("button", { name: "Pin a DM", exact: true }),
  ).toBeFocused();
});

test("filters replace the avatar, affect feed sources, persist and can reset", async ({
  page,
}) => {
  await expect(
    page.getByRole("button", { name: "Account and settings", exact: true }),
  ).toHaveCount(0);
  const button = page.getByRole("button", {
    name: "Feed filters",
    exact: true,
  });
  await button.focus();
  await page.keyboard.press("Enter");
  const filters = page.getByRole("dialog", {
    name: "Feed filters",
    exact: true,
  });
  await filters
    .getByRole("checkbox", {
      name: "Notes from people you follow",
      exact: true,
    })
    .uncheck();
  await filters
    .getByRole("textbox", { name: "Find feed sources" })
    .fill("general");
  await filters
    .getByRole("checkbox", { name: "general", exact: true })
    .uncheck();
  await expect
    .poll(async () => (await preferences(page)).excludedSources.length)
    .toBe(1);
  await filters.getByRole("textbox", { name: "Find feed sources" }).fill("");
  for (const source of await filters.getByRole("checkbox").all())
    await source.uncheck();
  await page.keyboard.press("Escape");
  await expect(button).toBeFocused();
  await expect(page.getByTestId("pulse-briefing-highlight")).toHaveCount(0);
  await expect(
    page.getByText("No recent conversations to recap yet."),
  ).toBeVisible();
  await page.reload();
  await button.click();
  await expect(
    filters.getByRole("checkbox", {
      name: "Notes from people you follow",
      exact: true,
    }),
  ).not.toBeChecked();
  await expect(
    filters.getByRole("checkbox", { name: "general", exact: true }),
  ).not.toBeChecked();
  await filters
    .getByRole("button", { name: "Reset filters", exact: true })
    .click();
  expect((await preferences(page)).excludedSources).toEqual([]);
  expect((await preferences(page)).includeNotes).toBe(true);
  await waitForAnimations(page);
  await page.screenshot({ path: "test-results/home-chats/filters.png" });
  await filters
    .getByRole("button", { name: "App settings", exact: true })
    .click();
  await expect(page.getByTestId("pulse-settings-workspace")).toBeVisible();
});

test("failed pin persistence leaves a retryable picker and no phantom chat", async ({
  page,
}) => {
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key.startsWith("buzz-pulse-preferences.v1:"))
        throw new Error("Storage unavailable");
      return original.call(this, key, value);
    };
  });
  await page.getByRole("button", { name: "Pin a DM", exact: true }).click();
  const picker = page.getByRole("dialog", { name: "Pin a DM", exact: true });
  await picker
    .getByRole("textbox", { name: "Search DMs to pin" })
    .fill("alice");
  await picker.getByRole("button", { name: "Pin alice", exact: true }).click();
  await expect(picker).toBeVisible();
  await expect(
    page.getByText("Could not save your pins and filters. Please try again."),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /^Open pinned chat/ }),
  ).toHaveCount(0);
});
