import {
  arrangeWindows,
  readActiveCanvas,
  openWindowPicker,
} from "../helpers/canvas";
import { expect, test, type Page, type Locator } from "@playwright/test";
import { installMockBridge } from "../helpers/bridge";
import { waitForAnimations } from "../helpers/animations";

async function add(page: Page, name: RegExp, query: string) {
  await openWindowPicker(page);
  const dialog = page.getByRole("dialog", { name: "Add a window" });
  await dialog.getByRole("textbox", { name: "Search views" }).fill(query);
  await dialog.getByRole("button", { name }).click();
  await expect(dialog).toHaveCount(0);
}
const panes = (page: Page) => page.locator("[data-pane]");
const pane = (page: Page, id: string) => page.locator(`[data-pane="${id}"]`);
async function box(locator: Locator) {
  const result = await locator.boundingBox();
  if (!result) throw new Error("Missing layout box");
  return result;
}
async function drag(
  page: Page,
  handle: Locator,
  target: { x: number; y: number },
) {
  const from = await box(handle);
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(target.x, target.y, { steps: 6 });
}
async function stored(page: Page) {
  return JSON.stringify(await readActiveCanvas(page));
}
async function clean(page: Page) {
  await expect(page.getByTestId("panel-tab-ghost")).toBeHidden();
  await expect(page.getByTestId("panel-tab-marker")).toBeHidden();
  await expect(page.getByTestId("panel-edge-cue")).toBeHidden();
  await expect(page.locator("body")).not.toHaveCSS("cursor", "grabbing");
  await expect(page.locator("body")).not.toHaveCSS("cursor", "col-resize");
  await expect(page.getByTestId("panel-workspace")).not.toHaveAttribute(
    "data-dragging",
  );
}
test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.route("**/__pulse/briefing", (r) =>
    r.fulfill({ json: { highlights: [] } }),
  );
  await page.route("**/__chief", (r) => r.fulfill({ status: 503, json: {} }));
  await installMockBridge(page);
  await page.goto("/#/pulse?feed=conversation");
  await add(page, /^Weather Widgets$/, "weather");
  await arrangeWindows(page, "Columns");
  await expect(panes(page)).toHaveCount(2);
});

test("equal sibling panes swap live with fixed sizes; save only on release", async ({
  page,
}) => {
  const a = pane(page, "main"),
    b = pane(page, "widget:weather");
  const beforeA = await box(a),
    beforeB = await box(b),
    snapshot = await stored(page);
  await drag(page, a.locator(".panel-dock-header-space"), {
    x: beforeB.x + beforeB.width / 2,
    y: beforeB.y + 60,
  });
  await expect.poll(async () => (await box(b)).x).toBe(beforeA.x);
  expect((await box(a)).width).toBe(beforeA.width);
  expect(await stored(page)).toBe(snapshot);
  await page.mouse.up();
  await clean(page);
  await expect.poll(async () => (await box(a)).x).toBe(beforeB.x);
  await page.reload();
  await expect.poll(async () => (await box(a)).x).toBe(beforeB.x);
});

test("tab header takes priority, click threshold selects, extraction preserves content and modes", async ({
  page,
}) => {
  await add(page, /#general/, "general");
  const channel = panes(page).filter({
    has: page.getByTestId("message-input"),
  });
  await channel.getByTestId("message-input").fill("Draft survives regrouping");
  const id = await channel.getAttribute("data-pane");
  if (!id) throw new Error("Missing channel id");
  const target = await box(pane(page, "main"));
  await drag(page, channel.getByRole("button", { name: /^Switch view,/ }), {
    x: target.x + 40,
    y: target.y + 10,
  });
  await expect(page.getByTestId("panel-tab-marker")).toBeVisible();
  await expect(page.getByTestId("panel-edge-cue")).toBeHidden();
  await expect(page.getByTestId("panel-tab-ghost")).toHaveCSS(
    "pointer-events",
    "none",
  );
  await expect(panes(page)).toHaveCount(3);
  await page.mouse.up();
  await expect(panes(page)).toHaveCount(2);
  const main = pane(page, "main");
  await expect(main.getByTestId("message-input")).toHaveText(
    "Draft survives regrouping",
  );
  const messages = main.getByRole("tab", { name: "Messages", exact: true });
  const click = await box(messages);
  await drag(page, messages, {
    x: click.x + click.width / 2 + 4,
    y: click.y + click.height / 2,
  });
  await expect(page.getByTestId("panel-tab-ghost")).toBeHidden();
  await page.mouse.up();
  await expect(messages).toHaveAttribute("aria-selected", "true");
  await messages.focus();
  await page.keyboard.press("ArrowRight");
  await expect(main.getByRole("tab", { name: "#general" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  const mainBox = await box(main);
  await drag(page, main.getByRole("tab", { name: "#general" }), {
    x: mainBox.x + mainBox.width / 2,
    y: mainBox.y + mainBox.height - 4,
  });
  await expect(page.getByTestId("panel-edge-cue")).toBeVisible();
  await page.mouse.up();
  await expect(panes(page)).toHaveCount(3);
  await expect(page.getByTestId("message-input")).toHaveText(
    "Draft survives regrouping",
  );
  await arrangeWindows(page, "Freeform");
  await expect(page.getByTestId("message-input")).toHaveText(
    "Draft survives regrouping",
  );
  await arrangeWindows(page, "Columns");
  await expect(page.getByTestId("message-input")).toHaveText(
    "Draft survives regrouping",
  );
  await expect(panes(page)).toHaveCount(3);
  await waitForAnimations(page);
  await page.screenshot({ path: "test-results/panel-workspace/nested.png" });
});

test("unequal panes keep their size during drag; edge splits commit on release", async ({
  page,
}) => {
  await arrangeWindows(page, "Focus");
  const a = pane(page, "main"),
    b = pane(page, "widget:weather");
  const beforeA = await box(a),
    beforeB = await box(b),
    snapshot = await stored(page);
  expect(beforeA.width).not.toBe(beforeB.width);
  await drag(page, a.locator(".panel-dock-header-space"), {
    x: beforeB.x + beforeB.width / 2,
    y: beforeB.y + beforeB.height / 2,
  });
  expect((await box(a)).width).toBe(beforeA.width);
  expect(await box(b)).toEqual(beforeB);
  await page.mouse.move(
    beforeB.x + beforeB.width / 2,
    beforeB.y + beforeB.height - 4,
  );
  await expect(page.getByTestId("panel-edge-cue")).toBeVisible();
  expect(await stored(page)).toBe(snapshot);
  expect((await box(a)).height).toBe(beforeA.height);
  await page.mouse.up();
  await expect(page.getByRole("separator")).toHaveAttribute(
    "aria-orientation",
    "horizontal",
  );
  expect((await box(a)).y).toBeGreaterThan((await box(b)).y);
  expect((await box(a)).width).toBe(beforeA.width + beforeB.width + 8);
  await clean(page);
});

for (const seam of [
  "Escape",
  "blur",
  "pointercancel",
  "lostpointercapture",
  "resize",
] as const) {
  test(`${seam} cancels a live swap and clears capture and previews`, async ({
    page,
  }) => {
    const a = pane(page, "main"),
      b = pane(page, "widget:weather");
    const beforeA = await box(a),
      beforeB = await box(b),
      snapshot = await stored(page);
    await drag(page, a.locator(".panel-dock-header-space"), {
      x: beforeB.x + beforeB.width / 2,
      y: beforeB.y + 60,
    });
    await expect.poll(async () => (await box(b)).x).toBe(beforeA.x);
    if (seam === "Escape") await page.keyboard.press("Escape");
    else if (seam === "resize")
      await page.setViewportSize({ width: 1400, height: 900 });
    else
      await page.evaluate((type) => {
        if (type === "blur") window.dispatchEvent(new Event(type));
        else if (type === "lostpointercapture")
          document
            .querySelector<HTMLElement>('[data-pane="main"] .panel-dock-header')
            ?.releasePointerCapture(1);
        else window.dispatchEvent(new PointerEvent(type, { pointerId: 1 }));
      }, seam);
    await page.mouse.up();
    await clean(page);
    expect(await stored(page)).toBe(snapshot);
    await expect.poll(async () => (await box(a)).x).toBe(beforeA.x);
    expect((await box(b)).x).toBeGreaterThan((await box(a)).x);
  });
}

test("nested separators resize locally with bounded keyboard values, rollback, and reduced motion", async ({
  page,
}) => {
  await add(page, /^Music Widgets$/, "music");
  const main = pane(page, "main"),
    before = await box(main);
  const divider = page.getByRole("separator", {
    name: "Resize split 2",
    exact: true,
  });
  await expect(divider).toBeVisible();
  await divider.focus();
  await page.keyboard.press("ArrowRight");
  await expect(divider).toHaveAttribute("aria-valuenow", "53");
  expect(await box(main)).toEqual(before);
  await page.keyboard.press("Home");
  expect(await divider.getAttribute("aria-valuenow")).toBe(
    await divider.getAttribute("aria-valuemin"),
  );
  await page.keyboard.press("End");
  expect(await divider.getAttribute("aria-valuenow")).toBe(
    await divider.getAttribute("aria-valuemax"),
  );
  const snapshot = await stored(page),
    ratio = await divider.getAttribute("aria-valuenow"),
    at = await box(divider);
  await drag(page, divider, { x: at.x - 100, y: at.y + at.height / 2 });
  expect(await stored(page)).toBe(snapshot);
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await expect(divider).toHaveAttribute("aria-valuenow", ratio ?? "");
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key.startsWith("buzz-workspaces.v1:"))
        throw new DOMException("Full", "QuotaExceededError");
      original.call(this, key, value);
    };
  });
  await divider.focus();
  await page.keyboard.press("ArrowLeft");
  await expect(
    page.getByText("Could not save this workspace. Please try again."),
  ).toBeVisible();
  await expect(divider).toHaveAttribute("aria-valuenow", ratio ?? "");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(main).toHaveCSS("transition-duration", "0s");
  await clean(page);
});

test("unmount cancels a tab drag and grouped closes remove saved metadata", async ({
  page,
}) => {
  const mainBox = await box(pane(page, "main"));
  await drag(
    page,
    pane(page, "widget:weather").getByRole("button", { name: /^Switch view,/ }),
    {
      x: mainBox.x + 40,
      y: mainBox.y + 10,
    },
  );
  await expect(page.getByTestId("panel-tab-ghost")).toBeVisible();
  await page.evaluate(() => {
    location.hash = "/pulse?feed=home";
  });
  await expect(page.getByTestId("panel-workspace")).toHaveCount(0);
  await page.mouse.up();
  await expect(page.locator("body")).not.toHaveCSS("cursor", "grabbing");
  await page.goto("/#/pulse?feed=conversation");
  await expect(panes(page)).toHaveCount(2);
  const target = await box(pane(page, "main"));
  await drag(
    page,
    pane(page, "widget:weather").getByRole("button", { name: /^Switch view,/ }),
    {
      x: target.x + 40,
      y: target.y + 10,
    },
  );
  await page.mouse.up();
  await expect(panes(page)).toHaveCount(1);
  await pane(page, "main")
    .getByRole("button", { name: "Close Weather window", exact: true })
    .click();
  const snapshot = JSON.parse((await stored(page)) ?? "{}");
  expect(snapshot.windows).toEqual([]);
  expect(JSON.stringify(snapshot.panels)).not.toContain("widget:weather");
  await expect(page.getByTestId("pulse-main-container")).toBeVisible();
});

test("undersized workspaces retain panes but reject a new edge split", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1000, height: 260 });
  const a = pane(page, "main"),
    b = pane(page, "widget:weather");
  const target = await box(b),
    snapshot = await stored(page);
  // Existing horizontal pair fits; the proposed two vertical minima plus gap do not.
  expect(target.height).toBeLessThan(208);
  await drag(page, a.getByRole("button", { name: /^Switch view,/ }), {
    x: target.x + target.width / 2,
    y: target.y + target.height - 3,
  });
  await expect(page.getByTestId("panel-edge-cue")).toBeHidden();
  await page.mouse.up();
  expect(await stored(page)).toBe(snapshot);
  await expect(panes(page)).toHaveCount(2);
  await clean(page);
});
