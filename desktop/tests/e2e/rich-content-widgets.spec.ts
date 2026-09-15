import { expect, test, type Locator } from "@playwright/test";
import { installMockBridge } from "../helpers/bridge";
import { waitForAnimations } from "../helpers/animations";

async function expectWidgetHierarchy(widget: Locator) {
  await expect(widget).toHaveCSS("padding", "24px");
  await expect(widget).toHaveCSS("border-radius", "24px");
  const typography = await widget.evaluate((el) => {
    const sizes = new Set<string>();
    const weights = new Set<string>();
    for (const child of el.querySelectorAll<HTMLElement>("*")) {
      if (
        !child.getClientRects().length ||
        !Array.from(child.childNodes).some(
          (node) =>
            node.nodeType === Node.TEXT_NODE && node.textContent?.trim(),
        )
      )
        continue;
      const style = getComputedStyle(child);
      sizes.add(style.fontSize);
      weights.add(style.fontWeight);
    }
    return {
      sizes: [...sizes],
      weights: [...weights],
      overflow: el.scrollWidth > el.clientWidth,
    };
  });
  expect(typography.sizes.length).toBeLessThanOrEqual(3);
  expect(typography.weights.length).toBeLessThanOrEqual(3);
  expect(typography.overflow).toBe(false);
}

for (const appearance of ["light", "dark"] as const) {
  test(`Block UI ${appearance} rich content widgets preserve hierarchy and Pulse bubbles`, async ({
    page,
  }) => {
    await page.addInitScript((value) => {
      localStorage.setItem("buzz-blockui-appearance.v1", value);
      localStorage.setItem("buzz.appearance.linkPreviewStyle", "rich");
    }, appearance);
    const links = [
      {
        href: "https://github.com/block/buzz/pull/123",
        kind: "github-pull-request",
        title: "Make agent activity easier to follow",
      },
      {
        href: "https://docs.google.com/document/d/widget-spec/edit",
        kind: "google-docs-document",
        title: "Rich content design notes",
      },
      {
        href: "https://linear.app/block/issue/BUZZ-123/widget-spec",
        kind: "linear-issue",
        title: "A consistent widget hierarchy",
      },
      {
        href: "https://example.com/field-notes",
        kind: "generic-link",
        title: "Field notes from the design team",
      },
    ];
    await installMockBridge(page, {
      linkPreviewMetadataByHref: Object.fromEntries(
        links.map((link) => [
          link.href,
          {
            title: link.title,
            siteName: null,
            description:
              "A clear title, useful context, and room for the content.\n\nSupporting details stay readable without competing with the headline.",
            imageDataUrl: null,
            imageDomain: null,
          },
        ]),
      ),
    });
    await page.goto("/?e2e=mock#/pulse?feed=conversation");
    await page
      .getByTestId("pulse-combined-list")
      .locator('[data-channel-name="general"]')
      .click();
    const detail = page.getByTestId("pulse-combined-detail");
    for (const link of links) {
      await detail.getByTestId("message-input").fill(link.href);
      await expect(
        detail.locator("[data-composer-link-previews]"),
      ).toHaveAttribute("data-ready-snapshot-count", "1");
      await detail.getByTestId("send-message").click();
      const widget = detail
        .locator(`[data-content-widget][data-link-preview="${link.kind}"]`)
        .last();
      await expect(widget).toBeVisible();
      await expectWidgetHierarchy(widget);
      await expect(
        widget.getByRole("link", { name: /^Open / }),
      ).toHaveAttribute("href", link.href);
      await expect(widget).toHaveCSS("font-family", /Inter/);
      const fold = widget.getByRole("button", {
        name: "Show less",
        exact: true,
      });
      await fold.focus();
      await page.keyboard.press("Enter");
      await expect(
        widget.locator('[data-slot="attachment-description"]'),
      ).toHaveCount(0);
      await widget
        .getByRole("button", { name: "Show more", exact: true })
        .click();
      await expect(
        widget.locator('[data-slot="attachment-description"]'),
      ).toBeVisible();
      if (link.kind === "github-pull-request") {
        await expect(widget.locator("[data-link-preview-context]")).toHaveText(
          "block / buzz · #123",
        );
        await expect(widget).not.toContainText(/Merged|Approved|Checks passed/);
      }
      await waitForAnimations(page);
      await widget.screenshot({
        path: `test-results/rich-widgets/${appearance}-${link.kind}.png`,
      });
    }
    await page.setViewportSize({ width: 900, height: 900 });
    await expectWidgetHierarchy(
      detail
        .locator('[data-content-widget][data-link-preview="generic-link"]')
        .last(),
    );
  });
}
