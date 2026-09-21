import { expect, test } from "@playwright/test";
import { installMockBridge } from "../helpers/bridge";
import { arrangeWindows } from "../helpers/canvas";

// Run against a fresh pnpm build:e2e, with DevTools closed:
// pnpm exec playwright test --config=playwright.workspace-perf.config.ts
// Browser CPU/layout counters avoid including Playwright polling/network time.
// This is a comparative instrument, not a machine-dependent timing gate.
test("measure workspace switches, window focus and split resize", async ({
  page,
}) => {
  await page.clock.setFixedTime(new Date("2026-09-18T12:00:00Z"));
  await page.route("**/__pulse/briefing", (r) =>
    r.fulfill({ json: { highlights: [] } }),
  );
  await page.route("**/__chief", (r) => r.fulfill({ status: 503, json: {} }));
  await installMockBridge(page);
  await page.goto("/#/pulse?workspace=messages&feed=conversation");
  await expect(page.getByTestId("pulse-combined-view")).toBeVisible();
  await page.evaluate(() => {
    const entry = Object.entries(localStorage).find(([key]) =>
      key.startsWith("buzz-workspaces.v1:"),
    );
    if (!entry) throw new Error("Missing workspace snapshot");
    const state = JSON.parse(entry[1]);
    const item = state.items.find(
      (item: { id: string }) => item.id === "messages",
    );
    item.canvas = {
      layout: "freeform",
      windows: [
        "channel:9a1657ac-f7aa-5db0-b632-d8bbeb6dfb50",
        "widget:weather",
        "widget:activity",
      ],
    };
    localStorage.setItem(entry[0], JSON.stringify(state));
  });
  await page.reload();
  const settle = () =>
    page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
        }),
    );
  const messages = page.getByRole("tab", { name: "Messages", exact: true });
  const home = page.getByRole("tab", { name: "Home", exact: true });
  const input = page
    .locator('[data-content-id="channel:9a1657ac-f7aa-5db0-b632-d8bbeb6dfb50"]')
    .getByTestId("message-input");
  await expect(input).toBeVisible();
  await input.fill("Draft retained across workspace switches");
  await home.click();
  await expect(page.getByTestId("pulse-home")).toBeVisible();
  await messages.click();
  await expect(input).toHaveText("Draft retained across workspace switches");
  await settle();
  const client = await page.context().newCDPSession(page);
  await client.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  await client.send("Performance.enable");
  const metrics = async () =>
    Object.fromEntries(
      (await client.send("Performance.getMetrics")).metrics.map(
        ({ name, value }) => [name, value],
      ),
    );
  const samples: Record<string, number[]> = {};
  const measure = async (name: string, run: () => Promise<void>) => {
    const before = await metrics();
    await run();
    await settle();
    const after = await metrics();
    for (const metric of [
      "TaskDuration",
      "ScriptDuration",
      "LayoutDuration",
      "LayoutCount",
      "RecalcStyleCount",
    ]) {
      samples[`${name}.${metric}`] ??= [];
      samples[`${name}.${metric}`].push(
        (after[metric] - before[metric]) *
          (metric.endsWith("Duration") ? 1000 : 1),
      );
    }
  };
  for (let run = 0; run < 5; run++) {
    await measure("switch", async () => {
      await home.click();
      await expect(page.getByTestId("pulse-home")).toBeVisible();
      await messages.click();
      await expect(input).toHaveText(
        "Draft retained across workspace switches",
      );
    });
    await measure("focus", async () => {
      for (const id of [
        "widget:weather",
        "channel:9a1657ac-f7aa-5db0-b632-d8bbeb6dfb50",
        "widget:activity",
        "main",
      ])
        await page.locator(`[data-content-id="${id}"]`).focus();
    });
  }
  await arrangeWindows(page, "Columns");
  const divider = page.getByRole("separator", {
    name: "Resize split 1",
    exact: true,
  });
  await expect(divider).toBeVisible();
  await settle();
  for (let run = 0; run < 5; run++) {
    await measure("resize", async () => {
      const previous = await divider.getAttribute("aria-valuenow");
      const box = await divider.boundingBox();
      if (!box || previous === null) throw new Error("Missing split divider");
      const x = box.x + box.width / 2,
        y = box.y + box.height / 2;
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.move(x + (run % 2 ? -60 : 60), y, { steps: 12 });
      await page.mouse.up();
      await expect(divider).not.toHaveAttribute("aria-valuenow", previous);
    });
  }
  await client.send("Emulation.setCPUThrottlingRate", { rate: 1 });
  const result = Object.fromEntries(
    Object.entries(samples).map(([name, values]) => [
      name,
      {
        median: [...values].sort((a, b) => a - b)[2],
        samples: values,
      },
    ]),
  );
  console.log(JSON.stringify(result, null, 2));
  await test.info().attach("workspace-performance.json", {
    body: JSON.stringify(result, null, 2),
    contentType: "application/json",
  });
});
