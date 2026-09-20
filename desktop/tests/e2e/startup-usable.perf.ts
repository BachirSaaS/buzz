import { expect, test } from "@playwright/test";
import { installMockBridge } from "../helpers/bridge";

// Opt-in matched browser benchmark. Native startup and relay work are mocked.
test.skip(!process.env.BUZZ_STARTUP_BENCHMARK, "opt-in startup measurement");
for (const cached of [false, true]) {
  test(`startup usable (${cached ? "cached roster" : "no snapshot"})`, async ({
    page,
  }, testInfo) => {
    await installMockBridge(page);
    await page.addInitScript(() => {
      // Reproduce the OLD production policy, which its default E2E path skips.
      // The candidate removes this policy altogether and ignores this field.
      Object.assign(window.__BUZZ_E2E__ ?? {}, { bootSplashHoldMs: 1200 });
      const samples: Record<string, number> = {};
      Object.assign(window, { __STARTUP_SAMPLE__: samples });
      const inspect = () => {
        const row = document.querySelector('[data-testid="channel-general"]');
        if (row) {
          samples.rowMounted ??= performance.now();
          const box = row.getBoundingClientRect();
          if (
            box.width &&
            box.height &&
            row.contains(
              document.elementFromPoint(
                box.x + box.width / 2,
                box.y + box.height / 2,
              ),
            )
          ) {
            samples.rowReceivesPointer ??= performance.now();
          }
        }
        if (!samples.rowReceivesPointer) requestAnimationFrame(inspect);
      };
      requestAnimationFrame(inspect);
      document.addEventListener(
        "click",
        (event) => {
          if (
            (event.target as Element).closest('[data-testid="channel-general"]')
          )
            samples.channelClicked = performance.now();
        },
        true,
      );
    });
    await page.goto("/");
    if (cached) {
      await expect(page.getByTestId("channel-general")).toBeVisible();
      await expect
        .poll(() =>
          page.evaluate(() =>
            Object.keys(localStorage).some((key) =>
              key.startsWith("buzz-channels.v1:"),
            ),
          ),
        )
        .toBe(true);
      await page.reload();
    }
    await page.getByTestId("channel-general").click();
    await expect(page.getByTestId("chat-title")).toHaveText("general");
    await expect(page.getByTestId("message-row").first()).toBeVisible();
    await page.getByTestId("message-input").fill("Startup input check");
    const result = await page.evaluate(() => ({
      ...(window as Window & { __STARTUP_SAMPLE__: Record<string, number> })
        .__STARTUP_SAMPLE__,
      contentAndInputReady: performance.now(),
      snapshotPresence: (
        performance
          .getEntriesByName("buzz:sidebar:snapshot-diagnostic")
          .at(-1) as PerformanceMark
      )?.detail?.presence,
    }));
    expect(result.snapshotPresence).toBe(cached ? "present" : "absent");
    console.log(
      "STARTUP_SAMPLE",
      JSON.stringify({
        scenario: cached ? "cached" : "no-snapshot",
        ...result,
      }),
    );
    await testInfo.attach("startup-sample", {
      body: JSON.stringify(result, null, 2),
      contentType: "application/json",
    });
  });
}
