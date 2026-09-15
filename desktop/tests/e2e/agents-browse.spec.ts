import { expect, test } from "@playwright/test";
import { hexToBytes } from "@noble/hashes/utils.js";
import { finalizeEvent } from "nostr-tools/pure";
import { installMockBridge, TEST_IDENTITIES } from "../helpers/bridge";
import { waitForAnimations } from "../helpers/animations";

const owner = TEST_IDENTITIES.alice;
const instructions =
  "Review the change.\n||Literal instructions|| [source](https://example.com/review)";
const publication = finalizeEvent(
  {
    kind: 30175,
    created_at: 1_721_750_400,
    tags: [
      ["d", "browse-reviewer"],
      ["shared", "true"],
    ],
    content: JSON.stringify({
      display_name: "Code reviewer",
      description: "Thoughtful reviews with clear next steps.",
      system_prompt: instructions,
      avatar_url: null,
      runtime: null,
      model: null,
      provider: null,
      name_pool: [],
      session_policy: "channel",
    }),
  },
  hexToBytes(owner.privateKey),
);
const catalogId = `catalog:${owner.pubkey}:browse-reviewer`;

for (const appearance of ["light", "dark"] as const) {
  test(`agents split workspace and Block UI creation (${appearance})`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.addInitScript(
      (value) => localStorage.setItem("buzz-blockui-appearance.v1", value),
      appearance,
    );
    await installMockBridge(page, {
      activePersonaIds: ["builtin:fizz"],
      personaCatalogEvents: [publication],
      globalAgentConfig: {
        preferred_runtime: "goose",
        provider: "anthropic",
        model: "claude-opus-4-5",
        env_vars: { ANTHROPIC_API_KEY: "test-key" },
      },
    });
    await page.goto("/#/pulse?feed=agents");
    const dock = page.getByTestId("pulse-app-navigation");
    const nav = page.getByRole("navigation", { name: "Agents sections" });
    await expect(dock).toBeVisible();
    await dock.getByRole("button", { name: "Agents", exact: true }).click();
    await expect(
      nav.getByRole("button", { name: "Your agents" }),
    ).toHaveAttribute("aria-current", "page");
    const ownCard = page.locator('[data-testid^="persona-agent-row-"]').first();
    await expect(ownCard).toBeVisible();
    await expect(ownCard).toHaveCSS("border-radius", "24px");
    await nav.getByRole("button", { name: "Browse", exact: true }).focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/agentSection=browse/);
    const card = page.getByTestId(`community-catalog-agent-${catalogId}`);
    await expect(card).toBeVisible();
    await page.goBack();
    await expect(
      nav.getByRole("button", { name: "Your agents" }),
    ).toHaveAttribute("aria-current", "page");
    await page.goForward();
    await expect(
      nav.getByRole("button", { name: "Browse", exact: true }),
    ).toHaveAttribute("aria-current", "page");
    await expect(card).toContainText("Thoughtful reviews");
    await expect(card).toHaveCSS("border-radius", "24px");
    await expect(
      card.getByRole("button", { name: "Review Code reviewer" }),
    ).toBeVisible();
    const search = page.getByRole("textbox", {
      name: "Search agents and teams",
    });
    await search.fill("missing agent");
    await expect(page.getByText("No matches", { exact: true })).toBeVisible();
    await search.fill("");
    await page.reload();
    await expect(
      nav.getByRole("button", { name: "Browse", exact: true }),
    ).toHaveAttribute("aria-current", "page");
    await expect(card).toBeVisible();
    const avatar = card.locator('[data-slot="avatar"]');
    const fallback = avatar.locator('[data-slot="avatar-fallback"]');
    await expect(fallback).toHaveText("CR");
    const shape = await avatar.evaluate((el) => ({
      clip: getComputedStyle(el).clipPath,
      outer: getComputedStyle(el).borderRadius,
      outline: getComputedStyle(el, "::after").borderRadius,
    }));
    expect(shape.clip).toContain("rounded-squircle-clip");
    await expect(fallback).toHaveCSS("border-radius", shape.outer);
    await expect(fallback).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    expect(shape.outline).toBe(shape.outer);
    await waitForAnimations(page);
    await page.screenshot({
      path: `test-results/agents-browse/${appearance}-browse.png`,
    });
    await card.getByRole("button").click();
    const dialog = page.getByTestId("community-catalog-dialog");
    await expect(dialog).toBeVisible();
    await expect(
      page.getByTestId("persona-catalog-exact-instructions"),
    ).toHaveText(instructions);
    await expect(dialog.getByTestId("agent-catalog-create")).toHaveCount(0);
    await dialog
      .getByRole("button", { name: "Add agent", exact: true })
      .click();
    await expect(dialog).toHaveCount(0);
    await expect(
      nav.getByRole("button", { name: "Your agents" }),
    ).toHaveAttribute("aria-current", "page");
    await expect(
      page
        .locator('[data-testid^="persona-agent-row-"]')
        .filter({ hasText: "Code reviewer" }),
    ).toBeVisible();
    // Adding a catalog entry is followed by its profile; close that panel first.
    const closeProfile = page.getByTestId("auxiliary-panel-close");
    if (await closeProfile.isVisible()) await closeProfile.click();
    await page.getByTestId("new-agent-card").click();
    await expect(dialog).toHaveCSS("border-radius", "24px");
    await expect(
      dialog.locator('[data-testid^="community-catalog-agent-"]'),
    ).toHaveCount(0);
    const name = page.getByLabel("Agent name", { exact: true });
    await name.fill("My new agent");
    await expect(name).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    await page
      .getByLabel("Agent instructions", { exact: true })
      .fill("Summarize the evidence.");
    await dialog.getByTestId("agent-catalog-import").click();
    await expect(page.getByTestId("discard-create-agent-dialog")).toBeVisible();
    await page.getByRole("button", { name: "Keep editing" }).click();
    await expect(name).toHaveValue("My new agent");
    const submit = page.getByTestId("persona-dialog-submit");
    await expect(submit).toBeVisible();
    const footer = submit.locator("../..");
    await expect(footer.locator("..")).toHaveCSS("position", "static");
    await expect(page.locator("#persona-dialog-form")).toHaveCSS("gap", "24px");
    await waitForAnimations(page);
    await dialog.screenshot({
      path: `test-results/agents-browse/${appearance}-create.png`,
    });
    await page.setViewportSize({ width: 900, height: 720 });
    await expect(submit).toBeInViewport();
    const overflow = await dialog.evaluate(
      (el) => el.scrollWidth > el.clientWidth,
    );
    expect(overflow).toBe(false);
    await dialog.getByTestId("agent-catalog-import").click();
    await page
      .getByRole("button", { name: "Discard changes", exact: true })
      .click();
    await expect(
      page.getByTestId("agent-catalog-import-dropzone"),
    ).toBeVisible();
    await expect(
      dialog
        .getByRole("navigation", { name: "Add agent options" })
        .getByRole("button"),
    ).toHaveCount(2);
    await dialog.getByTestId("agent-catalog-create").click();
    await name.fill("Created from the new modal");
    await page
      .getByLabel("Agent instructions", { exact: true })
      .fill("Help review design changes.");
    await submit.click();
    await expect(dialog).toHaveCount(0);
    await expect(
      page
        .locator('[data-testid^="persona-agent-row-"]')
        .filter({ hasText: "Created from the new modal" }),
    ).toBeVisible();
  });
}
