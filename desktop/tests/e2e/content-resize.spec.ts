import { expect, test, type Locator } from "@playwright/test";
import { installMockBridge } from "../helpers/bridge";
import { waitForAnimations } from "../helpers/animations";

const storageKey = "buzz.appearance.contentWidth";
async function box(locator: Locator) {
  const value = await locator.boundingBox();
  if (!value) throw new Error("Missing resize surface");
  return value;
}

async function gripPoint(handle: Locator) {
  return handle
    .locator("[data-resize-hit]")
    .evaluate((path: SVGPathElement) => {
      const point = path.getPointAtLength(path.getTotalLength() / 2);
      const matrix = path.getScreenCTM();
      if (!matrix) throw new Error("Missing grip transform");
      const screen = new DOMPoint(point.x, point.y).matrixTransform(matrix);
      return { x: screen.x, y: screen.y, width: 0, height: 0 };
    });
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.route("**/__pulse/briefing", (route) =>
    route.fulfill({ json: { highlights: [] } }),
  );
  await page.route("**/__chief", (route) =>
    route.fulfill({ status: 503, json: { error: "Offline for resize test" } }),
  );
  await installMockBridge(page);
  await page.goto("/#/pulse?feed=briefing");
  await expect(page.getByTestId("content-resize-handle")).toBeVisible();
});

test("content resize stays centered during dragging and persists across workspaces and smaller windows", async ({
  page,
}) => {
  const frame = page.getByTestId("pulse-main-container");
  const handle = page.getByTestId("content-resize-handle");
  const before = await box(frame);
  const grip = await gripPoint(handle);
  const savedBefore = await page.evaluate(
    (key) => localStorage.getItem(key),
    storageKey,
  );
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    grip.x + grip.width / 2 + 80,
    grip.y + grip.height / 2 - 70,
    { steps: 8 },
  );
  await expect(frame).toHaveAttribute("data-content-width", "custom");
  const during = await box(frame);
  expect(during.width).toBeCloseTo(before.width + 160, 0);
  expect(during.height).toBeCloseTo(before.height - 140, 0);
  expect(during.x + during.width / 2).toBeCloseTo(720, 0);
  expect(during.y + during.height / 2).toBeCloseTo(
    before.y + before.height / 2,
    0,
  );
  await expect(
    page.getByTestId("pulse-briefing").locator(":scope > div.grid"),
  ).toHaveCSS("max-width", "none");
  expect(
    await page.evaluate((key) => localStorage.getItem(key), storageKey),
  ).toBe(savedBefore);
  await page.mouse.up();
  const saved = await page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key) ?? "null"),
    storageKey,
  );
  expect(saved).toEqual({
    mode: "custom",
    width: Math.round(during.width),
    height: Math.round(during.height),
  });
  await page.reload();
  await expect(frame).toHaveAttribute("data-content-width", "custom");
  expect(await box(frame)).toEqual(during);
  await page
    .getByTestId("pulse-app-navigation")
    .getByRole("button", { name: "Messages", exact: true })
    .click();
  expect(await box(frame)).toEqual(during);
  await page.setViewportSize({ width: 700, height: 600 });
  const smaller = await box(frame);
  expect(smaller.x + smaller.width / 2).toBeCloseTo(350, 0);
  expect(smaller.width).toBeLessThan(during.width);
  expect(smaller.y).toBeGreaterThanOrEqual(0);
  const reachable = await box(handle);
  expect(reachable.x + reachable.width).toBeLessThanOrEqual(700);
  expect(reachable.y + reachable.height).toBeLessThanOrEqual(600);
  await page.setViewportSize({ width: 1440, height: 1000 });
  expect(await box(frame)).toEqual(during);
  await waitForAnimations(page);
  await page.screenshot({
    path: "test-results/pulse-prototype/content-resized.png",
  });
});

test("content resize supports keyboard steps, cancellation and reset", async ({
  page,
}) => {
  const frame = page.getByTestId("pulse-main-container");
  const handle = page.getByTestId("content-resize-handle");
  const original = await box(frame);
  await handle.focus();
  await page.keyboard.press("ArrowRight");
  expect((await box(frame)).width).toBeCloseTo(original.width + 16, 0);
  await page.keyboard.press("Shift+ArrowUp");
  const resized = await box(frame);
  expect(resized.height).toBeCloseTo(original.height - 64, 0);
  const saved = await page.evaluate(
    (key) => localStorage.getItem(key),
    storageKey,
  );
  for (const interruption of ["escape", "blur"]) {
    const grip = await gripPoint(handle);
    await page.mouse.move(grip.x, grip.y);
    await page.mouse.down();
    await page.mouse.move(grip.x + 35, grip.y - 40);
    expect((await box(frame)).width).toBeGreaterThan(resized.width);
    if (interruption === "escape") await page.keyboard.press("Escape");
    else await page.evaluate(() => window.dispatchEvent(new Event("blur")));
    await page.mouse.up();
    expect(await box(frame)).toEqual(resized);
    expect(
      await page.evaluate((key) => localStorage.getItem(key), storageKey),
    ).toBe(saved);
  }
  await handle.focus();
  await page.keyboard.press("Home");
  await expect(frame).toHaveAttribute("data-content-width", "standard");
  expect(await box(frame)).toEqual(original);
  await page.keyboard.press("ArrowLeft");
  const resetGrip = await gripPoint(handle);
  await page.mouse.dblclick(resetGrip.x, resetGrip.y);
  await expect(frame).toHaveAttribute("data-content-width", "standard");
  expect(await box(frame)).toEqual(original);
});

test("resize grip is symmetric at the apex and springs outward around its corner center", async ({
  page,
}) => {
  const handle = page.getByTestId("content-resize-handle");
  const stroke = handle.locator("svg");
  const path = stroke.locator("path:not([data-resize-hit])");
  await page.mouse.move(0, 0);
  const geometry = await path.evaluate((element: SVGPathElement) => {
    const length = element.getTotalLength();
    const start = element.getPointAtLength(0);
    const end = element.getPointAtLength(length);
    const apex = element.getPointAtLength(length / 2);
    return {
      length,
      start: [start.x, start.y],
      end: [end.x, end.y],
      apex: [apex.x, apex.y],
    };
  });
  expect(geometry.length).toBeCloseTo(48, 1);
  expect(geometry.start[0]).toBeCloseTo(geometry.end[1], 1);
  expect(geometry.start[1]).toBeCloseTo(geometry.end[0], 1);
  expect(geometry.apex[0]).toBeCloseTo(geometry.apex[1], 1);
  await expect(path).toHaveCSS("stroke-width", "3px");
  await expect(stroke).toHaveCSS("opacity", "0.5");
  const before = await box(stroke);
  {
    const point = await gripPoint(handle);
    await page.mouse.move(point.x, point.y);
  }
  await expect(path).toHaveCSS("stroke-width", "4px");
  await expect(stroke).toHaveCSS("opacity", "0.8");
  await expect(stroke).toHaveCSS(
    "transform",
    "matrix(1.16667, 0, 0, 1.16667, 0, 0)",
  );
  const after = await box(stroke);
  const outwardGrowth = (before.width - 40) / 6;
  expect(after.x + after.width).toBeCloseTo(
    before.x + before.width + outwardGrowth,
    1,
  );
  expect(after.y + after.height).toBeCloseTo(
    before.y + before.height + outwardGrowth,
    1,
  );
  expect((geometry.length * after.width) / before.width).toBeCloseTo(56, 1);
  await expect(stroke).toHaveCSS("transform-origin", "40px 40px");
  const panel = await box(page.getByTestId("pulse-main-container"));
  await waitForAnimations(page);
  await page.screenshot({
    path: "test-results/pulse-prototype/resize-grip-hover.png",
    clip: {
      x: panel.x + panel.width - 110,
      y: panel.y + panel.height - 110,
      width: 140,
      height: 140,
    },
  });
  await page.mouse.move(0, 0);
  {
    const point = await gripPoint(handle);
    await page.mouse.move(point.x, point.y);
  }
  await page.mouse.move(0, 0);
  await expect(stroke).toHaveCSS("opacity", "0.5");
  await expect(path).toHaveCSS("stroke-width", "3px");
  await expect(stroke).toHaveCSS("transform", "matrix(1, 0, 0, 1, 0, 0)");
  await waitForAnimations(page);
  await page.screenshot({
    path: "test-results/pulse-prototype/resize-grip-rest.png",
    clip: {
      x: panel.x + panel.width - 110,
      y: panel.y + panel.height - 110,
      width: 140,
      height: 140,
    },
  });
  await page.emulateMedia({ reducedMotion: "reduce" });
  {
    const point = await gripPoint(handle);
    await page.mouse.move(point.x, point.y);
  }
  await expect(stroke).toHaveCSS("opacity", "0.8");
  await expect(path).toHaveCSS("stroke-width", "4px");
});
