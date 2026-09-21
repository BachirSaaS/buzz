import { expect, type Page } from "@playwright/test";

/** Switch the persistent command capsule to typing without activating the microphone. */
export async function openCommandInput(page: Page) {
  const dialog = page.getByRole("dialog", {
    name: "Buzz commands",
    exact: true,
  });
  if (await dialog.isVisible()) return dialog;
  await page
    .getByRole("button", { name: "Switch to typing", exact: true })
    .click();
  await expect(
    dialog.getByRole("textbox", { name: "Interface command" }),
  ).toBeFocused();
  return dialog;
}
