import { expect, test, type Page } from "@playwright/test";
import { installMockBridge, TEST_IDENTITIES } from "../helpers/bridge";
import { waitForAnimations } from "../helpers/animations";
async function menu(page: Page, name: string) {
  await page.getByRole("button", { name: /^Switch view,/ }).click();
  const menu = page.getByRole("dialog", { name: "Switch window view" });
  await menu.getByRole("button", { name, exact: true }).click();
  return menu;
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
  await page.goto("/#/pulse?feed=conversation");
  await expect(page.getByTestId("pulse-app-navigation")).toBeVisible();
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
  await page.getByRole("button", { name: "Feed filters", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Feed filters" })
    .getByRole("button", { name: "App settings", exact: true })
    .click();
  await expect(page.getByTestId("pulse-settings-workspace")).toBeVisible();
  await page.getByRole("tab", { name: "Messages", exact: true }).click();
  await expect(page.getByTestId("pulse-workspace-workflows")).toBeVisible();
  await page.getByTestId("canvas-add-view").click();
  await expect(
    page.getByRole("dialog", { name: "Add a window" }),
  ).toBeVisible();
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

test("workspace tabs retain top chrome geometry and account controls across spaces", async ({
  page,
}) => {
  await expect(page.getByTestId("app-top-chrome")).toHaveCSS("height", "48px");
  await expect(page.getByTestId("global-back")).toHaveCount(0);
  const account = page.getByRole("button", {
    name: "Feed filters",
    exact: true,
  });
  const initial = await account.boundingBox();
  for (const name of ["Home", "Messages", "Projects", "Agents", "Apps"]) {
    const tab = page.getByRole("tab", { name, exact: true });
    await expect(tab).toHaveCSS("height", "24px");
    await tab.click();
    await expect(tab).toHaveAttribute("aria-selected", "true");
    expect((await account.boundingBox())?.x).toBe(initial?.x);
  }
  await page.getByRole("tab", { name: "Home", exact: true }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(
    page.getByRole("tab", { name: "Messages", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("tab", { name: "Messages", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
});
