import { expect, test } from "@playwright/test";
import { waitForAnimations } from "../helpers/animations";

test("small Buzz cards lead with avatars, retain keyboard actions, and quiet agent status", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/widgets.html");
  await page.getByRole("button", { name: "Small", exact: true }).click();
  await expect(page.locator("[data-widget] > .widget-heading")).toHaveCount(5);
  for (const heading of await page
    .locator("[data-widget] > .widget-heading")
    .all()) {
    await expect(heading).toBeVisible();
    await expect(heading).toHaveCSS("font-size", "16px");
    await expect(heading).toHaveCSS("font-weight", "500");
  }
  const agent = page.getByRole("region", {
    name: "Agent activity",
    exact: true,
  });
  await expect(
    agent.locator(".agent-identity, .section-anchor, .agent-open"),
  ).toHaveCount(0);
  await expect(agent.locator(".compact-agent-state")).toHaveCSS(
    "font-size",
    "16px",
  );
  await agent.getByRole("button", { name: /Run interaction checks/ }).click();
  await expect(page.getByRole("dialog")).toContainText(
    "Checking keyboard navigation",
  );
  await page.keyboard.press("Escape");
  for (const name of ["Mentions", "Conversations", "Active channels"]) {
    const card = page.getByRole("region", { name, exact: true });
    await expect(card.locator(".communication-copy")).toHaveCount(0);
    await expect(card.locator(".avatar-launcher")).toHaveCount(3);
    const first = card.getByRole("button").first();
    await expect(first).toHaveAccessibleName(/^Open /);
    await expect(first).toHaveCSS("width", "64px");
    await first.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(first).toBeFocused();
  }
  const huddle = page.getByRole("region", { name: "Huddle", exact: true });
  await expect(huddle.getByRole("button")).toHaveCount(1);
  await huddle.getByRole("button", { name: "Open Design crew huddle" }).click();
  await page.getByRole("button", { name: "Start huddle", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(1);
  await expect(page.getByRole("dialog")).toContainText("Design huddle");
  await page.getByRole("button", { name: "Leave huddle" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect
    .poll(() =>
      page
        .locator(".avatar-launcher img")
        .evaluateAll(
          (images) =>
            images.length > 0 &&
            images.every(
              (image) => (image as HTMLImageElement).naturalWidth > 0,
            ),
        ),
    )
    .toBe(true);
  await waitForAnimations(page);
  await page.screenshot({
    path: "/tmp/buzz-small-avatar-widgets.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 375, height: 812 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    375,
  );
});
