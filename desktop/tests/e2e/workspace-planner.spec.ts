import { expect, test, type Page } from "@playwright/test";
import { installMockBridge } from "../helpers/bridge";
import { waitForAnimations } from "../helpers/animations";
type Input = {
  request: string;
  catalog: { id: string; title: string; kind: string; aliases: string[] }[];
};
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
const weatherPlan = {
  name: "Weather desk",
  layout: "focus",
  windowIds: ["widget:weather"],
  unresolved: [],
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
test("prompt dropdown builds exactly the requested catalog windows and reloads the result", async ({
  page,
}) => {
  let sent: Input | undefined;
  let chosen: string[] = [];
  await page.route("**/__pulse/workspace", async (route) => {
    sent = route.request().postDataJSON() as Input;
    chosen = ["alice", "bob"]
      .map((name) => {
        const dm = sent?.catalog.find(
          (item) =>
            item.kind === "dm" &&
            [item.title, ...item.aliases].some(
              (alias) => alias.toLowerCase() === name,
            ),
        );
        if (!dm) throw new Error(`Missing real catalog DM: ${name}`);
        return dm.id;
      })
      .concat("widget:weather", "app:projects");
    await route.fulfill({
      json: {
        name: "Team desk",
        layout: "grid",
        windowIds: chosen,
        unresolved: [],
      },
    });
  });
  const before = await saved(page);
  await open(page);
  await expect(
    page.getByRole("tab", { name: "Workspace 1", exact: true }),
  ).toHaveCount(0);
  const input = popover(page).getByRole("textbox", {
    name: "Describe your workspace",
  });
  await input.fill(
    "Message alice and bob, check the weather, and see my projects",
  );
  await expect(
    popover(page).getByRole("button", {
      name: "Create workspace",
      exact: true,
    }),
  ).toBeEnabled();
  await waitForAnimations(page);
  await page.screenshot({ path: "test-results/workspace-planner/prompt.png" });
  await input.press("Enter");
  await expect(
    page.getByRole("tab", { name: "Team desk", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("[data-content-id]")).toHaveCount(4);
  const result = await saved(page);
  expect(result.items).toHaveLength(before.items.length + 1);
  for (const item of before.items)
    expect(
      result.items.find((next: { id: string }) => next.id === item.id),
    ).toMatchObject(item);
  expect(
    result.items.find((item: { id: string }) => item.id === result.active)
      .canvas.windows,
  ).toEqual(chosen);
  expect(sent?.catalog.every((item) => !Object.hasOwn(item, "messages"))).toBe(
    true,
  );
  await expect(page.locator("[data-content-id=main]")).toHaveCount(0);
  await page.reload();
  await expect(
    page.getByRole("tab", { name: "Team desk", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  for (const id of chosen)
    await expect(page.locator(`[data-content-id="${id}"]`)).toBeVisible();
});
test("invalid or ambiguous model results leave the prompt editable with no partial workspace", async ({
  page,
}) => {
  let mode = "unknown";
  await page.route("**/__pulse/workspace", (route) =>
    route.fulfill({
      json:
        mode === "unknown"
          ? { ...weatherPlan, windowIds: ["invented"] }
          : mode === "ambiguous"
            ? { ...weatherPlan, unresolved: ["Which Matt did you mean?"] }
            : weatherPlan,
    }),
  );
  const before = await saved(page);
  await open(page);
  const input = popover(page).getByRole("textbox", {
    name: "Describe your workspace",
  });
  await input.fill("Weather and Matt");
  const submit = popover(page).getByRole("button", {
    name: "Create workspace",
    exact: true,
  });
  await submit.click();
  await expect(popover(page).getByRole("alert")).toContainText(
    "unavailable windows",
  );
  expect(await saved(page)).toEqual(before);
  mode = "ambiguous";
  await submit.click();
  await expect(popover(page).getByRole("alert")).toContainText("Which Matt");
  expect(await saved(page)).toEqual(before);
  mode = "ok";
  await input.fill("Just the weather");
  await submit.click();
  await expect(
    page.getByRole("tab", { name: "Weather desk", exact: true }),
  ).toBeVisible();
});
test("Custom cancels pending generation and late responses cannot replace or add a workspace", async ({
  page,
}) => {
  // Native invoke cannot abort its promise. Mimic that transport so removing
  // the UI generation fence makes this regression fail.
  await page.evaluate(() => {
    const original = window.fetch;
    window.fetch = (input, init) =>
      original(
        input,
        String(input).includes("/__pulse/workspace")
          ? { ...init, signal: undefined }
          : init,
      );
  });
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/__pulse/workspace", async (route) => {
    await held;
    await route.fulfill({ json: weatherPlan }).catch(() => {});
  });
  const before = await saved(page);
  await open(page);
  await popover(page)
    .getByRole("textbox", { name: "Describe your workspace" })
    .fill("Weather");
  await popover(page)
    .getByRole("button", { name: "Create workspace", exact: true })
    .click();
  await expect(popover(page).getByRole("status")).toHaveText(
    "Finding your windows…",
  );
  await popover(page)
    .getByRole("button", { name: "Custom Start empty", exact: true })
    .click();
  await expect(page.getByTestId("empty-workspace")).toBeVisible();
  const response = page.waitForResponse("**/__pulse/workspace");
  release();
  await (await response).finished();
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
  // Reopen and complete another request; the old result must not become a second workspace.
  await open(page);
  await page.keyboard.press("Escape");
  await expect(popover(page)).toHaveCount(0);
  const after = await saved(page);
  expect(after.items).toHaveLength(before.items.length + 1);
  expect(after.items.at(-1).canvas.windows).toEqual([]);
  await expect(
    page.getByRole("tab", { name: "Weather desk", exact: true }),
  ).toHaveCount(0);
});
test("model and storage failures are retryable without losing the request", async ({
  page,
}) => {
  let healthy = false;
  await page.route("**/__pulse/workspace", (route) =>
    route.fulfill(healthy ? { json: weatherPlan } : { status: 503, json: {} }),
  );
  await open(page);
  const input = popover(page).getByRole("textbox", {
    name: "Describe your workspace",
  });
  await input.fill("Weather");
  const submit = popover(page).getByRole("button", {
    name: "Create workspace",
    exact: true,
  });
  await submit.click();
  await expect(popover(page).getByRole("alert")).toContainText(
    "Couldn’t build",
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
  await submit.click();
  await expect(popover(page).getByRole("alert")).toContainText("Couldn’t save");
  await expect(
    page.getByRole("tab", { name: "Weather desk", exact: true }),
  ).toHaveCount(0);
  await page.evaluate(() => {
    (window as unknown as { allowSave: boolean }).allowSave = true;
  });
  await submit.click();
  await expect(
    page.getByRole("tab", { name: "Weather desk", exact: true }),
  ).toBeVisible();
});
