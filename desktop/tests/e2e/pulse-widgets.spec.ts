import { expect, test } from "@playwright/test";
import { waitForAnimations } from "../helpers/animations";
import { installMockBridge, TEST_IDENTITIES } from "../helpers/bridge";

test("add the widget collection to Pulse, interact, reload, and remove it", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1600, height: 1100 });
  await page.route("**/__pulse/briefing", (route) =>
    route.fulfill({ json: { highlights: [] } }),
  );
  await page.route("**/__chief", (route) =>
    route.fulfill({ status: 503, json: { error: "Offline for widget test" } }),
  );
  await installMockBridge(page);
  await page.goto("/#/pulse");
  await page.getByTestId("canvas-add-view").click();
  const picker = page.getByRole("dialog", { name: "Add a window" });
  await picker.getByRole("button", { name: "Widgets", exact: true }).click();
  await expect(
    picker.getByRole("region", { name: "Available views" }).getByRole("button"),
  ).toHaveCount(16);
  await picker
    .getByRole("button", { name: "All widgets Widgets", exact: true })
    .click();
  const collection = page.getByRole("region", {
    name: "All widgets window",
    exact: true,
  });
  await expect(collection.locator("[data-widget]")).toHaveCount(14);
  await expect(
    collection.locator('[data-widget="Active channels"] .avatar').first(),
  ).toHaveText("#");
  await expect(
    collection.getByText("Interactive preview · Sample data"),
  ).toHaveCount(0);
  await collection
    .getByRole("button", { name: "Switch to degrees Celsius" })
    .click();
  await expect(collection.locator(".hero-number")).toHaveText("20°");
  const type = await collection
    .locator(".widget")
    .first()
    .evaluate((el) => getComputedStyle(el).fontFamily);
  expect(type).toContain("Widget Cash Sans");
  await expect(
    collection.getByRole("button", { name: /anatomy/i }),
  ).toHaveCount(0);
  await expect(collection.locator(".canvas-widget-tools")).toHaveCount(0);
  await page.reload();
  await expect(collection.locator("[data-widget]")).toHaveCount(14);
  await waitForAnimations(page);
  await collection.locator(".location-widget").scrollIntoViewIfNeeded();
  await page.screenshot({ path: "test-results/widgets/pulse-collection.png" });
  await collection
    .getByRole("button", { name: "Close All widgets window" })
    .click();
  await expect(page.getByTestId("canvas-window")).toHaveCount(0);
  await expect(page.getByTestId("canvas-add-view")).toBeFocused();

  await page.getByTestId("canvas-add-view").click();
  await picker.getByRole("textbox", { name: "Search views" }).fill("Flight");
  await picker
    .getByRole("button", { name: "Flight Widgets", exact: true })
    .click();
  const flight = page.getByRole("region", {
    name: "Flight window",
    exact: true,
  });
  await expect(flight.getByText("SFO", { exact: true })).toBeVisible();
  const card = flight.locator('[data-widget="Flight"]');
  const height = await card.evaluate((el) => el.getBoundingClientRect().height);
  expect(height).toBeLessThan(440);
  const resize = flight.getByRole("button", {
    name: "Resize Flight window se",
    exact: true,
  });
  await resize.focus();
  for (
    let step = 0;
    step < 24 && (await card.getAttribute("data-size")) !== "small";
    step++
  ) {
    await page.keyboard.press("Shift+ArrowLeft");
  }
  await expect(card).toHaveAttribute("data-size", "small");
  await expect(card.getByText("San Francisco", { exact: true })).toHaveCount(0);
  for (
    let step = 0;
    step < 24 && (await card.getAttribute("data-size")) !== "medium";
    step++
  ) {
    await page.keyboard.press("Shift+ArrowRight");
  }
  await expect(card).toHaveAttribute("data-size", "medium");
  await expect(card.getByText("San Francisco", { exact: true })).toBeVisible();
  // This companion starts against the right edge; grow toward the open canvas.
  await flight
    .getByRole("button", { name: "Resize Flight window nw", exact: true })
    .focus();
  for (
    let step = 0;
    step < 24 && (await card.getAttribute("data-size")) !== "large";
    step++
  ) {
    await page.keyboard.press("Shift+ArrowLeft");
  }
  await expect(card).toHaveAttribute("data-size", "large");
  await expect(card.getByText("Departs", { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 740, height: 900 });
  const box = await flight.boundingBox();
  expect(box).not.toBeNull();
  expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(740);
});

test("Buzz widgets follow scoped agent activity, navigate conversations, and start the selected huddle", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1600, height: 1100 });
  await page.route("**/__pulse/briefing", (route) =>
    route.fulfill({ json: { highlights: [] } }),
  );
  await page.route("**/__chief", (route) =>
    route.fulfill({ status: 503, json: {} }),
  );
  await page.addInitScript(() => {
    Object.defineProperty(navigator.mediaDevices, "enumerateDevices", {
      configurable: true,
      value: async () => [
        {
          deviceId: "test-mic",
          groupId: "test-audio",
          kind: "audioinput",
          label: "Test microphone",
        },
      ],
    });
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
      configurable: true,
      value: async () => {
        const context = new AudioContext();
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        const destination = context.createMediaStreamDestination();
        gain.gain.value = 0;
        oscillator.connect(gain);
        gain.connect(destination);
        oscillator.start();
        return destination.stream;
      },
    });
  });
  const agentPubkey = TEST_IDENTITIES.tyler.pubkey;
  const channelId = "94a444a4-c0a3-5966-ab05-530c6ddc2301";
  await installMockBridge(page, {
    managedAgents: [
      {
        pubkey: agentPubkey,
        name: "Studio agent",
        status: "running",
        channelNames: ["agents"],
      },
    ],
  });
  await page.goto("/#/pulse");
  await page.getByTestId("canvas-add-view").click();
  const picker = page.getByRole("dialog", { name: "Add a window" });
  await picker
    .getByRole("textbox", { name: "Search views" })
    .fill("Buzz widgets");
  await picker
    .getByRole("button", { name: "Buzz widgets Widgets", exact: true })
    .click();
  const collection = page.getByRole("region", {
    name: "Buzz widgets window",
    exact: true,
  });
  await expect(collection.locator("[data-widget]")).toHaveCount(5);
  const huddle = collection.locator('[data-widget="Huddle"]');
  await collection
    .getByRole("button", { name: "Resize Buzz widgets window se", exact: true })
    .focus();
  for (
    let step = 0;
    step < 24 && (await huddle.getAttribute("data-size")) !== "small";
    step++
  ) {
    await page.keyboard.press("Shift+ArrowLeft");
  }
  await expect(huddle).toHaveAttribute("data-size", "small");
  await huddle.locator(".huddle-avatar-launcher").click();
  await huddle
    .getByRole("combobox", { name: "Huddle conversation" })
    .selectOption({ label: "#general" });
  // Selecting a different room remounts its roster and closes the old details.
  if (!(await huddle.getByRole("combobox").isVisible()))
    await huddle.locator(".huddle-avatar-launcher").click();
  const selectedChannel = await huddle.getByRole("combobox").inputValue();
  await expect(
    huddle.getByRole("button", { name: "Start huddle", exact: true }),
  ).toBeEnabled();
  await page.keyboard.press("Escape");
  // The widget must not register as another owner of the active channel's shortcut.
  await page.evaluate(
    (channelId) =>
      window.dispatchEvent(
        new CustomEvent("buzz:huddle-shortcut", { detail: { channelId } }),
      ),
    selectedChannel,
  );
  await collection
    .getByRole("button", { name: "Agent options", exact: true })
    .click();
  await collection
    .getByRole("combobox", { name: "Agent to follow" })
    .selectOption(agentPubkey);
  await page.keyboard.press("Escape");
  await page.evaluate(
    ({ agentPubkey, channelId }) => {
      window.__BUZZ_E2E_SEED_ACTIVE_TURNS__?.({
        agentPubkey,
        channelId,
        turnId: "widget-turn",
      });
      const base = {
        timestamp: new Date().toISOString(),
        kind: "acp_read",
        agentIndex: 0,
        channelId,
        sessionId: "widget-session",
        turnId: "widget-turn",
      };
      const updates = [
        {
          sessionUpdate: "tool_call",
          toolCallId: "widget-check",
          title: "shell",
          toolName: "shell",
          status: "in_progress",
          rawInput: { command: "pnpm test" },
        },
        { sessionUpdate: "usage_update", used: 12480, size: 128000 },
      ];
      const seq = Date.now() + 100;
      window.__BUZZ_E2E_SEED_OBSERVER_EVENTS__?.({
        agentPubkey,
        events: updates
          .map((update, index) => ({
            ...base,
            seq: seq + index,
            payload: { method: "session/update", params: { update } },
          }))
          .concat([
            {
              ...base,
              seq: seq + 2,
              channelId: "not-joined",
              payload: {
                method: "session/update",
                params: {
                  update: {
                    sessionUpdate: "usage_update",
                    used: 999999,
                    size: 999999,
                  },
                },
              },
            },
          ]),
      });
    },
    { agentPubkey, channelId },
  );
  const agent = collection.locator('[data-widget="Agent activity"]');
  await expect(agent).toContainText("Using tools");
  await expect(agent).toContainText("12,480");
  await expect(agent).not.toContainText("999,999");
  await agent.locator(".agent-tool").click();
  await expect(page.getByRole("dialog")).toContainText("pnpm test");
  await page.keyboard.press("Escape");
  const conversations = collection.locator('[data-widget="Conversations"]');
  await expect(conversations.locator(".avatar-launcher").first()).toBeVisible();
  await conversations.locator(".avatar-launcher").first().click();
  await expect(page).toHaveURL(/conversation=/);
  await expect(page).toHaveURL(/thread=/);
  await agent.scrollIntoViewIfNeeded();
  await waitForAnimations(page);
  await agent.screenshot({
    path: "test-results/widgets/pulse-agent-widget.png",
  });
  await huddle.scrollIntoViewIfNeeded();
  await waitForAnimations(page);
  await huddle.screenshot({
    path: "test-results/widgets/pulse-huddle-widget.png",
  });
  expect(
    await page.evaluate(() =>
      (window.__BUZZ_E2E_COMMAND_LOG__ ?? []).filter(
        (entry) => entry.command === "start_huddle",
      ),
    ),
  ).toHaveLength(0);
  await huddle.locator(".huddle-avatar-launcher").click();
  await huddle
    .getByRole("button", { name: "Start huddle", exact: true })
    .focus();
  await page.keyboard.press("Enter");
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window.__BUZZ_E2E_COMMAND_LOG__ ?? []).findLast(
            (entry) => entry.command === "start_huddle",
          )?.payload,
      ),
    )
    .toMatchObject({ parentChannelId: selectedChannel, memberPubkeys: [] });
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window.__BUZZ_E2E_COMMAND_LOG__ ?? []).filter(
            (entry) => entry.command === "start_huddle",
          ).length,
      ),
    )
    .toBe(1);
});

for (const broken of [false, true]) {
  test(`widget avatars use the relay proxy and ${broken ? "fall back when images fail" : "load profile images"}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1600, height: 1100 });
    const filename = `${"a".repeat(64)}.png`;
    await page.route(`http://127.0.0.1:54321/media/${filename}`, (route) =>
      broken
        ? route.fulfill({ status: 404, body: "Missing image" })
        : route.fulfill({
            contentType: "image/png",
            body: Buffer.from(
              "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=",
              "base64",
            ),
          }),
    );
    await page.route("**/__chief", (route) =>
      route.fulfill({ status: 503, json: {} }),
    );
    await page.route("**/__pulse/briefing", (route) =>
      route.fulfill({ json: { highlights: [] } }),
    );
    await installMockBridge(page, {
      searchProfiles: Object.values(TEST_IDENTITIES).map((person) => ({
        pubkey: person.pubkey,
        displayName: `Avatar test ${person.username}`,
        avatarUrl: `http://localhost:3000/media/${filename}`,
      })),
    });
    const imageResponse = page.waitForResponse(
      `http://127.0.0.1:54321/media/${filename}`,
    );
    await page.goto("/#/pulse");
    await page.getByTestId("canvas-add-view").click();
    const picker = page.getByRole("dialog", { name: "Add a window" });
    await picker
      .getByRole("textbox", { name: "Search views" })
      .fill("Conversations");
    await picker
      .getByRole("button", { name: "Conversations Widgets", exact: true })
      .click();
    const panel = page.getByRole("region", {
      name: "Conversations window",
      exact: true,
    });
    await expect(panel.getByRole("button", { name: /anatomy/i })).toHaveCount(
      0,
    );
    const row = panel
      .locator(".communication-row")
      .filter({ hasText: "Avatar test" })
      .first();
    await expect(row).toBeVisible();
    const avatar = row.locator(".widget-person-avatar");
    expect((await imageResponse).status()).toBe(broken ? 404 : 200);
    if (broken) {
      await expect(avatar.locator('[data-slot="avatar-fallback"]')).toHaveText(
        "AT",
      );
      await expect(avatar.locator("img")).toHaveCount(0);
    } else {
      await expect(avatar.locator("img")).toHaveAttribute(
        "src",
        `http://127.0.0.1:54321/media/${filename}`,
      );
      await expect
        .poll(() =>
          avatar
            .locator("img")
            .evaluate((el) => (el as HTMLImageElement).naturalWidth),
        )
        .toBe(1);
    }
  });
}
