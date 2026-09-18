import { expect, test } from "@playwright/test";
import { waitForAnimations } from "../helpers/animations";

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto("/widgets.html");
  await page.getByRole("button", { name: "Everyday", exact: true }).click();
});

test("all nine widgets honor typography, intrinsic sizing, and narrow layouts", async ({
  page,
}) => {
  await expect(page.locator("[data-widget]")).toHaveCount(9);
  await page.evaluate(() => document.fonts.ready);
  await expect(page.locator(".hero-number")).toHaveCSS("font-size", "56px");
  await expect(page.locator(".track-details h3")).toHaveCSS(
    "font-size",
    "16px",
  );
  await expect(page.locator('[data-widget="Music"]')).toHaveCSS(
    "background-color",
    "rgb(255, 255, 255)",
  );
  await expect
    .poll(
      () =>
        page
          .locator("img")
          .evaluateAll((images) =>
            images.every(
              (image) =>
                (image as HTMLImageElement).complete &&
                (image as HTMLImageElement).naturalWidth > 0,
            ),
          ),
      { timeout: 15000 },
    )
    .toBe(true);
  const typography = await page
    .locator("[data-widget]")
    .evaluateAll((widgets) =>
      widgets.map((widget) => {
        const nodes = [...widget.querySelectorAll("*")].filter(
          (node) =>
            [...node.childNodes].some(
              (child) =>
                child.nodeType === Node.TEXT_NODE && child.textContent?.trim(),
            ) &&
            getComputedStyle(node).display !== "none" &&
            !node.closest(".widget-anatomy"),
        );
        return {
          title: widget.getAttribute("data-widget"),
          sizes: [...new Set(nodes.map((n) => getComputedStyle(n).fontSize))],
          weights: [
            ...new Set(nodes.map((n) => getComputedStyle(n).fontWeight)),
          ],
          families: [
            ...new Set(nodes.map((n) => getComputedStyle(n).fontFamily)),
          ],
          radius: getComputedStyle(widget).borderRadius,
          height: widget.getBoundingClientRect().height,
        };
      }),
    );
  for (const item of typography) {
    expect(item.sizes.length, item.title ?? "Widget").toBeLessThanOrEqual(3);
    expect(
      item.weights.every((w) => ["400", "500"].includes(w)),
      JSON.stringify(item),
    ).toBe(true);
    expect(item.families.every((f) => f.includes("Widget Cash Sans"))).toBe(
      true,
    );
    expect(item.radius).toBe("24px");
  }
  expect(new Set(typography.map((item) => item.height)).size).toBeGreaterThan(
    5,
  );
  await waitForAnimations(page);
  await page.screenshot({
    path: "test-results/widgets/gallery.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Use dark theme" }).click();
  await expect(page.locator("html")).toHaveClass("dark");
  await page.getByRole("button", { name: "Anatomy", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("8px base grid");
  await page.setViewportSize({ width: 375, height: 812 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    375,
  );
  await waitForAnimations(page);
  await page.screenshot({
    path: "test-results/widgets/mobile-anatomy.png",
    fullPage: true,
  });
});

test("weather, map, inbox, photos, calendar and activity respond to keyboard and pointer input", async ({
  page,
}) => {
  const weather = page.getByRole("region", { name: "Weather", exact: true });
  await weather
    .getByRole("button", { name: "Switch to degrees Celsius" })
    .click();
  await expect(weather.locator(".hero-number")).toHaveText("20°");
  const friday = weather.getByRole("button", { name: /^Fri:/ });
  await friday.focus();
  await page.keyboard.press("Space");
  await expect(friday).toHaveAttribute("aria-pressed", "true");
  await expect(weather.locator(".hero-number")).toHaveText("21°");
  await friday.click();
  await expect(friday).toHaveAttribute("aria-pressed", "false");
  const zoom = page.getByRole("button", { name: "Zoom in", exact: true });
  for (let i = 0; i < 4; i++) await zoom.click();
  await expect(zoom).toBeDisabled();
  await page.getByRole("button", { name: "Recenter map" }).click();
  await expect(page.getByRole("button", { name: "Zoom out" })).toBeDisabled();
  const email = page.getByRole("button", { name: /^Unread: Mia/ });
  await email.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog")).toContainText("Friday design session");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: /^Mia Chen,/ })).toBeFocused();
  await page
    .getByRole("button", { name: /^Enlarge photo:/ })
    .first()
    .click();
  await page.getByRole("button", { name: "Next photo" }).click();
  await expect(page.getByRole("dialog")).toContainText("2 of 4");
  await page.getByRole("button", { name: "Close details" }).click();
  await page.getByRole("button", { name: "View event" }).click();
  await expect(page.getByRole("dialog")).toContainText("Mia Chen");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Mon, 6,200 steps" }).click();
  await expect(page.locator(".activity-value")).toHaveText("6,200");
  await page.locator(".news-row").first().click();
  await expect(page.getByRole("dialog")).toContainText("Pocket parks");
});

test("music plays real audio and supports scrubbing and transport", async ({
  page,
}) => {
  const player = page.getByRole("region", { name: "Music", exact: true });
  await expect(
    player.getByRole("slider", { name: "Playback position" }),
  ).toBeEnabled();
  await player.getByRole("button", { name: "Play", exact: true }).click();
  await expect(
    player.getByRole("button", { name: "Pause", exact: true }),
  ).toBeVisible();
  await expect
    .poll(() =>
      player
        .locator("audio")
        .evaluate((audio: HTMLAudioElement) => audio.currentTime),
    )
    .toBeGreaterThan(0);
  await player.getByRole("button", { name: "Pause", exact: true }).click();
  await player.getByRole("button", { name: "Forward 10 seconds" }).click();
  await expect
    .poll(() =>
      player
        .locator("audio")
        .evaluate((audio: HTMLAudioElement) => audio.currentTime),
    )
    .toBeGreaterThanOrEqual(10);
  const slider = player.getByRole("slider");
  await slider.focus();
  await page.keyboard.press("End");
  await expect(slider).toHaveValue("48");
  await page.keyboard.press("Home");
  await expect(slider).toHaveValue("0");
});
