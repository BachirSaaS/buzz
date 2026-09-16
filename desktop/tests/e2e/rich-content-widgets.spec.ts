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
    await page.goto("/");
    await page.getByTestId("open-pulse-view").click();
    await page.getByRole("button", { name: "Messages", exact: true }).click();
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
      await expect(widget).toHaveCSS("border-width", "1px");
      expect(
        await widget.evaluate((el) => getComputedStyle(el).boxShadow),
      ).not.toBe("none");
      await expect(widget.locator("[data-link-preview-hostname]")).toHaveCount(
        0,
      );
      await widget.scrollIntoViewIfNeeded();
      expect(
        await widget.evaluate((el) => {
          const rect = el.getBoundingClientRect();
          return document
            .elementFromPoint(rect.right - 12, rect.bottom - 12)
            ?.closest("a")
            ?.getAttribute("href");
        }),
      ).toBe(link.href);
      const menuButton = widget.getByRole("button", {
        name: "Link display settings",
      });
      await menuButton.focus();
      await page.keyboard.press("Enter");
      await page
        .getByRole("menuitem", { name: "Show less", exact: true })
        .click();
      await expect(
        widget.locator('[data-slot="attachment-description"]'),
      ).toHaveCount(0);
      await expect(menuButton).toBeFocused();
      await expect(page.getByRole("menu")).not.toBeVisible();
      await menuButton.click();
      await page
        .getByRole("menuitem", { name: "Show more", exact: true })
        .click();
      await expect(
        widget.locator('[data-slot="attachment-description"]'),
      ).toBeVisible();
      await expect(page.getByRole("menu")).not.toBeVisible();
      await menuButton.click();
      await page
        .getByRole("menuitemradio", { name: "Compact preview", exact: true })
        .click();
      await expect(widget).not.toHaveAttribute("data-link-preview-inline");
      await expect(page.getByRole("menu")).not.toBeVisible();
      await menuButton.click();
      await page
        .getByRole("menuitemradio", { name: "Full preview", exact: true })
        .click();
      await expect(widget).toHaveAttribute("data-link-preview-inline", "");
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

for (const appearance of ["light", "dark"] as const) {
  test(`Home recaps show original rich evidence and route to source threads (${appearance})`, async ({
    page,
  }) => {
    await page.addInitScript((mode) => {
      localStorage.setItem("buzz-blockui-appearance.v1", mode);
      localStorage.setItem("buzz.appearance.linkPreviewStyle", "compact");
    }, appearance);
    await page.setViewportSize({ width: 1440, height: 1500 });
    const href = "https://github.com/block/buzz/pull/123";
    const imageUrl = "https://example.com/home-design.png";
    await page.route(imageUrl, (route) =>
      route.fulfill({
        contentType: "image/svg+xml",
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="400" viewBox="0 0 640 400"><rect width="640" height="400" fill="#e8edf3"/><rect x="24" y="24" width="72" height="352" rx="24" fill="#fff"/><rect x="40" y="40" width="40" height="40" rx="12" fill="#232323"/><rect x="40" y="96" width="40" height="40" rx="12" fill="#67c900"/><rect x="120" y="24" width="496" height="352" rx="24" fill="#fff"/><rect x="144" y="48" width="192" height="16" rx="8" fill="#343434"/><rect x="144" y="104" width="300" height="72" rx="24" fill="#f0f0f0"/><rect x="240" y="200" width="352" height="96" rx="24" fill="#262626"/></svg>',
      }),
    );
    await page.route("**/__pulse/briefing", async (route) => {
      const input = route.request().postDataJSON();
      const sources = input.conversations.filter(
        (item: { messages: { body: string }[] }) =>
          item.messages.some(
            (m) => m.body.includes(href) || m.body.includes(imageUrl),
          ),
      );
      await route.fulfill({
        json: {
          highlights: sources.length
            ? [
                {
                  summary:
                    "The team shared a navigation design and its implementation for review.",
                  conversationIds: sources.map(
                    (item: { id: string }) => item.id,
                  ),
                  messageIds: sources
                    .flatMap(
                      (item: { messages: { id: string; body: string }[] }) =>
                        item.messages
                          .filter(
                            (m) =>
                              m.body.includes(href) ||
                              m.body.includes(imageUrl),
                          )
                          .map((m) => m.id),
                    )
                    .slice(0, 2),
                },
              ]
            : [],
        },
      });
    });
    const participants = ["Alice", "Bob", "Casey", "Devon", "Elliot"].map(
      (name, index) => ({
        pubkey: (index + 10).toString(16).padStart(2, "0").repeat(32),
        displayName: name,
        isAgent: name === "Casey",
      }),
    );
    await installMockBridge(page, {
      searchProfiles: participants,
      linkPreviewMetadataByHref: {
        [href]: {
          title: "Improve Home navigation",
          description:
            "A focused overview of activity with links back to the original threads.",
          siteName: "GitHub",
          imageDataUrl: null,
          imageDomain: null,
        },
      },
    });
    await page.goto("/");
    await page.getByTestId("channel-general").click();
    await page.waitForFunction(() =>
      window.__BUZZ_E2E_HAS_MOCK_LIVE_SUBSCRIPTION__?.({
        channelName: "general",
      }),
    );
    await page.evaluate(
      ({ href, imageUrl, participants }) => {
        const emit = window.__BUZZ_E2E_EMIT_MOCK_MESSAGE__;
        if (!emit) throw new Error("Missing mock bridge");
        const root = emit({
          channelName: "general",
          pubkey: participants[0].pubkey,
          content: `The implementation is ready for review: ${href}`,
          extraTags: [
            [
              "link-preview",
              "snapshot",
              "1",
              href,
              "Improve Home navigation",
              "GitHub",
              "Review the implementation",
              "",
              "",
              "",
              "",
            ],
          ],
        });
        for (const person of participants.slice(2))
          emit({
            channelName: "general",
            parentEventId: root.id,
            pubkey: person.pubkey,
            content: "Reviewed the navigation changes and shared feedback.",
          });
        emit({
          channelName: "general",
          pubkey: participants[1].pubkey,
          content: `Here is the updated navigation design.\n\n![Navigation design](${imageUrl})\n\nhttps://github.com/block/buzz`,
          extraTags: [
            ["imeta", `url ${imageUrl}`, "m image/png", "dim 640x400"],
          ],
        });
      },
      { href, imageUrl, participants },
    );
    await page.getByTestId("open-pulse-view").click();
    const card = page
      .getByTestId("pulse-briefing-highlight")
      .filter({ hasText: "The team shared a navigation design" });
    await expect(card).toBeVisible();
    const evidenceArea = card.getByTestId("home-activity-evidence");
    await expect(evidenceArea).toHaveCSS("max-height", "240px");
    await expect(evidenceArea).toHaveCSS("overflow", "hidden");
    expect((await evidenceArea.boundingBox())?.height).toBeLessThanOrEqual(240);
    await expect(card.locator("[data-evidence-message-id]")).toHaveCount(2);
    await expect(
      card.locator(
        '[data-content-widget][data-link-preview="github-pull-request"]',
      ),
    ).toBeVisible();
    await expect(card).toContainText("Improve Home navigation");
    await expect(
      card.locator(
        '[data-content-widget][data-link-preview="github-repository"]',
      ),
    ).toBeVisible();
    await expect(
      card.getByRole("img", { name: "Navigation design", exact: true }),
    ).toBeVisible();
    const people = card.getByTestId("home-participants");
    await expect(people.getByTestId("home-participant-avatar")).toHaveCount(3);
    await expect(
      people.getByRole("img", { name: /^2 more participants:/ }),
    ).toHaveText("+2");
    const avatars = people.getByTestId("home-participant-avatar");
    const first = await avatars.nth(0).boundingBox();
    const second = await avatars.nth(1).boundingBox();
    if (!first || !second) throw new Error("Missing participant bounds");
    expect(first.width).toBe(64);
    expect(second.x - first.x).toBe(48);
    const heading = await card
      .getByTestId("home-activity-summary")
      .boundingBox();
    if (!heading) throw new Error("Missing summary bounds");
    expect(first.y + first.height).toBeLessThan(heading.y);
    const preview = card.getByTestId("home-context-preview").first();
    await expect(preview).toHaveCSS("zoom", "0.5");
    const image = card.getByRole("img", {
      name: "Navigation design",
      exact: true,
    });
    const thumbnail = await image.boundingBox();
    if (!thumbnail) throw new Error("Missing thumbnail bounds");
    expect(thumbnail.width).toBe(192);
    await card
      .getByRole("button", {
        name: "Zoom image: Navigation design",
        exact: true,
      })
      .click();
    await expect(page.locator("[data-image-lightbox-frame]")).toBeVisible();
    await waitForAnimations(page);
    await expect
      .poll(
        async () =>
          (await page.locator("[data-image-lightbox-frame]").boundingBox())
            ?.width ?? 0,
      )
      .toBeGreaterThan(thumbnail.width * 2);
    await page.keyboard.press("Escape");
    await expect(page.locator("[data-image-lightbox-frame]")).toHaveCount(0);
    await expectWidgetHierarchy(card);
    await expect(card).toHaveCSS("font-family", /Inter/);
    await waitForAnimations(page);
    await card.screenshot({
      path: `test-results/rich-widgets/home-${appearance}.png`,
    });
    await people
      .getByRole("button", { name: "Open profile for Alice", exact: true })
      .focus();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("user-profile-panel")).toBeVisible();
    await page.goBack();
    await expect(page.getByTestId("user-profile-panel")).toHaveCount(0);
    await card.getByRole("button", { name: "Open conversation" }).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("pulse-conversation")).toHaveCount(2);
    await expect(
      page
        .getByTestId("pulse-conversation")
        .filter({ hasText: "implementation is ready" }),
    ).toBeVisible();
    expect(
      await page.evaluate(() =>
        localStorage.getItem("buzz.appearance.linkPreviewStyle"),
      ),
    ).toBe("compact");
  });
}
