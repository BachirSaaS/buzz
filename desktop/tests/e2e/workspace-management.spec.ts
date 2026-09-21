import { expect, test, type Page } from "@playwright/test";
import { installMockBridge } from "../helpers/bridge";
import { openCommandInput } from "../helpers/interfaceCommands";

const saved = (page: Page) =>
  page.evaluate(() =>
    JSON.parse(
      Object.entries(localStorage).find(([key]) =>
        key.startsWith("buzz-workspaces.v1:"),
      )?.[1] ?? "{}",
    ),
  );
async function run(
  page: Page,
  request: string,
  action: string,
  parameters: Record<string, string> = {},
) {
  await page.unroute("**/__pulse/intent");
  let requests = 0;
  await page.route("**/__pulse/intent", (route) => {
    requests++;
    const { questions } = route.request().postDataJSON();
    return route.fulfill({
      json: Object.fromEntries(
        Object.keys(questions).map((key) => [
          key,
          {
            choice:
              key === "action"
                ? action
                : (parameters[key] ??
                  (key === "scope"
                    ? "create"
                    : key.startsWith("area_") ||
                        key.startsWith("target_") ||
                        key === "reference_workspace"
                      ? "none"
                      : "0")),
            probability: 0.98,
            margin: 0.95,
          },
        ]),
      ),
    });
  });
  const dialog = await openCommandInput(page);
  await dialog
    .getByRole("textbox", { name: "Interface command" })
    .fill(request);
  await dialog
    .getByRole("textbox", { name: "Interface command" })
    .press("Enter");
  await expect(
    dialog.getByRole("button", { name: "Run command" }),
  ).toHaveAttribute("aria-busy", "false");
  return { dialog, requests: () => requests };
}
test.beforeEach(async ({ page }) => {
  await page.route("**/__pulse/briefing", (route) =>
    route.fulfill({ json: { highlights: [] } }),
  );
  await page.route("**/__pulse/workspace-icons", (route) => {
    const { questions } = route.request().postDataJSON();
    return route.fulfill({
      json: Object.fromEntries(
        Object.keys(questions).map((key) => [
          key,
          { choice: "house", probability: 0.9, margin: 0.8 },
        ]),
      ),
    });
  });
  await installMockBridge(page);
  await page.goto("/#/pulse");
  await expect(
    page.getByRole("tab", { name: "Home", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
});

test("Jev changes a workspace icon explicitly, undo restores it, and content changes never replace it", async ({
  page,
}) => {
  const home = page.getByRole("tab", { name: "Home", exact: true });
  const result = await run(
    page,
    "change this workspace icon to a message icon",
    "set_workspace_icon",
    { workspace: "home", icon: "messages" },
  );
  await expect(home.locator("[data-workspace-icon]")).toHaveAttribute(
    "data-workspace-icon",
    "messages",
  );
  expect(result.requests()).toBe(2);
  expect(
    (await saved(page)).items.find((item: { id: string }) => item.id === "home")
      .icon,
  ).toBe("messages");
  await run(page, "undo", "undo");
  await expect(home.locator("[data-workspace-icon]")).toHaveAttribute(
    "data-workspace-icon",
    "house",
  );
  await run(page, "use a chat bubble for Home", "set_workspace_icon", {
    workspace: "home",
    icon: "messages",
  });
  await run(page, "open music", "open_windows", {
    count: "1",
    target_1: "widget:music",
    layout: "auto",
  });
  await expect(home.locator("[data-workspace-icon]")).toHaveAttribute(
    "data-workspace-icon",
    "messages",
  );
  await page.reload();
  await expect(home.locator("[data-workspace-icon]")).toHaveAttribute(
    "data-workspace-icon",
    "messages",
  );
});

test("duplicate, dock order, clear, close others and relative navigation use atomic undoable workspace plans", async ({
  page,
}) => {
  await run(page, "create a workspace with music", "create_workspace", {
    count: "1",
    target_1: "widget:music",
    layout: "auto",
    text: "0",
  });
  const source = await saved(page);
  await run(page, "duplicate this workspace", "duplicate_workspace", {
    workspace: source.active,
    text: "0",
  });
  const copied = await saved(page);
  expect(copied.active).not.toBe(source.active);
  const duplicate = copied.items.find(
    (item: { id: string }) => item.id === copied.active,
  );
  expect(duplicate.canvas).toMatchObject(
    source.items.find((item: { id: string }) => item.id === source.active)
      .canvas,
  );
  await run(
    page,
    "move this workspace to the top of the dock",
    "reorder_workspace",
    {
      workspace: copied.active,
      position: "first",
      reference_workspace: "none",
    },
  );
  expect((await saved(page)).items[0].id).toBe(copied.active);
  await run(page, "undo", "undo");
  expect(
    (await saved(page)).items.map((item: { id: string }) => item.id),
  ).toEqual(copied.items.map((item: { id: string }) => item.id));
  await run(page, "clear this workspace", "clear_workspace", {
    workspace: copied.active,
  });
  expect(
    (await saved(page)).items.find(
      (item: { id: string }) => item.id === copied.active,
    ).canvas.windows,
  ).toEqual([]);
  await run(page, "undo", "undo");
  expect(
    (await saved(page)).items.find(
      (item: { id: string }) => item.id === copied.active,
    ).canvas,
  ).toEqual(duplicate.canvas);
  await run(page, "close all other workspaces", "close_other_workspaces", {
    workspace: copied.active,
  });
  expect((await saved(page)).items).toHaveLength(1);
  await run(page, "undo", "undo");
  expect((await saved(page)).items).toHaveLength(copied.items.length);
  await run(page, "previous workspace", "switch_workspace", {
    workspace: source.active,
  });
  expect((await saved(page)).active).toBe(source.active);
});

test("icon storage failures leave the old icon and make the command retryable", async ({
  page,
}) => {
  await page.evaluate(() => {
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key.startsWith("buzz-workspaces.v1:"))
        throw new Error("Storage unavailable");
      setItem.call(this, key, value);
    };
  });
  const result = await run(
    page,
    "change this workspace icon to a moon",
    "set_workspace_icon",
    { workspace: "home", icon: "moon" },
  );
  await expect(result.dialog.getByRole("alert")).toContainText(
    "couldn’t be saved",
  );
  await expect(
    result.dialog.getByRole("textbox", { name: "Interface command" }),
  ).toHaveValue("change this workspace icon to a moon");
  await expect(
    page
      .getByRole("tab", { name: "Home", exact: true })
      .locator("[data-workspace-icon]"),
  ).toHaveAttribute("data-workspace-icon", "house");
});
