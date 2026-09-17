import { expect, test } from "@playwright/test";
import { waitForAnimations } from "../helpers/animations";

test("Buzz widgets preserve the type contract and support keyboard details and huddle controls", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto("/widgets.html");
  await expect(page.locator("[data-widget]")).toHaveCount(5);
  await expect(
    page.getByText(/sample data|fake data|interactive preview/i),
  ).toHaveCount(0);
  await page.evaluate(() => document.fonts.ready);
  const styles = await page.locator("[data-widget]").evaluateAll((widgets) =>
    widgets.map((widget) => {
      const nodes = [...widget.querySelectorAll("*")].filter(
        (node) =>
          [...node.childNodes].some(
            (child) =>
              child.nodeType === Node.TEXT_NODE && child.textContent?.trim(),
          ) && !node.closest(".widget-anatomy"),
      );
      return {
        title: widget.getAttribute("data-widget"),
        sizes: [
          ...new Set(nodes.map((node) => getComputedStyle(node).fontSize)),
        ],
        weights: [
          ...new Set(nodes.map((node) => getComputedStyle(node).fontWeight)),
        ],
        fonts: nodes.map((node) => getComputedStyle(node).fontFamily),
        radius: getComputedStyle(widget).borderRadius,
      };
    }),
  );
  for (const style of styles) {
    expect(style.sizes.length, JSON.stringify(style)).toBeLessThanOrEqual(3);
    expect(
      style.weights.every((weight) => ["400", "500"].includes(weight)),
    ).toBe(true);
    expect(style.fonts.every((font) => font.includes("Widget Cash Sans"))).toBe(
      true,
    );
    expect(style.radius).toBe("24px");
  }
  const tool = page.getByRole("button", { name: /Run interaction checks/ });
  await tool.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog")).toContainText(
    "Checking keyboard navigation",
  );
  await page.keyboard.press("Escape");
  await expect(tool).toBeFocused();
  await page.getByRole("button", { name: "Start huddle", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("Design huddle");
  await page.getByRole("button", { name: "Mute", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Unmute", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Leave huddle" }).click();
  await page
    .locator('[data-widget="Mentions"] .communication-row')
    .first()
    .click();
  await expect(page.getByRole("dialog")).toContainText("fresh pair of eyes");
  await page.keyboard.press("Escape");
  await waitForAnimations(page);
  await page.screenshot({
    path: "test-results/widgets/buzz-gallery.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Use dark theme" }).click();
  await waitForAnimations(page);
  await page.screenshot({
    path: "test-results/widgets/buzz-gallery-dark.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 375, height: 812 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    375,
  );
  await waitForAnimations(page);
  await page.screenshot({
    path: "test-results/widgets/buzz-mobile.png",
    fullPage: true,
  });
});
