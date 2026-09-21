import { openWindowPicker } from "../helpers/canvas";
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
  await page.keyboard.press("Meta+Comma");
  await expect(page.getByTestId("pulse-settings-workspace")).toBeVisible();
  await page.getByRole("tab", { name: "Messages", exact: true }).click();
  await expect(page.getByTestId("pulse-workspace-workflows")).toBeVisible();
  await openWindowPicker(page);
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

test("left dock keeps workspace icons, tooltips and settings accessible across spaces", async ({
  page,
}) => {
  await expect(page.getByTestId("app-top-chrome")).toHaveCSS("height", "36px");
  await expect(page.getByTestId("global-back")).toHaveCount(0);
  const account = page.getByRole("button", {
    name: "Pin a DM",
    exact: true,
  });
  const dock = page.getByTestId("pulse-app-navigation");
  const bounds = await dock.boundingBox();
  expect(bounds?.x).toBe(16);
  expect(bounds?.width).toBe(64);
  expect(
    Math.abs((bounds?.y ?? 0) + (bounds?.height ?? 0) / 2 - 480),
  ).toBeLessThan(1);
  await expect(page.getByTestId("app-top-chrome").getByRole("tab")).toHaveCount(
    0,
  );
  await expect(
    page.getByRole("tablist", { name: "Workspaces" }),
  ).toHaveAttribute("aria-orientation", "vertical");
  const initial = await account.boundingBox();
  for (const name of ["Home", "Messages", "Projects", "Agents", "Apps"]) {
    const tab = page.getByRole("tab", { name, exact: true });
    await expect(tab).toHaveCSS("height", "48px");
    await tab.click();
    await expect(tab).toHaveAttribute("aria-selected", "true");
    expect((await account.boundingBox())?.x).toBe(initial?.x);
  }
  const homeIcon = page.getByRole("tab", { name: "Home", exact: true });
  await homeIcon.hover();
  await expect(page.getByRole("tooltip", { name: "Home" })).toBeVisible();
  await waitForAnimations(page);
  await page.screenshot({
    path: "test-results/pulse-navigation/left-dock.png",
  });
  await homeIcon.focus();
  await page.keyboard.press("ArrowDown");
  await expect(
    page.getByRole("tab", { name: "Messages", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("tab", { name: "Messages", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
});

test("dock scrolls on short windows and keeps creation, pins and settings reachable", async ({
  page,
}) => {
  await page.evaluate(() => {
    const key = Object.keys(localStorage).find((key) =>
      key.startsWith("buzz-workspaces.v1:"),
    );
    if (!key) throw new Error("No workspace snapshot");
    const state = JSON.parse(localStorage.getItem(key) ?? "{}");
    while (state.items.length < 12)
      state.items.push({
        ...state.items[0],
        id: `custom-${state.items.length}`,
        name: `Desk ${state.items.length}`,
        canvas: { layout: "focus", main: false, windows: [] },
      });
    localStorage.setItem(key, JSON.stringify(state));
  });
  await page.setViewportSize({ width: 800, height: 600 });
  await page.reload();
  const dock = page.getByTestId("pulse-app-navigation");
  const bounds = await dock.boundingBox();
  expect((bounds?.y ?? 0) + (bounds?.height ?? 0)).toBeLessThanOrEqual(584);
  const home = page.getByRole("tab", { name: "Home", exact: true });
  await home.focus();
  await page.keyboard.press("End");
  const last = page.getByRole("tab", { name: "Desk 11", exact: true });
  await expect(last).toBeFocused();
  await expect(last).toBeInViewport();
  await page.keyboard.press("Enter");
  await expect(last).toHaveAttribute("aria-selected", "true");
  await expect(
    page.getByRole("button", { name: "New workspace", exact: true }),
  ).toBeDisabled();
  const pin = page.getByRole("button", { name: "Pin a DM", exact: true });
  await pin.click();
  const picker = page.getByRole("dialog", { name: "Pin a DM", exact: true });
  await expect(picker).toBeVisible();
  expect((await picker.boundingBox())?.x).toBeGreaterThan(80);
  await page.keyboard.press("Escape");
  const settings = dock.getByRole("button", { name: "Settings", exact: true });
  await settings.click();
  await expect(page.getByTestId("pulse-settings-workspace")).toBeVisible();
  await expect(settings).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("tab", { selected: true })).toHaveCount(0);
  await page.getByRole("tab", { name: "Home", exact: true }).click();
  await expect(page.getByTestId("pulse-home")).toBeVisible();
});

test("Jev chooses each workspace icon once, preserves it across content and name changes, and prunes closed workspaces", async ({
  page,
}) => {
  let requests = 0;
  await page.route("**/__pulse/workspace-icons", async (route) => {
    requests++;
    const { questions } = route.request().postDataJSON();
    await route.fulfill({
      json: Object.fromEntries(
        Object.entries(questions).map(([id, question]) => {
          const instructions = (question as { instructions: string })
            .instructions;
          const choice = instructions.includes('"title":"Weather"')
            ? "cloud"
            : instructions.includes('"title":"Music"')
              ? "music"
              : instructions.includes('"name":"Home"')
                ? "house"
                : "grid";
          return [id, { choice, probability: 0.4, margin: 0.05 }];
        }),
      ),
    });
  });
  const readIcons = () =>
    page.evaluate(() =>
      JSON.parse(
        Object.entries(localStorage).find(([key]) =>
          key.startsWith("buzz-workspace-icons.v1:"),
        )?.[1] ?? "{}",
      ),
    );
  await expect.poll(async () => Object.keys(await readIcons()).length).toBe(5);
  await page
    .getByRole("button", { name: "New workspace", exact: true })
    .click();
  await page.getByRole("button", { name: "Custom", exact: true }).click();
  let workspace = page.getByRole("tab", { name: "Workspace 1", exact: true });
  // An empty custom workspace gets its initial icon before windows are added.
  await expect.poll(async () => Object.keys(await readIcons()).length).toBe(6);
  const count = requests;
  await openWindowPicker(page);
  const picker = page.getByRole("dialog", { name: "Add a window" });
  await picker.getByRole("textbox", { name: "Search views" }).fill("Music");
  await picker
    .getByRole("button", { name: "Music Widgets", exact: true })
    .click();
  await expect(workspace.locator("[data-workspace-icon]")).toHaveAttribute(
    "data-workspace-icon",
    "grid",
  );
  const id = new URL(page.url().replace("/#/", "/")).searchParams.get(
    "workspace",
  );
  expect(id).toBeTruthy();
  await expect(workspace.locator("[data-workspace-icon]")).toHaveAttribute(
    "data-workspace-icon",
    "grid",
  );
  await page
    .getByRole("button", { name: "Window options", exact: true })
    .click();
  await page
    .getByRole("menuitemradio", { name: "Freeform layout", exact: true })
    .click();
  await page.waitForTimeout(1000);
  expect(requests).toBe(count);
  await openWindowPicker(page);
  await picker.getByRole("textbox", { name: "Search views" }).fill("Weather");
  await picker
    .getByRole("button", { name: "Weather Widgets", exact: true })
    .click();
  await expect(workspace.locator("[data-workspace-icon]")).toHaveAttribute(
    "data-workspace-icon",
    "grid",
  );
  await page
    .getByRole("button", { name: "Close Weather window", exact: true })
    .click();
  await expect(workspace.locator("[data-workspace-icon]")).toHaveAttribute(
    "data-workspace-icon",
    "grid",
  );
  await workspace.focus();
  await workspace.press("F2");
  const name = page.getByRole("textbox", {
    name: "Workspace name",
    exact: true,
  });
  await name.fill("Night studio");
  await name.press("Enter");
  workspace = page.getByRole("tab", { name: "Night studio", exact: true });
  await page.waitForTimeout(1000);
  expect(requests).toBe(count);
  const afterChanges = requests;
  await page.reload();
  await expect(workspace.locator("[data-workspace-icon]")).toHaveAttribute(
    "data-workspace-icon",
    "grid",
  );
  await page.waitForTimeout(900);
  expect(requests).toBe(afterChanges);
  await workspace.click({ button: "right" });
  await page
    .getByRole("menuitem", { name: "Close workspace", exact: true })
    .click();
  await expect
    .poll(async () => Object.keys(await readIcons()).includes(id ?? ""))
    .toBe(false);
});

test("failed icon choices leave a retry and delayed choices cannot overwrite newer content", async ({
  page,
}) => {
  let fail = true;
  let releaseOld: (() => void) | undefined;
  let held = false;
  await page.route("**/__pulse/workspace-icons", async (route) => {
    if (fail) {
      await route.fulfill({ status: 503 });
      return;
    }
    const { questions } = route.request().postDataJSON();
    const old = Object.values(questions).some((q) =>
      (q as { instructions: string }).instructions.includes('"name":"Home"'),
    );
    if (old && !held) {
      held = true;
      await new Promise<void>((resolve) => {
        releaseOld = resolve;
      });
    }
    await route.fulfill({
      json: Object.fromEntries(
        Object.keys(questions).map((id) => [
          id,
          { choice: old ? "house" : "moon", probability: 0.8, margin: 0.6 },
        ]),
      ),
    });
  });
  const home = page.getByRole("tab", { name: "Home", exact: true });
  await expect(async () => {
    await home.click({ button: "right" });
    await expect(
      page.getByRole("menuitem", { name: "Retry workspace icons" }),
    ).toBeVisible();
  }).toPass({ timeout: 10000 });
  fail = false;
  await page.getByRole("menuitem", { name: "Retry workspace icons" }).click();
  await expect.poll(() => held).toBe(true);
  await home.focus();
  await home.press("F2");
  const name = page.getByRole("textbox", {
    name: "Workspace name",
    exact: true,
  });
  await name.fill("Night riders");
  await name.press("Enter");
  const renamed = page.getByRole("tab", { name: "Night riders", exact: true });
  await expect(renamed.locator("[data-workspace-icon]")).toHaveAttribute(
    "data-workspace-icon",
    "moon",
  );
  releaseOld?.();
  await page.waitForTimeout(200);
  await expect(renamed.locator("[data-workspace-icon]")).toHaveAttribute(
    "data-workspace-icon",
    "moon",
  );
  await page.reload();
  await expect(renamed.locator("[data-workspace-icon]")).toHaveAttribute(
    "data-workspace-icon",
    "moon",
  );
});
