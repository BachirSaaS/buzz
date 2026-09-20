import { expect, test } from "@playwright/test";

import { installMockBridge, TEST_IDENTITIES } from "../helpers/bridge";

// Hold the actual IPC snapshot across navigation. A reply committed while the
// channel is closed predates the returning live subscription: only a fresh
// history read can recover it. No timeout can release the obsolete snapshot.
test("returning to a thread displays replies missed while its old fetch was pending", async ({
  page,
}) => {
  const start = Math.floor(Date.now() / 1000);
  await page.clock.setFixedTime(start * 1000);
  await installMockBridge(page, { deferThreadReplies: true });
  await page.goto("/");
  await page.getByTestId("channel-general").click();
  await expect(page.getByTestId("chat-title")).toHaveText("general");
  const openThread = async () => {
    await page.getByTestId("reply-message-mock-general-welcome").click({
      force: true,
    });
    await expect(page.getByTestId("message-thread-panel")).toBeVisible();
  };
  await openThread();
  await expect
    .poll(() =>
      page.evaluate(() => window.__BUZZ_E2E_THREAD_REPLIES_PENDING__?.()),
    )
    .toBe(1);

  await page.getByTestId("channel-random").click();
  await expect(page.getByTestId("chat-title")).toHaveText("random");
  await expect(page.getByTestId("message-thread-panel")).toHaveCount(0);
  const reply = await page.evaluate(
    ({ start, pubkey }) =>
      window.__BUZZ_E2E_EMIT_MOCK_MESSAGE__?.({
        channelName: "general",
        parentEventId: "mock-general-welcome",
        content: "Reply committed while away from this thread",
        pubkey,
        createdAt: start + 1,
      }),
    { start, pubkey: TEST_IDENTITIES.alice.pubkey },
  );
  expect(reply?.id).toBeTruthy();
  await page.clock.setFixedTime((start + 2) * 1000);
  await page.getByTestId("channel-general").click();
  await expect(page.getByTestId("chat-title")).toHaveText("general");
  await openThread();
  // Release old and replacement snapshots together. Buggy code has only the
  // old one and renders no latest reply; fixed code discards the old response.
  await page.evaluate(() => window.__BUZZ_E2E_RELEASE_THREAD_REPLIES__?.());
  await expect(
    page
      .getByTestId("message-thread-panel")
      .locator(`[data-message-id="${reply?.id}"]`)
      .getByTestId("message-body"),
  ).toHaveText("Reply committed while away from this thread");
  await expect(page.getByTestId("message-thread-replies-error")).toHaveCount(0);
});
