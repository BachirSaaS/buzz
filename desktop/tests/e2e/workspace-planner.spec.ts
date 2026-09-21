import { openCommandInput } from "../helpers/interfaceCommands";
import { expect, test, type Page } from "@playwright/test";
import { installMockBridge, TEST_IDENTITIES } from "../helpers/bridge";
const popover = (page: Page) =>
  page.getByRole("dialog", { name: "New workspace", exact: true });
async function open(page: Page) {
  await page
    .getByRole("button", { name: "New workspace", exact: true })
    .click();
  await expect(
    popover(page).getByRole("textbox", { name: "Describe your workspace" }),
  ).toBeFocused();
}
async function saved(page: Page) {
  return page.evaluate(() =>
    JSON.parse(
      Object.entries(localStorage).find(([key]) =>
        key.startsWith("buzz-workspaces.v1:"),
      )?.[1] ?? "{}",
    ),
  );
}
const decision = (choice: string) => ({
  choice,
  probability: 0.95,
  margin: 0.9,
});
function answers(
  input: { questions: Record<string, unknown> },
  picks: Record<string, string>,
) {
  return Object.fromEntries(
    Object.keys(input.questions).map((id) => [
      id,
      decision(
        picks[id] ??
          (id === "scope"
            ? "create"
            : id.startsWith("area_") || id.startsWith("target_")
              ? "none"
              : "0"),
      ),
    ]),
  );
}
const weather = {
  count: "1",
  target_1: "widget:weather",
  layout: "focus",
  text: "0",
};
test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.route("**/__pulse/briefing", (route) =>
    route.fulfill({ json: { highlights: [] } }),
  );
  await page.route("**/__chief", (route) =>
    route.fulfill({ status: 503, json: {} }),
  );
  await installMockBridge(page);
  await page.goto("/#/pulse");
  await expect(
    page.getByRole("tab", { name: "Home", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
});
test("workspace prompt shares Jev planning, persists exact areas atomically, and Ask Buzz can undo it", async ({
  page,
}) => {
  let calls = 0;
  await page.route("**/__pulse/intent", async (route) => {
    calls++;
    const input = route.request().postDataJSON();
    await route.fulfill({
      json: answers(
        input,
        input.questions.action
          ? { action: "undo" }
          : {
              count: "2",
              target_1: "widget:music",
              target_2: "widget:weather",
              layout: "custom",
              area_1: "left_half",
              area_2: "right_half",
            },
      ),
    });
  });
  const before = await saved(page);
  await open(page);
  await popover(page)
    .getByRole("textbox", { name: "Describe your workspace" })
    .fill("music in the left half and weather in the right half");
  await page.keyboard.press("Enter");
  await expect(popover(page)).toHaveCount(0);
  const after = await saved(page);
  expect(calls).toBe(1);
  expect(after.items).toHaveLength(before.items.length + 1);
  const canvas = after.items.find(
    (item: { id: string }) => item.id === after.active,
  ).canvas;
  expect(canvas.windows).toEqual(["widget:music", "widget:weather"]);
  expect(canvas.freeform.frames["widget:music"].x).toBe(0);
  expect(canvas.freeform.frames["widget:weather"].x).toBe(
    canvas.freeform.frames["widget:music"].width,
  );
  for (const item of before.items)
    expect(
      after.items.find((v: { id: string }) => v.id === item.id),
    ).toMatchObject(item);
  const music = page.locator('[data-canvas-frame="widget:music"]');
  const sky = page.locator('[data-canvas-frame="widget:weather"]');
  await expect(music).toBeVisible();
  await expect(sky).toBeVisible();
  const left = await music.boundingBox(),
    right = await sky.boundingBox();
  expect(
    Math.abs((left?.x ?? 0) + (left?.width ?? 0) - (right?.x ?? 0)),
  ).toBeLessThan(2);
  await openCommandInput(page);
  const ask = page.getByRole("dialog", { name: "Buzz commands", exact: true });
  await ask.getByRole("textbox", { name: "Interface command" }).fill("undo");
  await page.keyboard.press("Enter");
  await expect(ask.getByRole("status")).toContainText("Command undone");
  expect(await saved(page)).toMatchObject(before);
  expect((await saved(page)).items).toHaveLength(before.items.length);
});
test("workspace DM clarification preserves widgets and opens an unsent group draft in one workspace", async ({
  page,
}) => {
  let rounds = 0;
  await page.route("**/__pulse/intent", async (route) => {
    const input = route.request().postDataJSON();
    const picks = input.questions.scope
      ? {
          count: "2",
          target_1: "draft:message",
          target_2: "widget:weather",
          layout: "columns",
        }
      : {
          count: "2",
          target_1: TEST_IDENTITIES.alice.pubkey,
          target_2: "unavailable",
        };
    rounds++;
    await route.fulfill({ json: answers(input, picks) });
  });
  const writes: string[] = [];
  await page.exposeFunction("recordWorkspaceWrite", (name: string) =>
    writes.push(name),
  );
  await page.evaluate(() => {
    const original = window.__TAURI_INTERNALS__.invoke;
    window.__TAURI_INTERNALS__.invoke = async (
      name: string,
      payload?: Record<string, unknown>,
    ) => {
      if (["open_dm", "send_channel_message"].includes(name))
        await (
          window as unknown as {
            recordWorkspaceWrite: (name: string) => Promise<void>;
          }
        ).recordWorkspaceWrite(name);
      return original(name, payload);
    };
  });
  const before = await saved(page);
  await open(page);
  await popover(page)
    .getByRole("textbox", { name: "Describe your workspace" })
    .fill("Message Alice and Brooke with weather");
  await page.keyboard.press("Enter");
  await expect(popover(page).getByRole("status")).toContainText(
    "Who do you mean",
  );
  expect(await saved(page)).toEqual(before);
  await expect(
    page.getByRole("dialog", { name: "Buzz commands", exact: true }),
  ).toHaveCount(0);
  await popover(page)
    .getByRole("group", { name: "Recipient choices" })
    .getByRole("button", { name: /bob/i })
    .click();
  await expect(popover(page)).toHaveCount(0);
  await expect(
    page.getByTestId(`new-dm-selected-${TEST_IDENTITIES.alice.pubkey}`),
  ).toBeVisible();
  await expect(
    page.getByTestId(`new-dm-selected-${TEST_IDENTITIES.bob.pubkey}`),
  ).toBeVisible();
  expect(rounds).toBe(2);
  expect(writes).toEqual([]);
  const after = await saved(page);
  expect(after.items).toHaveLength(before.items.length + 1);
  await page.reload();
  await expect(
    page.getByTestId(`new-dm-selected-${TEST_IDENTITIES.bob.pubkey}`),
  ).toBeVisible();
  await expect(
    page.locator('[data-canvas-frame="widget:weather"]'),
  ).toBeVisible();
});
test("invalid, ambiguous, and unsupported workspace plans never partially commit", async ({
  page,
}) => {
  let mode = "unknown";
  await page.route("**/__pulse/intent", async (route) => {
    const input = route.request().postDataJSON();
    const result = answers(input, {
      ...weather,
      ...(mode === "unknown"
        ? { target_1: "invented" }
        : mode === "unsupported"
          ? { scope: "unsupported" }
          : {}),
    });
    if (mode === "ambiguous")
      result.target_1 = {
        choice: "widget:weather",
        probability: 0.4,
        margin: 0.02,
      };
    await route.fulfill({ json: result });
  });
  const before = await saved(page);
  await open(page);
  const input = popover(page).getByRole("textbox", {
    name: "Describe your workspace",
  });
  await input.fill("Weather");
  for (mode of ["unknown", "ambiguous", "unsupported"]) {
    await input.press("Enter");
    await expect(popover(page).getByRole("alert")).toBeVisible();
    await expect(
      popover(page).getByRole("button", {
        name: "Create workspace",
        exact: true,
      }),
    ).toBeEnabled();
    expect(await saved(page)).toEqual(before);
  }
  mode = "ok";
  await input.press("Enter");
  await expect(popover(page)).toHaveCount(0);
  await expect(
    page.getByRole("tab", { name: "Weather", exact: true }),
  ).toBeVisible();
});
test("Custom cancels non-abortable generation; a late result cannot add another workspace", async ({
  page,
}) => {
  await page.evaluate(() => {
    const original = window.fetch;
    window.fetch = (input, init) =>
      original(
        input,
        String(input).includes("/__pulse/intent")
          ? { ...init, signal: undefined }
          : init,
      );
  });
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/__pulse/intent", async (route) => {
    const input = route.request().postDataJSON();
    await held;
    await route.fulfill({ json: answers(input, weather) }).catch(() => {});
  });
  const before = await saved(page);
  await open(page);
  await popover(page)
    .getByRole("textbox", { name: "Describe your workspace" })
    .fill("Weather");
  await page.keyboard.press("Enter");
  await expect(popover(page).getByRole("status")).toContainText(
    "Understanding",
  );
  await popover(page)
    .getByRole("button", { name: "Custom", exact: true })
    .click();
  await expect(page.getByTestId("empty-workspace")).toBeVisible();
  const response = page.waitForResponse("**/__pulse/intent");
  release();
  await (await response).finished();
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
  const after = await saved(page);
  expect(after.items).toHaveLength(before.items.length + 1);
  expect(after.items.at(-1).canvas.windows).toEqual([]);
});
test("model and storage failures keep the workspace request retryable", async ({
  page,
}) => {
  let healthy = false;
  await page.route("**/__pulse/intent", (route) =>
    route.fulfill(
      healthy
        ? { json: answers(route.request().postDataJSON(), weather) }
        : { status: 503, json: {} },
    ),
  );
  await open(page);
  const input = popover(page).getByRole("textbox", {
    name: "Describe your workspace",
  });
  await input.fill("Weather");
  await input.press("Enter");
  await expect(popover(page).getByRole("alert")).toContainText(
    "Couldn't interpret",
  );
  await expect(input).toHaveValue("Weather");
  healthy = true;
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (
        key.startsWith("buzz-workspaces.v1:") &&
        !(window as unknown as { allowSave: boolean }).allowSave
      )
        throw new Error("Full");
      return original.call(this, key, value);
    };
  });
  await input.press("Enter");
  await expect(popover(page).getByRole("alert")).toContainText(
    "couldn't be saved",
  );
  await expect(input).toHaveValue("Weather");
  await page.evaluate(() => Object.assign(window, { allowSave: true }));
  await input.press("Enter");
  await expect(popover(page)).toHaveCount(0);
  await expect(
    page.getByRole("tab", { name: "Weather", exact: true }),
  ).toBeVisible();
});
