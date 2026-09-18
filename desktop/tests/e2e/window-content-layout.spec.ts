import { expect, test } from "@playwright/test";
import { installMockBridge } from "../helpers/bridge";
import { waitForAnimations } from "../helpers/animations";
test("connected conversations and activity fill the area immediately below their toolbar", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1800, height: 1200 });
  await page.route("**/__pulse/briefing", (r) =>
    r.fulfill({ json: { highlights: [] } }),
  );
  await page.route("**/__chief", (r) => r.fulfill({ status: 503, json: {} }));
  await installMockBridge(page);
  await page.goto("/#/pulse?feed=conversation");
  await page
    .getByRole("button", { name: "Split Messages window", exact: true })
    .click();
  let picker = page.getByTestId("empty-split-view");
  await picker.getByRole("textbox", { name: "Search views" }).fill("general");
  await picker.getByRole("button", { name: /#general/ }).click();
  await page
    .getByRole("button", { name: "Split #general window", exact: true })
    .click();
  picker = page.getByTestId("empty-split-view");
  await picker.getByRole("textbox", { name: "Search views" }).fill("agent");
  await picker.getByRole("button", { name: /^Agent activity Agents/ }).click();
  await expect(page.getByTestId("message-input")).toBeVisible();
  for (const title of ["#general", "Agent activity"]) {
    const view = page.getByRole("region", {
      name: `${title} view`,
      exact: true,
    });
    await expect(view.locator(".canvas-content-host")).toHaveCount(1);
    const header = await view.getByTestId("window-toolbar").boundingBox();
    const content = await view.locator(".canvas-content-host").boundingBox();
    if (!header || !content) throw new Error("Missing window geometry");
    expect(content.y).toBeCloseTo(header.y + header.height, 0);
    const first = await view
      .locator(".canvas-content-host > *")
      .first()
      .boundingBox();
    expect(first?.y).toBeCloseTo(content.y, 0);
  }
  const canvas = page.getByTestId("pulse-canvas");
  const canvasBox = await canvas.boundingBox();
  expect(canvasBox?.y).toBe(64);
  expect(canvasBox && canvasBox.y + canvasBox.height).toBe(1184);
  const arrange = page.getByRole("button", {
    name: "Arrange windows",
    exact: true,
  });
  await arrange.click();
  await expect(
    page.getByRole("menuitemradio", { name: "Focus layout", exact: true }),
  ).toHaveAttribute("aria-checked", "true");
  await page.keyboard.press("Escape");
  await expect(arrange).toBeFocused();
  await arrange.click();
  await page
    .getByRole("menuitemradio", { name: "Freeform layout", exact: true })
    .click();
  await expect(canvas).toHaveAttribute("data-layout", "freeform");
  await expect(page.getByRole("menu", { name: "Arrange windows" })).toHaveCount(
    0,
  );
  await expect(
    page.getByRole("button", {
      name: /^(Focus|Grid|Columns|Freeform) layout$/,
    }),
  ).toHaveCount(0);
  await waitForAnimations(page);
  await page.screenshot({
    path: "test-results/window-toolbar/full-height-content.png",
  });
});
