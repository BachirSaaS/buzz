import { expect, test, type Page } from "@playwright/test";
import { installMockBridge } from "../helpers/bridge";

async function holdStartupCommand(page: Page, commandToHold: string) {
  // Intercept the existing native boundary, not the readiness hook itself.
  await page.addInitScript((commandToHold) => {
    type Invoke = (
      command: string,
      args: unknown,
      options: unknown,
    ) => Promise<unknown>;
    const state = { pending: 0, release: (_error?: string) => {} };
    Object.assign(window, { __STARTUP_GATE__: state });
    let settle: (error?: string) => void = () => {};
    const gate = new Promise<void>((resolve, reject) => {
      settle = (error) => (error ? reject(new Error(error)) : resolve());
    });
    let holding = true;
    state.release = (error) => {
      holding = false;
      settle(error);
    };
    const internals = {};
    let inner: Invoke;
    Object.defineProperty(internals, "invoke", {
      configurable: true,
      get: () => async (command: string, args: unknown, options: unknown) => {
        if (command === commandToHold && holding) {
          state.pending++;
          await gate;
        }
        return inner(command, args, options);
      },
      set: (invoke: Invoke) => {
        inner = invoke;
      },
    });
    Object.assign(window, { __TAURI_INTERNALS__: internals });
  }, commandToHold);
}

async function releaseStartup(page: Page, error?: string) {
  await page.evaluate((error) => {
    (
      window as Window & {
        __STARTUP_GATE__: { release: (error?: string) => void };
      }
    ).__STARTUP_GATE__.release(error);
  }, error);
}

for (const cached of [false, true]) {
  test(`ready sidebar accepts input without a cosmetic hold (${cached ? "cached" : "uncached"})`, async ({
    page,
  }) => {
    await installMockBridge(page);
    await page.addInitScript(() => {
      // Old production waited 1200 + 200ms; normal E2E skipped that wait.
      // Keep this override to make restoring the old implementation fail here.
      Object.assign(window.__BUZZ_E2E__ ?? {}, { bootSplashHoldMs: 1200 });
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
    const row = page.getByTestId("channel-general");
    await expect(row).toBeVisible();
    // Synchronous hit-test: unlike click() auto-wait, this cannot hide a splash
    // intercepting input for another second above an already-mounted sidebar.
    expect(
      await row.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return element.contains(
          document.elementFromPoint(
            rect.x + rect.width / 2,
            rect.y + rect.height / 2,
          ),
        );
      }),
    ).toBe(true);
    await row.click();
    await expect(page.getByTestId("chat-title")).toHaveText("general");
    await expect(page.getByTestId("message-row").first()).toBeVisible();
    await page.getByTestId("message-input").fill("Ready now");
    await expect(page.getByTestId("message-input")).toHaveText("Ready now");
    await expect(page.getByTestId("boot-splash-overlay")).toHaveCount(0);
  });
}

for (const command of ["set_agent_avatar_communities", "apply_workspace"]) {
  test(`real startup gate remains while ${command} is pending`, async ({
    page,
  }) => {
    await installMockBridge(page);
    await holdStartupCommand(page, command);
    await page.goto("/");
    const gate = page.getByTestId("app-loading-gate");
    await expect(gate).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window as Window & { __STARTUP_GATE__: { pending: number } })
              .__STARTUP_GATE__.pending,
        ),
      )
      .toBeGreaterThan(0);
    await expect(page.getByTestId("home-inbox-list")).toHaveCount(0);
    await expect(page.getByTestId("channel-general")).toHaveCount(0);
    expect(
      await page.evaluate(() =>
        window.__BUZZ_E2E_COMMANDS__?.includes("get_channels"),
      ),
    ).toBe(false);
    const wingState = await gate.locator(".bee-wing-left").evaluate((wing) => ({
      name: getComputedStyle(wing).animationName,
      state: wing.getAnimations()[0]?.playState,
    }));
    expect(wingState).toEqual({ name: "bee-wing-left-flap", state: "running" });
    await releaseStartup(page);
    await page.getByTestId("channel-general").click();
    await expect(page.getByTestId("chat-title")).toHaveText("general");
    await expect(gate).toHaveCount(0);
  });
}

test("failed community apply stays closed and retry is usable", async ({
  page,
}) => {
  await installMockBridge(page);
  await holdStartupCommand(page, "apply_workspace");
  await page.goto("/");
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as Window & { __STARTUP_GATE__: { pending: number } })
            .__STARTUP_GATE__.pending,
      ),
    )
    .toBeGreaterThan(0);
  await releaseStartup(page, "Startup apply failed");
  await expect(page.getByTestId("community-apply-error")).toContainText(
    "Startup apply failed",
  );
  await expect(page.getByTestId("channel-general")).toHaveCount(0);
  expect(
    await page.evaluate(() =>
      window.__BUZZ_E2E_COMMANDS__?.includes("get_channels"),
    ),
  ).toBe(false);
  await page.getByTestId("community-apply-error-retry").click();
  await page.getByTestId("channel-general").click();
  await expect(page.getByTestId("chat-title")).toHaveText("general");
  await expect(page.getByTestId("community-apply-error")).toHaveCount(0);
});
