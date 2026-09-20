import { expect, test } from "@playwright/test";
import type { QueryClient } from "@tanstack/react-query";
import type { ChannelWindowStore } from "../../src/features/messages/lib/channelWindowStore";
import type { RelayEvent } from "../../src/shared/api/types";
import { installMockBridge, TEST_IDENTITIES } from "../helpers/bridge";

type ProbeWindow = Window & {
  __RAIL_PROBES__: { reads: string[]; active: (id: string) => number };
};

// Exercise the production MessageRow caller, not only the hook's enabled option.
// Query-cache transitions below intentionally isolate presentation from send/relay behavior.
test("rail measurement follows displayed headers, including pending transitions", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const active = new Map<ResizeObserver, Set<Element>>();
    const reads: string[] = [];
    const NativeObserver = ResizeObserver;
    const originalRect = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = function () {
      const id = this.getAttribute("data-testid");
      if (id?.startsWith("message-action-bar-")) reads.push(id);
      return originalRect.call(this);
    };
    window.ResizeObserver = class extends NativeObserver {
      observe(target: Element, options?: ResizeObserverOptions) {
        const targets = active.get(this) ?? new Set<Element>();
        targets.add(target);
        active.set(this, targets);
        return super.observe(target, options);
      }
      unobserve(target: Element) {
        active.get(this)?.delete(target);
        return super.unobserve(target);
      }
      disconnect() {
        active.delete(this);
        return super.disconnect();
      }
    };
    (window as ProbeWindow).__RAIL_PROBES__ = {
      reads,
      active: (id: string) =>
        [...active.values()]
          .flatMap((targets) => [...targets])
          .filter(
            (el) =>
              el.getAttribute("data-testid") === `message-action-bar-${id}`,
          ).length,
    };
  });
  await installMockBridge(page);
  await page.goto("/");
  await page.getByTestId("channel-general").click();
  await expect
    .poll(() =>
      page.evaluate(() =>
        window.__BUZZ_E2E_HAS_MOCK_LIVE_SUBSCRIPTION__?.({
          channelName: "general",
        }),
      ),
    )
    .toBe(true);
  const { first, second, channelId } = await page.evaluate((pubkey) => {
    const emit = window.__BUZZ_E2E_EMIT_MOCK_MESSAGE__;
    if (!emit) throw new Error("Mock message emitter unavailable");
    const timestamp = Math.floor(Date.now() / 1000) + 1000;
    const first = emit({
      channelName: "general",
      content: "Rail header fixture",
      pubkey,
      createdAt: timestamp,
    });
    const second = emit({
      channelName: "general",
      content: "Rail continuation fixture",
      pubkey,
      createdAt: timestamp + 1,
    });
    const channelId = first.tags.find((tag) => tag[0] === "h")?.[1];
    if (!channelId) throw new Error("Emitted message has no channel");
    return {
      first: first.id,
      second: second.id,
      channelId,
    };
  }, TEST_IDENTITIES.alice.pubkey);
  const firstRow = page.locator(`[data-message-id="${first}"]`);
  const secondRow = page.locator(`[data-message-id="${second}"]`);
  await expect(firstRow.getByTestId("message-header")).toHaveCount(1);
  await expect(secondRow.getByTestId("message-body")).toHaveText(
    "Rail continuation fixture",
  );
  await expect(secondRow.getByTestId("message-header")).toHaveCount(0);
  const active = (id: string) =>
    page.evaluate(
      (id) => (window as ProbeWindow).__RAIL_PROBES__.active(id),
      id,
    );
  await expect.poll(() => active(first)).toBe(1);
  expect(await active(second)).toBe(0);
  expect(
    await page.evaluate(
      (id) =>
        (window as ProbeWindow).__RAIL_PROBES__.reads.filter(
          (x: string) => x === `message-action-bar-${id}`,
        ).length,
      second,
    ),
  ).toBe(0);

  const setPending = async (pending: boolean) => {
    await page.evaluate(
      ({ id, channelId, pending }) => {
        const client = window.__BUZZ_E2E_QUERY_CLIENT__ as
          | QueryClient
          | undefined;
        if (!client) throw new Error("Query client unavailable");
        const update = (event: RelayEvent) =>
          event.id === id ? { ...event, pending } : event;
        client.setQueryData<RelayEvent[]>(
          ["channel-messages", channelId],
          (events) => events?.map(update),
        );
        client.setQueryData<ChannelWindowStore>(
          ["channel-window", channelId],
          (store) =>
            store
              ? {
                  ...store,
                  pages: store.pages.map((page) => ({
                    ...page,
                    rows: page.rows.map((row) => ({
                      ...row,
                      event: update(row.event),
                    })),
                  })),
                  liveOverlay: store.liveOverlay.map(update),
                }
              : store,
        );
      },
      { id: second, channelId, pending },
    );
  };
  // A pending continuation still shows a header: bare isContinuation is wrong.
  await setPending(true);
  await expect(secondRow.getByTestId("message-header")).toHaveCount(1);
  await expect(secondRow.getByTestId("message-send-status")).toHaveText(
    "Sending…",
  );
  await expect.poll(() => active(second)).toBe(1);
  const railWidth = () =>
    secondRow.evaluate(
      (el) =>
        Number.parseFloat(
          getComputedStyle(el).getPropertyValue("--message-action-rail-width"),
        ) || 0,
    );
  await expect.poll(railWidth).toBeGreaterThan(0);
  const rail = secondRow.getByTestId(`message-action-bar-${second}`);
  const measuredBeforeResize = await railWidth();
  await rail.evaluate((element, width) => {
    element.style.width = `${width}px`;
  }, measuredBeforeResize + 40);
  await expect.poll(railWidth).toBe(measuredBeforeResize + 40);
  await rail.evaluate((element) => element.style.removeProperty("width"));
  await expect.poll(railWidth).toBe(measuredBeforeResize);
  await page.setViewportSize({ width: 900, height: 700 });
  await expect.poll(railWidth).toBeGreaterThan(0);

  await setPending(false);
  await expect(secondRow.getByTestId("message-header")).toHaveCount(0);
  await expect.poll(() => active(second)).toBe(0);
  expect(await railWidth()).toBe(0);
  // Controls stay mounted and reveal on hover/focus without measuring unused width.
  await secondRow.hover();
  await expect(rail).toHaveCSS("opacity", "1");
  await page.mouse.move(0, 0);
  await rail.getByRole("button").first().focus();
  await expect(rail).toHaveCSS("opacity", "1");
  await setPending(true);
  await expect.poll(() => active(second)).toBe(1);
  await page.getByTestId("channel-random").click();
  await expect(secondRow).toHaveCount(0);
  await expect.poll(() => active(second)).toBe(0);
});
