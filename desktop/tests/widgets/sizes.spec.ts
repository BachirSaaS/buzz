import { expect, test } from "@playwright/test";
import { waitForAnimations } from "../helpers/animations";

test("every widget has three deliberate, accessible compositions", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto("/widgets.html");
  await page
    .getByRole("button", { name: "Compare sizes", exact: true })
    .click();
  for (const collection of ["Buzz", "Everyday"]) {
    await page.getByRole("button", { name: collection, exact: true }).click();
    await expect(page.locator("[data-widget]")).toHaveCount(
      collection === "Buzz" ? 15 : 27,
    );
    await page.evaluate(() => document.fonts.ready);
    await expect
      .poll(() =>
        page
          .locator(".mood-grid img")
          .evaluateAll((images) =>
            images.every(
              (image) =>
                (image as HTMLImageElement).complete &&
                (image as HTMLImageElement).naturalWidth > 0,
            ),
          ),
      )
      .toBe(true);
    const cards = await page.locator("[data-widget]").evaluateAll((widgets) =>
      widgets.map((widget) => {
        const nodes = [...widget.querySelectorAll("*")].filter(
          (node) =>
            node.checkVisibility() &&
            !node.closest(".widget-anatomy") &&
            [...node.childNodes].some(
              (child) =>
                child.nodeType === Node.TEXT_NODE && child.textContent?.trim(),
            ),
        );
        return {
          name: `${widget.getAttribute("data-widget")} ${widget.getAttribute("data-size")}`,
          sizes: [
            ...new Set(nodes.map((node) => getComputedStyle(node).fontSize)),
          ],
          weights: [
            ...new Set(nodes.map((node) => getComputedStyle(node).fontWeight)),
          ],
          fonts: nodes.map((node) => getComputedStyle(node).fontFamily),
          overflow: widget.scrollWidth > widget.clientWidth + 1,
        };
      }),
    );
    for (const card of cards) {
      expect(card.sizes.length, JSON.stringify(card)).toBeLessThanOrEqual(3);
      expect(
        card.weights.every((weight) => ["400", "500"].includes(weight)),
        card.name,
      ).toBe(true);
      expect(
        card.fonts.every((font) => font.includes("Widget Cash Sans")),
        card.name,
      ).toBe(true);
      expect(card.overflow, card.name).toBe(false);
    }
    await waitForAnimations(page);
    await page.screenshot({
      path: `test-results/widgets/${collection.toLowerCase()}-sizes.png`,
      fullPage: true,
    });
  }
  await page.setViewportSize({ width: 375, height: 812 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    375,
  );
  await page.getByRole("button", { name: "Use dark theme" }).click();
  await waitForAnimations(page);
  await page.screenshot({
    path: "test-results/widgets/sizes-mobile-dark.png",
    fullPage: true,
  });
});

test("size switches disclose useful detail and preserve interaction state", async ({
  page,
}) => {
  await page.goto("/widgets.html");
  for (const [size, rows, tools] of [
    ["Small", 3, 1],
    ["Medium", 3, 2],
    ["Large", 3, 3],
  ] as const) {
    await page.getByRole("button", { name: size, exact: true }).click();
    await expect(
      page.locator(
        `[data-widget="Conversations"] ${size === "Small" ? ".avatar-launcher" : ".communication-row"}`,
      ),
    ).toHaveCount(rows);
    await expect(page.locator(".agent-tool")).toHaveCount(tools);
    await expect(
      page.getByText(/Direct message|Group conversation|\d+ members/),
    ).toHaveCount(0);
  }
  await page.getByRole("button", { name: "Small", exact: true }).click();
  await page.getByRole("button", { name: "Open Design crew huddle" }).click();
  await expect(page.getByRole("dialog")).toContainText("Mia");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Everyday", exact: true }).click();
  await expect(page.locator(".news-row")).toHaveCount(1);
  await expect(page.locator(".email-row")).toHaveCount(1);
  await expect(page.locator(".mood-grid button")).toHaveCount(2);
  await expect(page.locator(".weather-forecast")).toHaveCount(0);
  await page
    .getByRole("button", { name: "5-day forecast", exact: true })
    .click();
  await expect(
    page.getByRole("dialog").locator(".forecast-details p"),
  ).toHaveCount(5);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Switch to degrees Celsius" }).click();
  await page.getByRole("button", { name: "Medium", exact: true }).click();
  await expect(page.locator(".hero-number")).toHaveText("20°");
  await expect(page.locator(".weather-forecast button")).toHaveCount(5);
  await expect(page.locator(".news-row")).toHaveCount(3);
  await expect(page.locator(".email-preview")).toHaveCount(0);
  await expect(page.locator(".news-row img")).toHaveCount(0);
  await expect(
    page.locator(".up-next-widget .huddle-avatar-stack"),
  ).toHaveCount(1);
  await page.getByRole("button", { name: "Large", exact: true }).click();
  await expect(page.locator(".email-preview")).toHaveCount(3);
  await expect(page.locator(".news-row img")).toHaveCount(3);
  await expect(page.locator(".up-next-widget .participant-entry")).toHaveCount(
    3,
  );
  await page.getByRole("button", { name: "View event", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("Mia Chen");
});
