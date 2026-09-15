import { expect, type Page, test } from "@playwright/test";
import { createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { installMockBridge, TEST_IDENTITIES } from "../helpers/bridge";
import { waitForAnimations } from "../helpers/animations";
import { seedActiveIdentity } from "../helpers/onboarding";
import { openSettings } from "../helpers/settings";

const directory = "test-results/blockui";
test.use({ viewport: { width: 1440, height: 960 } });

async function capture(page: Page, name: string, hashes: Set<string>) {
  await page.evaluate(async () => {
    await Promise.all([
      document.fonts.load('400 14px "Inter Local"'),
      document.fonts.load('500 14px "Inter Local"'),
      document.fonts.load('400 14px "Cash Sans Mono Local"'),
    ]);
    await document.fonts.ready;
  });
  await expect
    .poll(() =>
      page.locator('[data-slot="avatar"]').evaluateAll((elements) =>
        elements.every((el) => {
          const image = el.querySelector('[data-slot="avatar-image"]');
          const fallback = el.querySelector('[data-slot="avatar-fallback"]');
          return [image, fallback].some(
            (child) =>
              child &&
              child.getClientRects().length > 0 &&
              getComputedStyle(child).visibility !== "hidden",
          );
        }),
      ),
    )
    .toBe(true);
  const unreadableInitials = await page
    .locator('[data-slot="avatar-fallback"]')
    .evaluateAll((elements) =>
      elements
        .filter((element) => {
          if (
            !element.textContent?.trim() ||
            !element.getClientRects().length
          ) {
            return false;
          }
          const style = getComputedStyle(element);
          return style.color === style.backgroundColor;
        })
        .map((element) => element.textContent),
    );
  expect(unreadableInitials).toEqual([]);
  await waitForAnimations(page);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await mkdir(directory, { recursive: true });
  const bytes = await page.screenshot({ path: `${directory}/${name}.png` });
  const hash = createHash("sha256").update(bytes).digest("hex");
  expect(hashes.has(hash), `Distinct screen: ${name}`).toBe(false);
  hashes.add(hash);
}

for (const mode of ["light", "dark"] as const) {
  test(`Block UI ${mode}: application routes and overlays`, async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript(
      (value) => localStorage.setItem("buzz-blockui-appearance.v1", value),
      mode,
    );
    await installMockBridge(page);
    await page.goto("/");
    await expect(page.getByTestId("open-settings")).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute(
      "data-substrate",
      "blockui",
    );
    expect(
      await page
        .locator("body")
        .evaluate((el) => getComputedStyle(el).fontFamily),
    ).toContain("Inter Local");
    const selected = page
      .locator('[data-sidebar="menu-button"][data-active="true"]')
      .first();
    const contrast = await selected.evaluate((el) => ({
      color: getComputedStyle(el).color,
      background: getComputedStyle(el).backgroundColor,
    }));
    expect(contrast.color).not.toBe(contrast.background);
    const hashes = new Set<string>();
    await capture(page, `${mode}-inbox`, hashes);
    await page.getByTestId("channel-general").click();
    await expect(page.getByTestId("chat-title")).toHaveText("general");
    await capture(page, `${mode}-conversation`, hashes);
    await page.getByTestId("open-search").click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await capture(page, `${mode}-search`, hashes);
    await page.keyboard.press("Escape");
    for (const route of ["pulse", "agents", "workflows", "projects"] as const) {
      if (route === "pulse") {
        await page.getByTestId("open-pulse-view").click();
      } else {
        await page
          .getByTestId("pulse-app-navigation")
          .getByRole("button", {
            name: route[0].toUpperCase() + route.slice(1),
            exact: true,
          })
          .click();
      }
      await expect(page).toHaveURL(new RegExp(route));
      if (route === "projects") {
        await expect(page.getByTestId("projects-activity-intro")).toBeVisible();
        await expect(
          page.getByRole("button", { name: /View .+'s profile/ }).first(),
        ).toBeVisible();
      }

      await capture(page, `${mode}-${route}`, hashes);
    }
    expect(errors).toEqual([]);
  });

  test(`Block UI ${mode}: every settings surface`, async ({ page }) => {
    test.setTimeout(150_000);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript(
      (value) => localStorage.setItem("buzz-blockui-appearance.v1", value),
      mode,
    );
    await installMockBridge(page);
    await page.goto("/");
    await openSettings(page, "appearance");
    const hashes = new Set<string>();
    for (const section of [
      "appearance",
      "profile",
      "notifications",
      "voice",
      "shortcuts",
      "custom-emoji",
      "local-archive",
      "channel-templates",
      "hosted-communities",
      "agents",
      "compute",
      "experimental",
      "mobile",
      "updates",
    ]) {
      await page.getByTestId(`settings-nav-${section}`).click();
      await expect(page.getByTestId("settings-content-surface")).toBeVisible();
      await capture(page, `${mode}-settings-${section}`, hashes);
    }
    expect(errors).toEqual([]);
  });
}

test("appearance survives reload; keyboard selection and zoom retain the Block UI contract", async ({
  page,
}) => {
  await installMockBridge(page);
  await page.goto("/");
  await openSettings(page, "appearance");
  await page.getByRole("button", { name: "Dark", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("html")).toHaveClass(/dark/);
  await page.reload();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await expect(
    page.getByRole("button", { name: "Dark", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  const title = page.getByRole("heading", { name: "Appearance", exact: true });
  const before = await title.evaluate((el) =>
    parseFloat(getComputedStyle(el).fontSize),
  );
  await page.keyboard.press(
    process.platform === "darwin" ? "Meta+=" : "Control+=",
  );
  await expect
    .poll(() =>
      title.evaluate((el) => parseFloat(getComputedStyle(el).fontSize)),
    )
    .toBeGreaterThan(before);
});

for (const mode of ["light", "dark"] as const) {
  test(`Block UI ${mode}: onboarding surfaces`, async ({ page }) => {
    test.setTimeout(90_000);
    await page.addInitScript(
      (value) => localStorage.setItem("buzz-blockui-appearance.v1", value),
      mode,
    );
    await seedActiveIdentity(page, { ...TEST_IDENTITIES.tyler, username: "" });
    await installMockBridge(page, undefined, { skipOnboardingSeed: true });
    await page.goto("/");
    const hashes = new Set<string>();
    await expect(page.getByTestId("onboarding-display-name")).toBeVisible();
    await capture(page, `${mode}-onboarding-profile`, hashes);
    await page.getByTestId("onboarding-display-name").fill("Block UI preview");
    await page.getByTestId("onboarding-next").click();
    await expect(page.getByTestId("onboarding-page-avatar")).toBeVisible();
    await capture(page, `${mode}-onboarding-avatar`, hashes);
    await page.getByTestId("onboarding-skip").click();
    await expect(page.getByTestId("open-settings")).toBeVisible();
  });
  test(`Block UI ${mode}: active huddle`, async ({ page }) => {
    await page.addInitScript(
      (value) => localStorage.setItem("buzz-blockui-appearance.v1", value),
      mode,
    );
    await installMockBridge(page, {
      huddle: {
        parentChannelId: "9a1657ac-f7aa-5db0-b632-d8bbeb6dfb50",
        ephemeralChannelId: "11111111-1111-4111-8111-111111111111",
        members: [
          { pubkey: TEST_IDENTITIES.tyler.pubkey, role: "member" },
          { pubkey: TEST_IDENTITIES.alice.pubkey, role: "bot" },
        ],
        transcriptionEnabled: true,
      },
    });
    await page.goto("/");
    await expect(
      page.getByRole("button", { name: "Stop transcript", exact: true }),
    ).toBeVisible();
    await expect(
      page.locator('.buzz-huddle-shell[data-huddle-open="true"]'),
    ).toBeVisible();
    const hint = page.getByRole("dialog", { name: "Headphones recommended" });
    await expect(hint.getByText("Headphones help prevent echo")).toBeVisible();
    const colors = await hint.evaluate((element) => {
      const surface = getComputedStyle(element);
      const paragraph = element.querySelector("p");
      if (!paragraph) throw new Error("Missing headphones hint text");
      const text = getComputedStyle(paragraph);
      return { background: surface.backgroundColor, foreground: text.color };
    });
    expect(colors.foreground).not.toBe(colors.background);
    expect(colors.background).not.toBe("rgba(0, 0, 0, 0)");
    expect(colors.background).toMatch(/^rgb\(/);
    await capture(page, `${mode}-huddle`, new Set());
    await hint.getByRole("button", { name: "Got it" }).click();
    await expect(hint).not.toBeVisible();
  });
}
