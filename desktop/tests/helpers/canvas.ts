import { expect, type Page } from "@playwright/test";
/** Exercise the user-facing arrangement menu, including its close/focus behavior. */
export async function arrangeWindows(page: Page, name: string) {
  await page
    .getByRole("button", { name: "Window options", exact: true })
    .click();
  await page
    .getByRole("menuitemradio", { name: `${name} layout`, exact: true })
    .click();
}
/** Main-view navigation stays inside the selected workspace. */
export async function openMainArea(page: Page, name: string) {
  await page
    .locator('[data-content-id="main"]')
    .getByRole("button", { name: /^Switch view,/ })
    .click();
  await page
    .getByRole("dialog", { name: "Switch window view" })
    .getByRole("button", { name, exact: true })
    .click();
}
/** Read the canvas owned by the currently selected workspace. */
export async function readActiveCanvas(page: Page) {
  return page.evaluate(() => {
    const data = JSON.parse(
      Object.entries(localStorage).find(([key]) =>
        key.startsWith("buzz-workspaces.v1:"),
      )?.[1] ?? "{}",
    );
    return data.items?.find((item: { id: string }) => item.id === data.active)
      ?.canvas;
  });
}

/** Open the window catalog through the consolidated canvas menu. */
export async function openWindowPicker(page: Page, keyboard = false) {
  const options = page.getByTestId("canvas-options");
  if (keyboard) {
    await options.focus();
    await page.keyboard.press("Enter");
    await page
      .getByRole("menuitem", { name: "Add window", exact: true })
      .focus();
    await page.keyboard.press("Enter");
  } else {
    await options.click();
    await page
      .getByRole("menuitem", { name: "Add window", exact: true })
      .click();
  }
}
/** Window limits disable adding, while the arrangement menu remains available. */
export async function expectCanAddWindow(page: Page, enabled: boolean) {
  await page.getByTestId("canvas-options").click();
  const item = page.getByTestId("canvas-add-view");
  if (enabled) await expect(item).toBeEnabled();
  else await expect(item).toBeDisabled();
  await page.keyboard.press("Escape");
}
