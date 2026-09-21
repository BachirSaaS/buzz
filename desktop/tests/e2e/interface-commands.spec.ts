import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { installMockBridge, TEST_IDENTITIES } from "../helpers/bridge";
import { openCommandInput } from "../helpers/interfaceCommands";
import { waitForAnimations } from "../helpers/animations";

const desktopCsp: string = JSON.parse(
  readFileSync(
    new URL("../../src-tauri/tauri.conf.json", import.meta.url),
    "utf8",
  ),
).app.security.csp;

const decision = (choice: string) => ({
  choice,
  probability: 0.95,
  margin: 0.9,
});
const box = (page: Page) =>
  page.getByRole("dialog", { name: "Buzz commands", exact: true });
async function saved(page: Page) {
  return page.evaluate(() =>
    JSON.parse(
      Object.entries(localStorage).find(([key]) =>
        key.startsWith("buzz-workspaces.v1:"),
      )?.[1] ?? "{}",
    ),
  );
}
async function command(page: Page, text: string) {
  if (!(await box(page).isVisible())) await openCommandInput(page);
  await box(page)
    .getByRole("textbox", { name: "Interface command" })
    .fill(text);
  await box(page)
    .getByRole("button", { name: "Run command", exact: true })
    .click();
}
async function planner(
  page: Page,
  action: string,
  picks: Record<string, string>,
) {
  await page.unroute("**/__pulse/intent");
  await page.route("**/__pulse/intent", async (route) => {
    const input = route.request().postDataJSON();
    const answers = Object.fromEntries(
      Object.keys(input.questions).map((id) => {
        const value =
          id === "command"
            ? (Object.entries(input.questions.command.criteria).find(
                ([, v]) => v === input.request,
              )?.[0] ?? "none")
            : id === "readiness"
              ? "act"
              : id === "action"
                ? action
                : (picks[id] ??
                  (id === "scope"
                    ? "create"
                    : id.startsWith("target_") || id.startsWith("area_")
                      ? "none"
                      : "0"));
        expect(Object.hasOwn(input.questions[id].criteria, value)).toBeTruthy();
        return [id, decision(value)];
      }),
    );
    await route.fulfill({ json: answers });
  });
}
test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.route("**/*", async (route) => {
    if (route.request().resourceType() !== "document") return route.fallback();
    const response = await route.fetch();
    await route.fulfill({
      response,
      headers: { ...response.headers(), "Content-Security-Policy": desktopCsp },
    });
  });
  await page.route("**/__pulse/briefing", (route) =>
    route.fulfill({ json: { highlights: [] } }),
  );
  await page.route("**/__chief", (route) =>
    route.fulfill({ status: 503, json: {} }),
  );
  await installMockBridge(page);
  await page.goto("/#/pulse");
  await expect(
    page.getByRole("tab", { name: "Home", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
});
test("a group DM command opens a real composer with editable recipients and never sends", async ({
  page,
}) => {
  const writes: string[] = [];
  await page.exposeFunction("recordVoiceWrite", (name: string) =>
    writes.push(name),
  );
  await page.evaluate(() => {
    const original = window.__TAURI_INTERNALS__.invoke;
    window.__TAURI_INTERNALS__.invoke = async (
      name: string,
      payload?: Record<string, unknown>,
    ) => {
      if (["open_dm", "send_channel_message"].includes(name))
        await (
          window as unknown as {
            recordVoiceWrite: (name: string) => Promise<void>;
          }
        ).recordVoiceWrite(name);
      return original(name, payload);
    };
  });
  const before = await saved(page);
  await planner(page, "new_dm", {
    count: "2",
    target_1: TEST_IDENTITIES.alice.pubkey,
    target_2: TEST_IDENTITIES.bob.pubkey,
  });
  await command(page, "start a dm with Alice and Bob");
  await expect(box(page).getByRole("status")).toContainText("DM draft opened");
  await expect(page.locator(".live-voice-feedback")).toHaveCount(0);
  await page.keyboard.press("Escape");
  const composer = page.getByTestId("new-message-page");
  await expect(
    composer.getByTestId(`new-dm-selected-${TEST_IDENTITIES.alice.pubkey}`),
  ).toBeVisible();
  await expect(
    composer.getByTestId(`new-dm-selected-${TEST_IDENTITIES.bob.pubkey}`),
  ).toBeVisible();
  await expect(
    composer.getByRole("combobox", { name: "To", exact: true }),
  ).toBeEditable();
  expect(writes).toEqual([]);
  const after = await saved(page);
  expect(after.items).toHaveLength(before.items.length);
  const home = after.items.find((w: { id: string }) => w.id === "home");
  expect(home.canvas.windows).toHaveLength(1);
  expect(Object.values(home.canvas.routes)[0]).toMatchObject({
    compose: "message",
    voiceRecipients: `${TEST_IDENTITIES.alice.pubkey},${TEST_IDENTITIES.bob.pubkey}`,
  });
  await waitForAnimations(page);
  await composer.screenshot({
    path: "test-results/interface-commands/dm-draft.png",
  });
  await page.reload();
  await expect(
    page.getByTestId(`new-dm-selected-${TEST_IDENTITIES.bob.pubkey}`),
  ).toBeVisible();
});
test("Enter submits commands, Shift+Enter adds a line, and workspace navigation also goes through Jev", async ({
  page,
}) => {
  let requests = 0;
  page.on("request", (request) => {
    if (request.url().endsWith("/__pulse/intent")) requests++;
  });
  await planner(page, "create_workspace", {
    count: "0",
    layout: "auto",
    text: "5",
  });
  await openCommandInput(page);
  const input = box(page).getByRole("textbox", { name: "Interface command" });
  await input.press("Enter");
  await expect(box(page).getByRole("alert")).toHaveCount(0);
  await input.fill("create a workspace named nightriders");
  await input.press("Shift+Enter");
  await expect(input).toHaveValue("create a workspace named nightriders\n");
  await input.dispatchEvent("keydown", { key: "Enter", isComposing: true });
  await input.dispatchEvent("keydown", { key: "Enter", keyCode: 229 });
  await input.dispatchEvent("keydown", { key: "Enter", repeat: true });
  expect(requests).toBe(0);
  await input.press("Enter");
  await expect(
    page.getByRole("tab", { name: "nightriders", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  expect(requests).toBe(3);
  const night = (await saved(page)).active;
  await planner(page, "switch_workspace", { workspace: night });
  for (const text of ["switch to nightriders", "switch to night riders"]) {
    await page.keyboard.press("Escape");
    await page.getByRole("tab", { name: "Home", exact: true }).click();
    await openCommandInput(page);
    await input.fill(text);
    await input.press("Enter");
    await expect(
      page.getByRole("tab", { name: "nightriders", exact: true }),
    ).toHaveAttribute("aria-selected", "true");
    await expect(box(page).getByRole("alert")).toHaveCount(0);
  }
  expect(requests).toBe(7);
});

test("commands create, move, resize and undo persisted windows", async ({
  page,
}) => {
  await planner(page, "create_workspace", {
    count: "2",
    target_1: "widget:music",
    target_2: "widget:weather",
    layout: "columns",
    text: "0",
  });
  await command(page, "create a workspace with music and weather side by side");
  await expect(box(page).getByRole("status")).toContainText(
    "Workspace created",
  );
  await expect(
    page.locator('[data-canvas-frame="widget:music"]'),
  ).toBeVisible();
  await planner(page, "move_window", {
    window: "widget:music",
    placement: "left",
  });
  await command(page, "move music left");
  await expect(box(page).getByRole("status")).toContainText("Windows updated");
  const moved = await saved(page);
  const canvas = moved.items.find(
    (w: { id: string }) => w.id === moved.active,
  ).canvas;
  expect(canvas.layout).toBe("freeform");
  expect(canvas.freeform.frames["widget:music"].x).toBe(0);
  await planner(page, "resize_window", {
    window: "widget:music",
    size: "smaller",
  });
  await command(page, "make music smaller");
  await expect
    .poll(async () => {
      const next = await saved(page);
      return next.items.find((w: { id: string }) => w.id === next.active).canvas
        .freeform.frames["widget:music"].width;
    })
    .toBeLessThan(canvas.freeform.frames["widget:music"].width);
  await planner(page, "undo", {});
  await command(page, "undo");
  await expect(box(page).getByRole("status")).toContainText("Command undone");
  expect(await saved(page)).toEqual(moved);
});
test("cancelled and stale commands cannot mutate a different workspace", async ({
  page,
}) => {
  let release: (() => void) | undefined;
  let calls = 0;
  await page.route("**/__pulse/intent", async (route) => {
    calls++;
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    await route
      .fulfill({ json: { action: decision("new_dm") } })
      .catch(() => {});
  });
  await command(page, "start a dm with Alice");
  await expect.poll(() => calls).toBe(1);
  const send = box(page).getByRole("button", { name: "Run command" });
  await expect(send).toHaveAttribute("aria-busy", "true");
  await expect(send.locator(".animate-spin")).toBeVisible();
  await expect(page.locator(".live-voice-feedback")).toHaveCount(0);
  await expect(
    box(page).getByRole("button", { name: "Close voice commands" }),
  ).toHaveCount(0);
  await page.keyboard.press("Escape");
  const before = await saved(page);
  release?.();
  await expect(box(page)).toHaveCount(0);
  expect(await saved(page)).toEqual(before);
  await command(page, "start a dm with Alice");
  await expect.poll(() => calls).toBe(2);
  await page.getByRole("tab", { name: "Messages", exact: true }).click();
  release?.();
  await expect(
    page.getByRole("tab", { name: "Messages", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  const next = await saved(page);
  expect(
    next.items.every(
      (w: { canvas: { windows: string[] } }) => w.canvas.windows.length === 0,
    ),
  ).toBeTruthy();
});

test("live microphone executes evolving speech without stopping, keeps listening across actions, and releases tracks on Escape", async ({
  page,
}) => {
  // Prove the policy is enforced: Vite's default small-asset inlining broke
  // this exact worklet-loading path in the packaged desktop app.
  expect(
    await page.evaluate(async () => {
      const context = new AudioContext();
      try {
        await context.audioWorklet.addModule("data:text/javascript,void%200");
        return false;
      } catch {
        return true;
      } finally {
        await context.close();
      }
    }),
  ).toBe(true);
  await page.evaluate(() => {
    const original = window.__TAURI_INTERNALS__.invoke;
    Object.assign(window, {
      voiceCapturedBytes: 0,
      voicePrepareCalls: 0,
      voiceTrackStopped: false,
      liveText: "open weather",
    });
    window.__TAURI_INTERNALS__.invoke = async (
      command: string,
      payload?: Record<string, unknown>,
    ) => {
      if (command === "prepare_interface_voice") {
        (window as unknown as { voicePrepareCalls: number })
          .voicePrepareCalls++;
        return true;
      }
      if (command === "transcribe_interface_voice") {
        Object.assign(window, {
          voiceCapturedBytes: atob(String(payload?.pcm)).length,
        });
        return (window as unknown as { liveText: string }).liveText;
      }
      return original(command, payload);
    };
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
      configurable: true,
      async value() {
        Object.assign(window, { voiceTrackStopped: false });
        const context = new AudioContext();
        const oscillator = context.createOscillator();
        const destination = context.createMediaStreamDestination();
        const gain = context.createGain();
        gain.gain.value = 0.2;
        Object.assign(window, { voiceGain: gain });
        oscillator.connect(gain).connect(destination);
        oscillator.start();
        const track = destination.stream.getAudioTracks()[0];
        const stop = track.stop.bind(track);
        track.stop = () => {
          Object.assign(window, { voiceTrackStopped: true });
          oscillator.stop();
          void context.close();
          stop();
        };
        return destination.stream;
      },
    });
  });
  await planner(page, "open_windows", {
    count: "1",
    target_1: "widget:weather",
    layout: "auto",
  });
  const pill = page.getByRole("button", {
    name: "Buzz microphone",
    exact: true,
  });
  const status = page.locator(".live-voice-session").getByRole("status");
  await expect(pill).toBeVisible();
  await expect(pill).toHaveAttribute("aria-pressed", "false");
  await expect(pill.locator(".live-voice-waveform")).toHaveCSS(
    "opacity",
    "0.2",
  );
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { voicePrepareCalls: number }).voicePrepareCalls,
    ),
  ).toBe(0);
  const avatar = page.locator(".live-voice-avatar");
  await expect(avatar).toHaveAttribute("src", "/voice/fuzzy.gif");
  await expect
    .poll(() =>
      avatar.evaluate((node) => (node as HTMLImageElement).naturalWidth),
    )
    .toBe(96);
  await page.keyboard.press("Meta+b");
  await expect(pill).toHaveAttribute("aria-pressed", "true");
  await expect(pill.locator(".live-voice-waveform")).toHaveCSS("opacity", "1");
  await expect(box(page)).toHaveCount(0);
  await expect
    .poll(async () => {
      const bounds = await page.locator(".live-voice-pill").boundingBox();
      return (
        bounds && [
          Math.round(bounds.width),
          Math.round(bounds.height),
          Math.round(bounds.x),
          Math.round(bounds.y),
        ]
      );
    })
    .toEqual([128, 40, 656, 936]);
  expect(
    await pill.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return element.contains(
        document.elementFromPoint(rect.x + 64, rect.y + 20),
      );
    }),
  ).toBe(true);
  await page.evaluate(() => {
    // Key repeat must not toggle the active session off.
    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        code: "KeyB",
        key: "b",
        metaKey: true,
        repeat: true,
        bubbles: true,
      }),
    );
  });
  await expect(status).toContainText("Windows opened", {
    timeout: 15000,
  });
  await expect(page.locator(".live-voice-feedback")).toHaveCount(0);
  await expect(pill.locator(".live-voice-waveform svg")).toHaveCount(1);
  const strokes = pill.locator(".live-voice-waveform line");
  const opacity = async (index: number) =>
    Number(
      await strokes
        .nth(index)
        .evaluate((node) => getComputedStyle(node).opacity),
    );
  expect(await opacity(0)).toBeLessThan(await opacity(3));
  expect(await opacity(3)).toBeLessThan(await opacity(8));
  expect(await opacity(16)).toEqual(await opacity(0));
  await expect(pill).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { voiceTrackStopped: boolean }).voiceTrackStopped,
    ),
  ).toBe(false);
  await planner(page, "move_window", {
    window: "widget:weather",
    placement: "left",
  });
  await page.evaluate(() =>
    Object.assign(window, { liveText: "open weather move weather left" }),
  );
  await expect(status).toContainText("Windows updated");
  const afterMove = await saved(page);
  expect(
    afterMove.items.find((w: { id: string }) => w.id === afterMove.active)
      .canvas.freeform.frames["widget:weather"].x,
  ).toBe(0);
  await planner(page, "create_workspace", {
    count: "1",
    target_1: "widget:music",
    layout: "auto",
    text: "0",
  });
  await page.evaluate(() =>
    Object.assign(window, {
      liveText: "open weather move weather left create a workspace with music",
    }),
  );
  await expect(status).toContainText("Workspace created");
  await expect(pill).toBeVisible();
  const audio = await page.evaluate(() => ({
    bytes: (window as unknown as { voiceCapturedBytes: number })
      .voiceCapturedBytes,
    stopped: (window as unknown as { voiceTrackStopped: boolean })
      .voiceTrackStopped,
  }));
  expect(audio.bytes).toBeGreaterThan(0);
  expect(audio.bytes).toBeLessThanOrEqual(16000 * 12.3 * 4);
  expect(audio.stopped).toBe(false);
  const before = await saved(page);
  await page.keyboard.press("Escape");
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { voiceTrackStopped: boolean })
            .voiceTrackStopped,
      ),
    )
    .toBe(true);
  expect(await saved(page)).toEqual(before);
  await expect(pill).toBeVisible();
  await expect(pill).toHaveAttribute("aria-pressed", "false");
  await page.evaluate(() => Object.assign(window, { liveText: "" }));
  // Legacy shortcut and the typing toggle use this same session.
  await page.keyboard.press("Control+Shift+Space");
  await expect(pill).toBeVisible();
  await expect(pill).toHaveAttribute("title", "Listening · click to mute");
  const preparations = await page.evaluate(
    () =>
      (window as unknown as { voicePrepareCalls: number }).voicePrepareCalls,
  );
  await page.keyboard.press("Meta+b");
  await expect(pill).toHaveAttribute("aria-pressed", "true");
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { voicePrepareCalls: number }).voicePrepareCalls,
    ),
  ).toBe(preparations);
  await pill.click();
  await expect(pill).toHaveAttribute("aria-pressed", "false");
  await pill.click();
  await expect(pill).toHaveAttribute("aria-pressed", "true");
  await openCommandInput(page);
  await box(page)
    .getByRole("button", { name: "Switch to voice", exact: true })
    .click();
  await expect(pill).toBeVisible();
  await expect(box(page)).toHaveCount(0);
  await page.evaluate(() => Object.assign(window, { liveText: "" }));
  await page
    .getByRole("button", { name: "Switch to typing", exact: true })
    .click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { voiceTrackStopped: boolean })
            .voiceTrackStopped,
      ),
    )
    .toBe(true);
  const typed = box(page).getByRole("textbox", { name: "Interface command" });
  await expect(typed).toBeFocused();
  await typed.fill("keep this typed draft");
  await expect
    .poll(async () =>
      Math.round(
        (await page.locator(".live-voice-pill").boundingBox())?.width ?? 0,
      ),
    )
    .toBe(440);
  await waitForAnimations(page);
  await page.screenshot({
    path: "test-results/interface-commands/typed-capsule.png",
    clip: { x: 440, y: 900, width: 560, height: 100 },
  });
  await box(page)
    .getByRole("button", { name: "Switch to voice", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Switch to typing", exact: true })
    .click();
  await expect(typed).toHaveValue("keep this typed draft");
  await expect(typed).toBeFocused();
  await box(page)
    .getByRole("button", { name: "Switch to voice", exact: true })
    .click();
  const wave = pill.locator(".live-voice-waveform-primary line").last();
  await expect
    .poll(async () => (await wave.boundingBox())?.height)
    .toBeGreaterThan(10);
  await page.evaluate(() => {
    (window as unknown as { voiceGain: GainNode }).voiceGain.gain.value = 0;
  });
  await expect
    .poll(async () => (await wave.boundingBox())?.height)
    .toBeLessThan(4);
  await waitForAnimations(page);
  await page.screenshot({
    path: "test-results/interface-commands/voice-pill.png",
    clip: { x: 600, y: 920, width: 240, height: 72 },
  });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(avatar).toHaveAttribute("src", "/voice/fuzzy-still.png");
  await expect
    .poll(async () => Math.round((await wave.boundingBox())?.height ?? 0))
    .toBe(6);
  await pill.click();
  await expect(pill).toBeVisible();
  await expect(pill).toHaveAttribute("aria-pressed", "false");
  await expect(pill.locator(".live-voice-waveform")).toHaveCSS(
    "opacity",
    "0.2",
  );
  await page.evaluate(() => {
    Object.assign(window, { voiceTrackStopped: false });
    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        code: "KeyB",
        key: "b",
        metaKey: true,
        isComposing: true,
        bubbles: true,
      }),
    );
  });
  await expect(pill).toBeVisible();
  await expect(pill).toHaveAttribute("aria-pressed", "false");
});

test("unclear recipients ask a follow-up, preserve the first recipient, and learn the confirmed name", async ({
  page,
}) => {
  let actions = 0;
  await page.route("**/__pulse/intent", async (route) => {
    const input = route.request().postDataJSON();
    if (input.questions.action) {
      actions++;
      await route.fulfill({ json: { action: decision("new_dm") } });
    } else if (input.questions.recipient) {
      await route.fulfill({
        json: { recipient: decision(TEST_IDENTITIES.bob.pubkey) },
      });
    } else {
      await route.fulfill({
        json: Object.fromEntries(
          Object.keys(input.questions).map((id) => [
            id,
            decision(
              id === "count"
                ? "2"
                : id === "target_1"
                  ? TEST_IDENTITIES.alice.pubkey
                  : id === "target_2"
                    ? "unavailable"
                    : "none",
            ),
          ]),
        ),
      });
    }
  });
  const before = await saved(page);
  await command(page, "start a dm with Alice and Brooke");
  await expect(box(page).getByRole("status")).toContainText(
    "Who do you mean by “Brooke”",
  );
  expect(await saved(page)).toEqual(before);
  await expect(box(page).getByRole("alert")).toHaveCount(0);
  await command(page, "Bob");
  await expect(box(page).getByRole("status")).toContainText("DM draft opened");
  await expect(page.locator(".live-voice-feedback")).toHaveCount(0);
  expect(actions).toBe(1);
  await expect(
    page.getByTestId(`new-dm-selected-${TEST_IDENTITIES.alice.pubkey}`),
  ).toBeVisible();
  await expect(
    page.getByTestId(`new-dm-selected-${TEST_IDENTITIES.bob.pubkey}`),
  ).toBeVisible();
  const aliases = await page.evaluate(
    () =>
      Object.entries(localStorage).find(([key]) =>
        key.startsWith("buzz-voice-names.v1:"),
      )?.[1],
  );
  expect(JSON.parse(aliases ?? "{}")[TEST_IDENTITIES.bob.pubkey]).toEqual([
    "Brooke",
  ]);
  await command(page, "start a dm with Alice and Brooke");
  await expect(box(page).getByRole("status")).toContainText("DM draft opened");
  await expect(page.locator(".live-voice-feedback")).toHaveCount(0);
  await expect(
    box(page).getByRole("button", { name: "Cancel", exact: true }),
  ).toHaveCount(0);
});

test("cancelling a recipient clarification leaves the workspace unchanged", async ({
  page,
}) => {
  await planner(page, "new_dm", { count: "1", target_1: "unavailable" });
  const before = await saved(page);
  await command(page, "start a dm with Brooke");
  await expect(box(page).getByRole("status")).toContainText("Who do you mean");
  await box(page).getByRole("button", { name: "Cancel", exact: true }).click();
  expect(await saved(page)).toEqual(before);
  await planner(page, "open_windows", {
    count: "1",
    target_1: "widget:music",
    layout: "auto",
  });
  await command(page, "open music");
  await expect(box(page).getByRole("status")).toContainText("Windows opened");
});

test("a recipient choice button completes the pending draft without another classification", async ({
  page,
}) => {
  await planner(page, "new_dm", {
    count: "2",
    target_1: TEST_IDENTITIES.alice.pubkey,
    target_2: "unavailable",
  });
  await command(page, "start a dm with Alice and Brooke");
  await expect(box(page).getByRole("status")).toContainText("Who do you mean");
  await box(page)
    .getByRole("group", { name: "Recipient choices" })
    .getByRole("button", { name: /bob/i })
    .click();
  await expect(box(page).getByRole("status")).toContainText("DM draft opened");
  await expect(page.locator(".live-voice-feedback")).toHaveCount(0);
  await expect(
    page.getByTestId(`new-dm-selected-${TEST_IDENTITIES.bob.pubkey}`),
  ).toBeVisible();
});

test("a remembered name resolves someone outside DM history and directory search results", async ({
  page,
}) => {
  const pubkey = "f".repeat(64);
  await page.evaluate(
    ({ pubkey }) => {
      const key = Object.keys(localStorage).find((k) =>
        k.startsWith("buzz-workspaces.v1:"),
      );
      if (!key) throw new Error("Workspace scope is unavailable");
      localStorage.setItem(
        key.replace("buzz-workspaces.v1:", "buzz-voice-names.v1:"),
        JSON.stringify({ [pubkey]: ["Brooke"] }),
      );
      const original = window.__TAURI_INTERNALS__.invoke;
      window.__TAURI_INTERNALS__.invoke = async (
        name: string,
        payload?: Record<string, unknown>,
      ) => {
        const result = await original(name, payload);
        if (
          name === "get_users_batch" &&
          (payload?.pubkeys as string[]).includes(pubkey)
        )
          return {
            ...result,
            profiles: {
              ...result.profiles,
              [pubkey]: {
                display_name: "Brooke Jones",
                nip05_handle: "bjones",
                avatar_url: null,
                owner_pubkey: null,
                is_agent: false,
              },
            },
          };
        return result;
      };
    },
    { pubkey },
  );
  await planner(page, "new_dm", { count: "1", target_1: "unavailable" });
  await command(page, "start a dm with Brooke");
  await expect(box(page).getByRole("status")).toContainText("DM draft opened");
  await expect(page.locator(".live-voice-feedback")).toHaveCount(0);
  await expect(page.getByTestId(`new-dm-selected-${pubkey}`)).toBeVisible();
});

test("Ask Buzz snaps regions, uses absolute sizes, tiles rows and persists the arrangement", async ({
  page,
}) => {
  await planner(page, "create_workspace", {
    count: "2",
    target_1: "widget:music",
    target_2: "widget:weather",
    layout: "columns",
    text: "0",
  });
  await command(page, "create a workspace with music and weather");
  await expect(box(page).getByRole("status")).toContainText(
    "Workspace created",
  );
  const bounds = await page
    .getByTestId("pulse-canvas")
    .evaluate((el) => ({ width: el.clientWidth, height: el.clientHeight }));
  await planner(page, "move_window", {
    window: "widget:weather",
    placement: "bottom_third",
  });
  await command(page, "weather in the bottom third");
  await expect(box(page).getByRole("status")).toContainText("Windows updated");
  let state = await saved(page);
  let canvas = state.items.find(
    (w: { id: string }) => w.id === state.active,
  ).canvas;
  expect(canvas.freeform.frames["widget:weather"].y).toBeCloseTo(
    (bounds.height * 2) / 3,
  );
  expect(canvas.freeform.frames["widget:weather"].height).toBeCloseTo(
    bounds.height / 3,
  );
  await planner(page, "resize_window", {
    window: "widget:music",
    size: "small",
  });
  await command(page, "make music a small window");
  await expect(box(page).getByRole("status")).toContainText("Windows updated");
  state = await saved(page);
  canvas = state.items.find(
    (w: { id: string }) => w.id === state.active,
  ).canvas;
  expect(canvas.freeform.frames["widget:music"].width).toBeCloseTo(
    bounds.width * 0.35,
  );
  await planner(page, "arrange_windows", { layout: "rows" });
  await command(page, "split screen top and bottom");
  await expect(box(page).getByRole("status")).toContainText("Windows updated");
  state = await saved(page);
  canvas = state.items.find(
    (w: { id: string }) => w.id === state.active,
  ).canvas;
  expect(canvas.freeform.frames["widget:music"].height).toBeCloseTo(
    bounds.height / 2,
  );
  expect(canvas.freeform.frames["widget:weather"].y).toBeCloseTo(
    bounds.height / 2,
  );
  await page.reload();
  await expect(
    page.locator('[data-canvas-frame="widget:weather"]'),
  ).toBeVisible();
  expect(
    (await saved(page)).items.find((w: { id: string }) => w.id === state.active)
      .canvas,
  ).toEqual(canvas);
});

test("voice shortcut exposes microphone startup errors in the typing capsule", async ({
  page,
}) => {
  await page.evaluate(() => {
    const original = window.__TAURI_INTERNALS__.invoke;
    window.__TAURI_INTERNALS__.invoke = async (
      command: string,
      payload?: Record<string, unknown>,
    ) => {
      if (command === "prepare_interface_voice")
        throw new Error("Microphone unavailable. Try again.");
      return original(command, payload);
    };
  });
  await page.keyboard.press("Meta+b");
  await expect(box(page).getByRole("alert")).toContainText(
    "Microphone unavailable",
  );
  await expect(
    page.getByRole("button", { name: "Buzz microphone", exact: true }),
  ).toHaveCount(0);
  await expect(
    box(page).getByRole("button", { name: "Switch to voice", exact: true }),
  ).toBeEnabled();
});

test("bulk percentage resizing changes every window atomically and undo restores all geometry", async ({
  page,
}) => {
  await planner(page, "create_workspace", {
    count: "2",
    target_1: "widget:music",
    target_2: "widget:weather",
    layout: "columns",
    text: "0",
  });
  await command(page, "create a workspace with music and weather side by side");
  await expect(box(page).getByRole("status")).toContainText(
    "Workspace created",
  );
  await waitForAnimations(page);
  const originals = await page
    .locator("[data-canvas-frame]")
    .evaluateAll((nodes) =>
      Object.fromEntries(
        nodes.map((node) => {
          const rect = node.getBoundingClientRect();
          return [
            (node as HTMLElement).dataset.canvasFrame,
            { width: rect.width, height: rect.height },
          ];
        }),
      ),
    );
  await page
    .locator('[data-canvas-frame="widget:music"]')
    .click({ position: { x: 20, y: 20 } });
  const before = await saved(page);
  const input = await openCommandInput(page);
  await page.evaluate(() => {
    const setItem = Storage.prototype.setItem;
    (window as unknown as { resizeWrites: number }).resizeWrites = 0;
    Storage.prototype.setItem = function (key, value) {
      if (key.startsWith("buzz-workspaces.v1:"))
        (window as unknown as { resizeWrites: number }).resizeWrites++;
      setItem.call(this, key, value);
    };
  });
  await planner(page, "resize_window", {
    window: "all",
    size: "smaller",
    percentage: "25",
  });
  await input
    .getByRole("textbox", { name: "Interface command" })
    .fill("all windows 25% smaller");
  await input
    .getByRole("textbox", { name: "Interface command" })
    .press("Enter");
  await expect(box(page).getByRole("status")).toContainText("Windows updated");
  const after = await saved(page);
  const canvas = after.items.find(
    (item: { id: string }) => item.id === after.active,
  ).canvas;
  for (const id of ["widget:music", "widget:weather"]) {
    expect(canvas.freeform.frames[id].width).toBeCloseTo(
      Math.max(240, originals[id].width * 0.75),
    );
    expect(canvas.freeform.frames[id].height).toBeCloseTo(
      Math.max(180, originals[id].height * 0.75),
    );
  }
  expect(
    await page.evaluate(
      () => (window as unknown as { resizeWrites: number }).resizeWrites,
    ),
  ).toBe(1);
  await planner(page, "undo", {});
  await command(page, "undo");
  await expect(box(page).getByRole("status")).toContainText("Command undone");
  // The parser adds empty metadata maps; every saved value and frame is restored.
  expect(await saved(page)).toMatchObject(before);
});

test("the command bar falls back to exact app lists when Jev is unavailable and offers keyboard and pointer destinations", async ({
  page,
}) => {
  let calls = 0;
  await page.route("**/__pulse/intent", (route) => {
    calls++;
    return route.fulfill({ status: 503 });
  });
  const dialog = await openCommandInput(page);
  const input = dialog.getByRole("textbox", { name: "Interface command" });
  await input.fill("show me a list of my projects");
  await expect(
    dialog.getByRole("listbox", { name: "Buzz destinations" }),
  ).toBeVisible();
  await input.press("Enter");
  const projects = page.locator('[data-content-id="app:projects"]');
  await expect(
    projects.getByTestId("projects-section-projects"),
  ).toHaveAttribute("aria-current", "page");
  await expect(input).toHaveValue("");
  await input.fill("repos");
  await input.press("ArrowDown");
  await input.press("Enter");
  await expect(
    page
      .locator('[data-content-id="app:project-repositories"]')
      .getByTestId("projects-section-repositories"),
  ).toHaveAttribute("aria-current", "page");
  await input.fill("issues");
  await dialog.getByRole("option", { name: "Issues App", exact: true }).click();
  await expect(
    page
      .locator('[data-content-id="app:project-issues"]')
      .getByTestId("projects-section-issues"),
  ).toHaveAttribute("aria-current", "page");
  expect(calls).toBe(1);
  await input.fill("appearance");
  await input.press("Enter");
  await expect(page).toHaveURL(/section=appearance/);
  expect(calls).toBe(2);
});

test("command search reaches history outside the feed, retains operators and opens message results", async ({
  page,
}) => {
  await page.evaluate(() => {
    const original = window.__TAURI_INTERNALS__.invoke;
    Object.assign(window, { commandSearchRequests: [] });
    window.__TAURI_INTERNALS__.invoke = async (
      command: string,
      payload?: Record<string, unknown>,
    ) => {
      if (command === "search_messages") {
        (
          window as unknown as { commandSearchRequests: unknown[] }
        ).commandSearchRequests.push(payload);
        return {
          found: 1,
          hits: [
            {
              event_id: "a".repeat(64),
              pubkey: "b".repeat(64),
              kind: 40002,
              content: "Historical launch plan from last year",
              created_at: 1700000000,
              channel_id: String(payload?.channelId),
              channel_name: "general",
              score: 1,
            },
          ],
        };
      }
      return original(command, payload);
    };
  });
  await page.route("**/__pulse/intent", (route) =>
    route.fulfill({ status: 503 }),
  );
  await command(page, "search Buzz for in:general launch");
  const search = page.getByRole("region", { name: "Search Buzz", exact: true });
  await expect(
    search.getByRole("textbox", { name: "Search Buzz" }),
  ).toHaveValue("in:general launch");
  await expect(
    search.getByText("Historical launch plan from last year", { exact: true }),
  ).toBeVisible();
  const requests = await page.evaluate(
    () =>
      (
        window as unknown as {
          commandSearchRequests: { q: string; channelId: string }[];
        }
      ).commandSearchRequests,
  );
  expect(requests.at(-1)?.q).toBe("launch");
  expect(requests.at(-1)?.channelId).toBeTruthy();
  await search
    .getByRole("button")
    .filter({ hasText: "Historical launch plan from last year" })
    .click();
  const state = await saved(page);
  const route = Object.values(
    state.items.find((item: { id: string }) => item.id === state.active).canvas
      .routes,
  ).find(
    (value) => (value as { messageId?: string }).messageId === "a".repeat(64),
  );
  expect(route).toMatchObject({
    feed: "conversation",
    messageId: "a".repeat(64),
  });
});

test("the bar opens channel discovery and creation forms without committing anything", async ({
  page,
}) => {
  let calls = 0;
  await page.route("**/__pulse/intent", (route) => {
    calls++;
    return route.fulfill({ status: 503 });
  });
  for (const [request, title] of [
    ["browse channels", "Browse channels"],
    ["create a channel", "Create a new channel"],
    ["create an agent", "Create agent"],
  ]) {
    await command(page, request);
    await expect(
      page.getByRole("dialog", { name: title, exact: true }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    await expect(
      page.getByRole("dialog", { name: title, exact: true }),
    ).toHaveCount(0);
  }
  expect(calls).toBe(3);
});

test("command suggestions stay attached to the bottom field and are usable by keyboard", async ({
  page,
}) => {
  await openCommandInput(page);
  const input = box(page).getByRole("textbox", { name: "Interface command" });
  await input.fill("project");
  await expect(
    box(page).getByRole("listbox", { name: "Buzz destinations" }),
  ).toBeVisible();
  await input.press("ArrowDown");
  await expect(
    box(page).getByRole("option", { name: "Projects App", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await waitForAnimations(page);
  await page.screenshot({
    path: "test-results/interface-commands/command-search-bar.png",
    clip: { x: 430, y: 540, width: 580, height: 460 },
  });
});

test("opening with placement and contextual group follow-ups persist atomically and forget on workspace switches", async ({
  page,
}) => {
  await planner(page, "create_workspace", {
    count: "3",
    target_1: "widget:music",
    target_2: "widget:weather",
    target_3: "widget:inbox",
    layout: "auto",
    text: "0",
  });
  await command(page, "create a workspace with music weather and inbox");
  await expect(page.getByTestId("canvas-window")).toHaveCount(3);
  await page.evaluate(() => {
    const key = Object.keys(localStorage).find((key) =>
      key.startsWith("buzz-workspaces.v1:"),
    );
    if (!key) throw new Error("Workspace missing");
    const saved = JSON.parse(localStorage.getItem(key) ?? "{}");
    const active = saved.items.find(
      (w: { id: string }) => w.id === saved.active,
    );
    active.canvas.layout = "freeform";
    active.canvas.freeform = {
      frames: Object.fromEntries(
        active.canvas.windows.map((id: string, i: number) => [
          id,
          { x: 40 + i * 340, y: 100, width: 280, height: 400 },
        ]),
      ),
      order: active.canvas.windows,
    };
    localStorage.setItem(key, JSON.stringify(saved));
  });
  await page.reload();
  const canvas = async () => {
    const data = await saved(page);
    return data.items.find((w: { id: string }) => w.id === data.active).canvas;
  };
  const before = await canvas();
  await planner(page, "move_window", {
    window: "group:0,1",
    placement: "nudge_right",
  });
  await command(page, "move music and weather to the right");
  await expect
    .poll(async () => (await canvas()).freeform.frames["widget:music"].x)
    .toBeGreaterThan(before.freeform.frames["widget:music"].x);
  const first = await canvas();
  const contexts: Array<{ targets?: string[] }> = [];
  page.on("request", (request) => {
    if (request.url().endsWith("/__pulse/intent")) {
      const input = request.postDataJSON();
      contexts.push(JSON.parse(input.context).recentCommand ?? {});
    }
  });
  await command(page, "move them more");
  await expect
    .poll(async () => (await canvas()).freeform.frames["widget:music"].x)
    .toBeGreaterThan(first.freeform.frames["widget:music"].x);
  const second = await canvas();
  expect(second.freeform.frames["widget:inbox"]).toEqual(
    before.freeform.frames["widget:inbox"],
  );
  expect(
    contexts.some(
      (ctx) =>
        JSON.stringify(ctx.targets) ===
        JSON.stringify(["widget:music", "widget:weather"]),
    ),
  ).toBe(true);
  await planner(page, "open_windows", {
    count: "1",
    target_1: "app:projects",
    layout: "custom",
    area_1: "left",
  });
  await command(page, "projects on the left");
  await expect(page.locator('[data-content-id="app:projects"]')).toBeVisible();
  expect((await canvas()).freeform.frames["app:projects"].x).toBe(0);
  const initialWidth = (await canvas()).freeform.frames["app:projects"].width;
  await planner(page, "resize_window", {
    window: "app:projects",
    size: "bigger",
  });
  await command(page, "make it bigger");
  await expect
    .poll(async () => (await canvas()).freeform.frames["app:projects"].width)
    .toBeGreaterThan(initialWidth);
  expect(contexts.at(-1)?.targets).toEqual(["app:projects"]);
  await page.getByRole("tab", { name: "Home", exact: true }).click();
  await planner(page, "move_window", {
    window: "unavailable",
    placement: "unavailable",
  });
  await command(page, "move them more");
  await expect(box(page).getByRole("alert")).toBeVisible();
  expect(contexts.at(-1)?.targets).toBeUndefined();
});
