import type { Page } from "@playwright/test";
/** Exercise the user-facing arrangement menu, including its close/focus behavior. */
export async function arrangeWindows(page: Page, name: string) {
  await page
    .getByRole("button", { name: "Arrange windows", exact: true })
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
