import { expect, test } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { installMockBridge, openCreateChannelDialog } from "../helpers/bridge";
import { openSettings } from "../helpers/settings";
import { waitForAnimations } from "../helpers/animations";
const THEME_STORAGE_KEY = "buzz-blockui-appearance.v1";
const MOCK_PUBKEY = "deadbeef".repeat(8);
const GENERAL_CHANNEL_ID = "9a1657ac-f7aa-5db0-b632-d8bbeb6dfb50";
async function seedTheme(page: import("@playwright/test").Page, theme: string) {
  await page.addInitScript(
    ({ key, value }) => {
      window.localStorage.setItem(key, value);
    },
    { key: THEME_STORAGE_KEY, value: theme === "buzz-dark" ? "dark" : "light" },
  );
}

async function seedIconChannelSection(page: import("@playwright/test").Page) {
  await page.addInitScript(
    ({ channelId, pubkey }) => {
      window.localStorage.setItem(
        `buzz-channel-sections.v1:${pubkey}`,
        JSON.stringify({
          version: 1,
          sections: [
            {
              id: "alignment-section",
              name: "Team channels",
              icon: "📌",
              order: 0,
            },
          ],
          assignments: { [channelId]: "alignment-section" },
        }),
      );
    },
    { channelId: GENERAL_CHANNEL_ID, pubkey: MOCK_PUBKEY },
  );
}

async function openChannel(page: import("@playwright/test").Page) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.getByTestId("channel-general").click();
  await expect(page.getByTestId("chat-title")).toHaveText("general");
  await expect(page.getByTestId("app-sidebar")).toBeVisible();
}

test("custom section icon and name align with channel columns", async ({
  page,
}) => {
  await seedTheme(page, "buzz");
  await seedIconChannelSection(page);
  await installMockBridge(page);
  await openChannel(page);

  const sectionIconBox = await page
    .getByTestId("section-icon-alignment-section")
    .boundingBox();
  const sectionTitleBox = await page
    .getByTestId("section-title-alignment-section")
    .boundingBox();
  const channelButton = page.getByTestId("channel-general");
  const channelIconBox = await channelButton
    .locator("svg")
    .first()
    .boundingBox();
  const channelTitleBox = await channelButton
    .locator("[data-sidebar-row-label]")
    .boundingBox();

  expect(sectionIconBox).not.toBeNull();
  expect(sectionTitleBox).not.toBeNull();
  expect(channelIconBox).not.toBeNull();
  expect(channelTitleBox).not.toBeNull();
  if (
    !sectionIconBox ||
    !sectionTitleBox ||
    !channelIconBox ||
    !channelTitleBox
  ) {
    throw new Error("Custom section alignment geometry is missing");
  }
  expect(Math.abs(sectionIconBox.x - channelIconBox.x)).toBeLessThanOrEqual(
    0.5,
  );
  expect(Math.abs(sectionTitleBox.x - channelTitleBox.x)).toBeLessThanOrEqual(
    0.5,
  );
});

test("Block UI modes apply live and system mode follows OS changes", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "light" });
  await installMockBridge(page);
  await page.goto("/");
  await openSettings(page, "appearance");
  await page.getByTestId("appearance-mode-dark").click();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await page.emulateMedia({ colorScheme: "light" });
  await expect(page.locator("html")).toHaveClass(/dark/);
  await page.getByTestId("appearance-mode-light").click();
  await expect(page.locator("html")).toHaveClass(/light/);
  await page.getByTestId("appearance-mode-system").click();
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator("html")).toHaveClass(/dark/);
  await page.emulateMedia({ colorScheme: "light" });
  await expect(page.locator("html")).toHaveClass(/light/);
  expect(
    await page.evaluate(() =>
      localStorage.getItem("buzz-blockui-appearance.v1"),
    ),
  ).toBe("system");
});

test("conversation font sizes remain 13/14/15 and density is independent", async ({
  page,
}) => {
  await installMockBridge(page);
  await page.goto("/");
  await openSettings(page, "appearance");
  const sample = page.getByText(
    "The revised conversation layout is ready to review.",
    { exact: true },
  );
  for (const [value, pixels] of [
    ["smaller", 13],
    ["default", 14],
    ["larger", 15],
  ] as const) {
    await page.getByTestId(`font-size-${value}`).click();
    await expect(sample).toHaveCSS("font-size", `${pixels}px`);
  }
  const row = sample.locator("xpath=ancestor::article");
  await page.getByTestId("conversation-density-compact").click();
  const compactHeight = await row.evaluate(
    (el) => el.getBoundingClientRect().height,
  );
  await page.getByTestId("conversation-density-spacious").click();
  await expect(sample).toHaveCSS("font-size", "15px");
  await expect
    .poll(() => row.evaluate((el) => el.getBoundingClientRect().height))
    .toBeGreaterThan(compactHeight);
  await page.reload();
  await expect(page.getByTestId("font-size-larger")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(
    page.getByTestId("conversation-density-spacious"),
  ).toHaveAttribute("aria-pressed", "true");
});

test("source button states keep text contrast, pill geometry and visible keyboard focus", async ({
  page,
}) => {
  await installMockBridge(page);
  await page.goto("/");
  await openCreateChannelDialog(page);
  const submit = page.getByTestId("create-channel-submit");
  await expect(submit).toBeDisabled();
  const disabled = await submit.evaluate((el) => ({
    color: getComputedStyle(el).color,
    fill: getComputedStyle(el).backgroundColor,
    opacity: getComputedStyle(el).opacity,
  }));
  expect(disabled.color).not.toBe(disabled.fill);
  expect(disabled.opacity).toBe("1");
  await page.getByTestId("create-channel-name").fill("blockui-state-check");
  await expect(submit).toBeEnabled();
  await submit.focus();
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Tab");
  await expect(submit).toBeFocused();
  await waitForAnimations(page);
  const state = await submit.evaluate((el) => {
    const s = getComputedStyle(el);
    return {
      color: s.color,
      fill: s.backgroundColor,
      outline: s.outlineColor,
      outlineWidth: parseFloat(s.outlineWidth),
      radius: parseFloat(s.borderRadius),
      height: el.getBoundingClientRect().height,
    };
  });
  expect(state.color).not.toBe(state.fill);
  expect(state.outline).not.toBe("rgba(0, 0, 0, 0)");
  expect(state.outlineWidth).toBeGreaterThanOrEqual(2);
  expect(state.radius).toBeGreaterThan(state.height / 2);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

for (const appearance of ["light", "dark"] as const) {
  test(`compact icons stay consistent in channel and DM headers (${appearance})`, async ({
    page,
  }) => {
    await page.addInitScript(
      (mode) => localStorage.setItem("buzz-blockui-appearance.v1", mode),
      appearance,
    );
    await installMockBridge(page);
    await page.goto("/");
    for (const channel of ["general", "alice-tyler"]) {
      await page.getByTestId(`channel-${channel}`).click();
      const header = page.getByTestId("chat-header");
      await expect(page.getByTestId("chat-title")).toHaveText(channel);
      const actions = [
        header.getByRole("button", { name: "Open Buzz Term", exact: true }),
        header.getByTestId("channel-members-trigger"),
        header.getByRole("button", { name: "Start huddle", exact: true }),
        header.getByTestId("channel-management-trigger"),
      ];
      for (const action of actions) {
        await expect(action).toBeVisible();
        const glyph = action.locator("svg").first();
        await expect(glyph).toHaveCSS("width", "16px");
        await expect(glyph).toHaveCSS("height", "16px");
        await expect(glyph).toHaveAttribute("stroke-width", "2");
        expect((await action.boundingBox())?.height).toBeGreaterThanOrEqual(32);
      }
      // A deliberately smaller utility icon must not be overridden by Button.
      const copy = header.getByRole("button", {
        name: `Copy channel name: ${channel}`,
      });
      await expect(copy.locator("svg")).toHaveCSS("width", "12px");
      const members = header.getByTestId("channel-members-trigger");
      await members.focus();
      await page.keyboard.press("Enter");
      await expect(page.getByTestId("members-sidebar")).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(page.getByTestId("members-sidebar")).not.toBeVisible();
      await waitForAnimations(page);
      await mkdir("test-results/blockui-icons", { recursive: true });
      await header.screenshot({
        path: `test-results/blockui-icons/${appearance}-${channel}-header.png`,
      });
    }
  });
}
