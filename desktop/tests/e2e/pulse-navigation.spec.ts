import { expect, test, type Page } from "@playwright/test";
import { installMockBridge, TEST_IDENTITIES } from "../helpers/bridge";
import { waitForAnimations } from "../helpers/animations";

async function menu(page: Page, name: string) {
  await page
    .getByTestId("pulse-app-navigation")
    .getByRole("button", { name, exact: true })
    .click();
  return page.getByRole("dialog", { name: `${name} destinations` });
}
test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.addInitScript(() =>
    localStorage.setItem(
      "buzz.appearance.contentWidth",
      JSON.stringify({ mode: "custom", width: 800, height: 500 }),
    ),
  );
  await page.route("**/__pulse/briefing", (route) =>
    route.fulfill({ json: { highlights: [] } }),
  );
  await page.route("**/__chief", (route) =>
    route.fulfill({
      status: 503,
      json: { error: "Offline for navigation test" },
    }),
  );
  await installMockBridge(page, {
    managedAgents: [],
    relayAgents: [
      {
        pubkey: TEST_IDENTITIES.outsider.pubkey,
        name: "Runner",
        ownerPubkey: TEST_IDENTITIES.tyler.pubkey,
        channelNames: ["engineering"],
        status: "offline",
      },
      {
        pubkey: TEST_IDENTITIES.alice.pubkey,
        name: "Scout",
        ownerPubkey: TEST_IDENTITIES.tyler.pubkey,
        channelNames: ["alice-tyler"],
        status: "online",
      },
    ],
  });
  await page.goto("/#/pulse");
  await expect(page.getByTestId("pulse-app-navigation")).toBeVisible();
});

test("48px top bar and 24px buttons open destinations into the padded workspace", async ({
  page,
}) => {
  await expect(page.getByTestId("app-top-chrome")).toHaveCSS("height", "48px");
  const navigation = page.getByTestId("pulse-app-navigation");
  for (const name of ["Home", "Messages", "Projects", "Agents", "Apps"])
    await expect(
      navigation.getByRole("button", { name, exact: true }),
    ).toHaveCSS("height", "24px");
  await expect(page.getByTestId("pulse-dock-rail")).toHaveCount(0);
  await expect(page.getByTestId("global-back")).toHaveCount(0);
  await expect(page.getByTestId("global-forward")).toHaveCount(0);
  const messages = await menu(page, "Messages");
  await expect(
    messages.getByRole("button", { name: "Open Messages", exact: true }),
  ).toBeVisible();
  await expect(page.getByTestId("pulse-home")).toBeVisible();
  await expect(
    messages.getByRole("button", { name: /^Open (DM with|channel) / }).first(),
  ).toBeVisible();
  await waitForAnimations(page);
  await page.screenshot({
    path: "test-results/pulse-navigation/messages-popover.png",
  });
  await messages
    .getByRole("button", { name: /^Open (DM with|channel) / })
    .first()
    .click();
  await expect(page.getByTestId("pulse-message-view")).toBeVisible();
  await expect(messages).toHaveCount(0);
  const main = page.getByTestId("pulse-main-container");
  for (const width of [1440, 1000, 740]) {
    await page.setViewportSize({ width, height: 960 });
    const box = await main.boundingBox();
    const expectedWidth = Math.min(960, width - 48);
    expect(box?.x).toBe((width - expectedWidth) / 2);
    expect(box?.y).toBe(72);
    expect(box?.width).toBe(expectedWidth);
    expect(box?.height).toBe(864);
  }
  await expect(main).toHaveAttribute("data-content-width", "full");
  await expect(
    page.getByRole("button", { name: "Resize main window", exact: true }),
  ).toBeVisible();
  await page.setViewportSize({ width: 1440, height: 960 });
  await waitForAnimations(page);
  await page.screenshot({
    path: "test-results/pulse-navigation/full-workspace.png",
  });
});

test("keyboard popovers cancel without navigation, then open main views and compose", async ({
  page,
}) => {
  const trigger = page
    .getByTestId("pulse-app-navigation")
    .getByRole("button", { name: "Messages", exact: true });
  await trigger.focus();
  await page.keyboard.press("Space");
  const messages = page.getByRole("dialog", { name: "Messages destinations" });
  await expect(
    messages.getByRole("button", { name: "Open Messages", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
  await expect(page.getByTestId("pulse-home")).toBeVisible();
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("pulse-all-messages-feed")).toBeVisible();
  await (await menu(page, "Messages"))
    .getByRole("button", { name: "New message", exact: true })
    .click();
  await expect(page.getByTestId("pulse-combined-new-message")).toBeVisible();
  await (await menu(page, "Messages"))
    .getByRole("button", { name: "Search messages", exact: true })
    .click();
  await expect(page.getByTestId("pulse-search-feed")).toBeVisible();
  await menu(page, "Projects");
  const apps = await menu(page, "Agents");
  await expect(apps).toBeVisible();
  await expect(
    page.getByRole("dialog", { name: "Projects destinations" }),
  ).toHaveCount(0);
  await apps.getByRole("button", { name: "Open Agents", exact: true }).click();
  await expect(page.getByTestId("pulse-workspace-agents")).toBeVisible();
});

test("project shortcuts remember opened projects and Apps keeps feature entry points", async ({
  page,
}) => {
  await (await menu(page, "Projects"))
    .getByRole("button", { name: "Open project buzz", exact: true })
    .click();
  await expect(page.getByTestId("pulse-workspace-projects")).toBeVisible();
  await page.reload();
  const projects = await menu(page, "Projects");
  await expect(projects.getByText("Recently opened")).toBeVisible();
  await expect(
    projects.getByRole("button", { name: "Open project buzz", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await (await menu(page, "Agents"))
    .getByRole("button", { name: "Open Agents", exact: true })
    .click();
  await expect(page.getByTestId("pulse-workspace-agents")).toBeVisible();
  await (await menu(page, "Apps"))
    .getByRole("button", { name: "Workflows", exact: true })
    .click();
  await expect(page.getByTestId("pulse-workspace-workflows")).toBeVisible();
  await page
    .getByRole("button", { name: "Account and settings", exact: true })
    .click();
  await page
    .getByRole("dialog", { name: "Account and settings" })
    .getByRole("button", { name: "Settings", exact: true })
    .click();
  await expect(page.getByTestId("pulse-settings-workspace")).toBeVisible();
  await (await menu(page, "Home"))
    .getByRole("button", { name: "Open Home", exact: true })
    .click();
  await expect(page.getByTestId("pulse-home")).toBeVisible();
  await page.getByTestId("canvas-add-view").click();
  await expect(page.getByRole("dialog", { name: "Add a view" })).toBeVisible();
});

test("Agents shows live status and opens the agent chat", async ({ page }) => {
  const agents = await menu(page, "Agents");
  const scout = agents.getByRole("button", {
    name: "Chat with Scout",
    exact: true,
  });
  await expect(scout).toContainText("Online");
  await expect
    .poll(() =>
      page.evaluate(() =>
        window.__BUZZ_E2E_HAS_MOCK_GLOBAL_KIND_SUBSCRIPTION__?.(20001),
      ),
    )
    .toBe(true);
  await page.evaluate(
    ({ pubkey }) => {
      window.__BUZZ_E2E_EMIT_MOCK_PRESENCE__?.({ pubkey, status: "away" });
    },
    { pubkey: TEST_IDENTITIES.alice.pubkey },
  );
  await expect(scout).toContainText("Away");
  await page.evaluate(
    ({ pubkey }) => {
      window.__BUZZ_E2E_SEED_ACTIVE_TURNS__?.({
        agentPubkey: pubkey,
        channelId: "nav-agent-work",
        turnId: "nav-agent-turn",
        kind: "turn_started",
      });
    },
    { pubkey: TEST_IDENTITIES.alice.pubkey },
  );
  await expect(scout).toContainText("Working");
  await waitForAnimations(page);
  await page.screenshot({
    path: "test-results/pulse-navigation/agents-popover.png",
  });
  await scout.click();
  await expect(agents).toHaveCount(0);
  await expect(
    page.getByTestId("pulse-combined-detail").getByTestId("message-input"),
  ).toBeVisible();
  await expect(
    page
      .getByTestId("pulse-combined-list")
      .locator('[data-channel-name="alice-tyler"]'),
  ).toHaveAttribute("aria-current", "true");
});

test("agent shortcut opens a new direct chat with keyboard", async ({
  page,
}) => {
  const agents = await menu(page, "Agents");
  const runner = agents.getByRole("button", {
    name: "Chat with Runner",
    exact: true,
  });
  await expect(runner).toContainText("Offline");
  await runner.focus();
  await page.keyboard.press("Enter");
  await expect(agents).toHaveCount(0);
  await expect(
    page.getByTestId("pulse-combined-detail").getByTestId("message-input"),
  ).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() =>
        window.__BUZZ_E2E_COMMAND_PAYLOADS__?.filter(
          (call) => call.command === "open_dm",
        ),
      ),
    )
    .toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          payload: expect.objectContaining({
            pubkeys: [TEST_IDENTITIES.outsider.pubkey],
          }),
        }),
      ]),
    );
});

test("hover intent, gap crossing, instant adjacent menus, and leave grace", async ({
  page,
}) => {
  await page.clock.install();
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000));
  const nav = page.getByTestId("pulse-app-navigation");
  const home = nav.getByRole("button", { name: "Home", exact: true });
  const messages = nav.getByRole("button", { name: "Messages", exact: true });
  const menu = page.getByRole("dialog", { name: "Messages destinations" });
  await home.focus();
  await messages.hover();
  await page.clock.fastForward(40);
  await page.mouse.move(900, 700);
  await page.clock.fastForward(200);
  await expect(menu).toHaveCount(0);
  await messages.hover();
  await page.clock.fastForward(79);
  await expect(menu).toHaveCount(0);
  await page.clock.fastForward(1);
  await expect(menu).toBeVisible();
  await expect(menu).toHaveAttribute("data-open-method", "hover");
  await expect(home).toBeFocused();
  await expect(menu).toHaveCSS("animation-name", "none");
  const triggerBox = await messages.boundingBox();
  if (!triggerBox) throw new Error("Missing Messages trigger");
  await page.mouse.move(
    triggerBox.x + triggerBox.width / 2,
    triggerBox.y + triggerBox.height + 5,
  );
  await page.clock.fastForward(400);
  await expect(menu).toBeVisible();
  await menu
    .getByRole("button", { name: "Open Messages", exact: true })
    .hover();
  await page.clock.fastForward(400);
  await expect(menu).toBeVisible();
  await nav.getByRole("button", { name: "Agents", exact: true }).hover();
  const agents = page.getByRole("dialog", { name: "Agents destinations" });
  await expect(agents).toBeVisible();
  await expect(menu).toHaveCount(0);
  await expect(agents).toHaveCSS("animation-name", "none");
  await page.mouse.move(900, 700);
  await page.clock.fastForward(179);
  await expect(agents).toBeVisible();
  await page.clock.fastForward(1);
  await expect(agents).toHaveCount(0);
  await messages.hover();
  await expect(menu).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await expect(menu).toHaveCount(0);
  await page.clock.fastForward(1000);
  await expect(menu).toHaveCount(0);
});

test("click pins a hover preview; second click, outside click, and Escape dismiss", async ({
  page,
}) => {
  await page.clock.install();
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000));
  const trigger = page
    .getByTestId("pulse-app-navigation")
    .getByRole("button", { name: "Messages", exact: true });
  const menu = page.getByRole("dialog", { name: "Messages destinations" });
  await trigger.hover();
  await page.clock.fastForward(80);
  await expect(menu).toBeVisible();
  await trigger.click();
  await expect(menu).toHaveAttribute("data-open-method", "click");
  await page.mouse.move(1100, 700);
  await page.clock.fastForward(500);
  await expect(menu).toBeVisible();
  await page.mouse.click(1100, 600);
  await expect(menu).toHaveCount(0);
  await trigger.click();
  await expect(menu).toBeVisible();
  await trigger.click();
  await expect(menu).toHaveCount(0);
  await page.clock.fastForward(500);
  await expect(menu).toHaveCount(0);
  await page.mouse.move(1000, 700);
  await trigger.hover();
  await page.clock.fastForward(80);
  await expect(menu).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await page.clock.fastForward(1000);
  await expect(menu).toHaveCount(0);
});

test("keyboard destinations are instant and support arrow navigation", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const nav = page.getByTestId("pulse-app-navigation");
  const trigger = nav.getByRole("button", { name: "Messages", exact: true });
  await trigger.focus();
  await page.keyboard.press("ArrowDown");
  const menu = page.getByRole("dialog", { name: "Messages destinations" });
  await expect(
    menu.getByRole("button", { name: "Open Messages", exact: true }),
  ).toBeFocused();
  await expect(menu).toHaveCSS("animation-name", "none");
  await page.keyboard.press("End");
  await expect(
    menu.getByRole("button", { name: "Search messages", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await expect(
    menu.getByRole("button", { name: "New message", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(
    page.getByRole("dialog", { name: "Projects destinations" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(
    nav.getByRole("button", { name: "Projects", exact: true }),
  ).toBeFocused();
});

test.describe("touch navigation", () => {
  test.use({ hasTouch: true });
  test("touch opens on tap and never relies on hover", async ({ page }) => {
    const trigger = page
      .getByTestId("pulse-app-navigation")
      .getByRole("button", { name: "Messages", exact: true });
    const menu = page.getByRole("dialog", { name: "Messages destinations" });
    await trigger.dispatchEvent("pointerenter", {
      pointerType: "touch",
      buttons: 0,
    });
    await page.waitForTimeout(150);
    await expect(menu).toHaveCount(0);
    await trigger.tap();
    await expect(menu).toBeVisible();
    await menu
      .getByRole("button", { name: "Open Messages", exact: true })
      .tap();
    await expect(menu).toHaveCount(0);
    await expect(page.getByTestId("pulse-all-messages-feed")).toBeVisible();
  });
});

test("layout controls and account stay anchored at the right edge across apps", async ({
  page,
}) => {
  await page.getByTestId("canvas-add-view").click();
  const picker = page.getByRole("dialog", { name: "Add a view" });
  await picker.getByRole("textbox", { name: "Search views" }).fill("weather");
  await picker
    .getByRole("button", { name: "Weather Widgets", exact: true })
    .click();
  const chrome = page.getByTestId("app-top-chrome");
  const controls = chrome.getByRole("group", { name: "Canvas controls" });
  const account = chrome.getByRole("button", {
    name: "Account and settings",
    exact: true,
  });
  for (const width of [1440, 740]) {
    await page.setViewportSize({ width, height: 960 });
    const layoutBox = await controls.boundingBox();
    const accountBox = await account.boundingBox();
    expect(accountBox && accountBox.x + accountBox.width).toBe(width - 12);
    for (const [tab, destination] of [
      ["Projects", "Open Projects"],
      ["Projects", "Open project buzz"],
      ["Messages", "Open Messages"],
      ["Agents", "Open Agents"],
      ["Apps", "Workflows"],
      ["Home", "Open Home"],
    ]) {
      await (await menu(page, tab))
        .getByRole("button", { name: destination, exact: true })
        .click();
      if (destination === "Open Projects")
        await expect(
          page.getByTestId("projects-workspace-chrome"),
        ).toBeVisible();
      if (destination === "Open project buzz")
        await expect(page.getByTestId("project-detail-chrome")).toBeVisible();
      await expect.poll(() => controls.boundingBox()).toEqual(layoutBox);
      await expect.poll(() => account.boundingBox()).toEqual(accountBox);
    }
  }
});
