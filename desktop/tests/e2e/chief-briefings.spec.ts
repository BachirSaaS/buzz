import { expect, test, type Page } from "@playwright/test";
import { installMockBridge, TEST_IDENTITIES } from "../helpers/bridge";
import { waitForAnimations } from "../helpers/animations";

const sourceId = "a".repeat(64);
const secondId = "b".repeat(64);
const unknownId = "c".repeat(64);
const unrelatedId = "d".repeat(64);
const channel = "9a1657ac-f7aa-5db0-b632-d8bbeb6dfb50";
async function mockChief(page: Page, saved = 0) {
  const calls: {
    path: string;
    method: string;
    body: Record<string, unknown>;
  }[] = [];
  let fold: Record<string, unknown> | null = saved
    ? {
        name: "weekly",
        spec: {
          selection: {
            channels: [channel],
            kinds: [9],
            since: 1788739200,
            until_exclusive: 1789344000,
          },
          model: "test-model",
          instructions: "Summarize decisions",
          meta: { title: "Weekly decisions" },
        },
      }
    : null;
  let version = saved ? 2 : 0;
  let runFailure = false;
  let offline = false;
  let unpublished = false;
  const event = {
    id: sourceId,
    channel,
    thread_root: sourceId,
    parent: null,
    pubkey: TEST_IDENTITIES.alice.pubkey,
    author_name: "Alice",
    created_at: 1789000000,
    content: "We agreed to ship the new UI on Friday. Alice owns the rollout.",
    kind: 9,
  };
  await page.route("**/__pulse/briefing", (route) =>
    route.fulfill({ json: { highlights: [] } }),
  );
  await page.route("**/__chief", async (route) => {
    const input = route.request().postDataJSON();
    calls.push(input);
    let data: unknown;
    if (offline)
      return route.fulfill({
        status: 503,
        json: {
          error:
            "Local briefings are unavailable. Start the Accumulator and retry.",
        },
      });
    if (input.path === "/status")
      data = {
        ...input.scope,
        connection: "connected",
        backfill_complete: true,
        total_events: 2471,
      };
    else if (input.path === "/channels")
      data = {
        channels: [
          { id: channel, name: "general", active: true, excluded: false },
        ],
      };
    else if (input.path === "/models")
      data = { models: [{ id: "test-model", name: "Test model" }] };
    else if (input.path === "/folds")
      data = {
        folds: fold
          ? Array.from({ length: Math.max(1, saved) }, (_, i) => ({
              ...fold,
              name: i ? `weekly-${i}` : fold.name,
              latest_version: version || null,
              last_error: null,
            }))
          : [],
      };
    else if (input.path === "/select/events")
      data = { count: 2, events: [event] };
    else if (input.path.startsWith("/events/")) {
      const id = input.path.split("/").pop();
      data = {
        ...event,
        id,
        pubkey: id === secondId ? TEST_IDENTITIES.bob.pubkey : event.pubkey,
        author_name: id === secondId ? "Bob" : event.author_name,
        thread_root: id,
        content:
          id === unrelatedId
            ? "An unrelated joke."
            : id === secondId
              ? "Bob will review the release on Thursday."
              : event.content,
      };
    } else if (input.method === "PUT") {
      fold = { name: input.path.split("/")[2], spec: input.body };
      data = { saved: fold };
    } else if (input.path.endsWith("/preflight"))
      data = {
        plan: version >= 2 ? "cached" : "ready",
        coverage: {
          processed: version,
          pending: 2 - version,
          complete: version >= 2,
        },
        shown: 1,
        estimate: { est_input_tokens: 812 },
        model_input:
          "Instructions plus frozen source message: Alice owns the rollout.",
      };
    else if (input.path.endsWith("/run")) {
      if (unpublished)
        return route.fulfill({
          json: {
            status: "unpublished",
            reason: "version fence",
            model_output: "Paid result retained for recovery.",
          },
        });
      if (runFailure)
        return route.fulfill({
          status: 500,
          json: { error: "Model runtime is not signed in." },
        });
      version++;
      data = { status: "folded" };
    } else if (input.path.endsWith("/artifacts"))
      data = {
        artifacts: Array.from({ length: version }, (_, i) => ({
          version: i + 1,
          created_at: 1789000010 + i,
        })),
      };
    else if (/\/artifacts\/\d+$/.test(input.path))
      data = {
        fold: "weekly",
        version: Number(input.path.split("/").pop()),
        output: `- Version ${input.path.split("/").pop()}: Alice will ship the UI on Friday. The rollout owner is confirmed; timing remains tentative. [event:${sourceId}]

- Bob will review the release. [event:${secondId}]

- A claim with a missing source. [event:${unknownId}]`,
        shown_ids: input.path.endsWith("/1")
          ? [unrelatedId, sourceId]
          : [unrelatedId, sourceId, secondId],
        channels: [channel],
        model: "test-model",
        created_at: 1789000010,
      };
    else throw new Error(`Unhandled Chief request ${input.path}`);
    return route.fulfill({ json: data });
  });
  return {
    calls,
    setUnpublished: () => {
      unpublished = true;
    },
    setOffline: (value: boolean) => {
      offline = value;
    },
    setRunFailure: (value: boolean) => {
      runFailure = value;
    },
  };
}
async function openHome(page: Page) {
  await installMockBridge(page);
  await page.goto("/#/pulse");
}
async function createBriefing(page: Page) {
  await page.getByRole("button", { name: "New briefing", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Channel", { exact: true }).selectOption(channel);
  await dialog.getByLabel("Model", { exact: true }).selectOption("test-model");
  await expect(
    dialog.getByText("Inspect selection · 2 messages"),
  ).toBeVisible();
  await dialog.getByText("Inspect selection · 2 messages").click();
  await expect(dialog.getByText(/Alice owns the rollout/)).toBeVisible();
  await dialog.getByRole("button", { name: "Save and preflight" }).click();
  await expect(
    page.getByRole("button", { name: "Run next pass" }),
  ).toBeVisible();
}
test("saved briefings preview without spending, run incrementally, show the latest result and expose real sources", async ({
  page,
}) => {
  const mock = await mockChief(page);
  await openHome(page);
  await createBriefing(page);
  expect(mock.calls.filter((c) => c.path.endsWith("/run"))).toHaveLength(0);
  expect(
    mock.calls.find((c) => c.method === "PUT")?.body.selection,
  ).toMatchObject({ channels: [channel], kinds: [9] });
  await page.getByRole("button", { name: "Run next pass" }).click();
  const cards = page.getByTestId("chief-takeaway");
  await expect(cards).toHaveCount(3);
  await expect(cards.first()).toContainText("Version 1:");
  await expect(cards.first().getByTestId("home-context-preview")).toContainText(
    "Alice owns the rollout",
  );
  await expect(
    cards
      .nth(1)
      .getByRole("button", { name: "Open conversation", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByText("1 messages processed · 1 pending"),
  ).toBeVisible();
  await page.getByRole("button", { name: "Run next pass" }).click();
  await expect(page.getByRole("button", { name: "Run next pass" })).toHaveCount(
    0,
  );
  await expect(cards.first()).toContainText("Version 2:");
  await expect(cards.nth(1).getByTestId("home-context-preview")).toContainText(
    "Bob will review",
  );
  await expect(page.getByTestId("chief-details")).toHaveCount(0);
  await cards.first().scrollIntoViewIfNeeded();
  await waitForAnimations(page);
  await page.screenshot({ path: "test-results/chief-briefings/saved.png" });
  await page.reload();
  await expect(cards.first()).toContainText("Version 2:");
  expect(mock.calls.filter((c) => c.path.endsWith("/run"))).toHaveLength(2);
});
test("offline daemon remains recoverable and failed runs never become successful empty briefings", async ({
  page,
}) => {
  const mock = await mockChief(page);
  mock.setOffline(true);
  await openHome(page);
  await expect(
    page.getByRole("alert").filter({ hasText: "Local briefings" }),
  ).toContainText("Local briefings are unavailable");
  await expect(
    page.getByTestId("pulse-briefing-highlight").first(),
  ).toBeVisible();
  mock.setOffline(false);
  await page.getByRole("button", { name: "Reconnect" }).click();
  await createBriefing(page);
  mock.setRunFailure(true);
  await page.getByRole("button", { name: "Run next pass" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Model runtime is not signed in",
  );
  await expect(
    page.getByText("0 messages processed · 2 pending"),
  ).toBeVisible();
  expect(mock.calls.filter((c) => c.path.endsWith("/run"))).toHaveLength(1);
  await waitForAnimations(page);
  await page.screenshot({ path: "test-results/chief-briefings/failure.png" });
});

test("a paid result rejected by the version fence survives reload as a recovery record", async ({
  page,
}) => {
  const mock = await mockChief(page);
  await openHome(page);
  await createBriefing(page);
  mock.setUnpublished();
  await page.getByRole("button", { name: "Run next pass" }).click();
  await expect(
    page.getByText("Paid result retained for recovery."),
  ).toBeVisible();
  await page.reload();
  await expect(page.getByTestId("pulse-briefing")).toBeVisible();
  await expect(
    page.getByText("Paid result retained for recovery."),
  ).toBeVisible();
  expect(mock.calls.filter((c) => c.path.endsWith("/run"))).toHaveLength(1);
});

test("Home renders each saved takeaway with shared avatars, previews and actions bound to its own message", async ({
  page,
}) => {
  const mock = await mockChief(page, 2);
  await openHome(page);
  const home = page.getByTestId("pulse-home");
  const briefings = home.getByTestId("chief-briefing");
  await expect(briefings).toHaveCount(2);
  const cards = briefings.first().getByTestId("chief-takeaway");
  await expect(cards).toHaveCount(3);
  await expect(cards.first().getByTestId("home-participants")).toBeVisible();
  await expect(
    cards
      .first()
      .getByTestId("home-participants")
      .getByRole("button", { name: /Open profile for alice/i }),
  ).toBeVisible();
  await expect(
    cards
      .nth(1)
      .getByTestId("home-participants")
      .getByRole("button", { name: /Open profile for bob/i }),
  ).toBeVisible();
  await expect(
    cards.first().locator(`[data-evidence-message-id="${sourceId}"]`),
  ).toBeVisible();
  await expect(
    cards.nth(1).locator(`[data-evidence-message-id="${secondId}"]`),
  ).toBeVisible();
  await expect(cards.first()).not.toContainText("Bob will review");
  await expect(cards.nth(1)).not.toContainText("Alice owns the rollout");
  await expect(cards.nth(2).getByTestId("home-participants")).toHaveCount(0);
  await expect(
    cards
      .nth(2)
      .getByRole("button", { name: "Open conversation", exact: true }),
  ).toBeDisabled();
  await expect(
    cards.first().getByRole("button", { name: "Snooze", exact: true }),
  ).toHaveAttribute("aria-disabled", "true");
  await expect(
    cards.first().getByRole("button", { name: "Reply directly", exact: true }),
  ).toHaveAttribute("aria-disabled", "true");
  await expect(
    cards.first().getByTestId("home-activity-summary"),
  ).not.toContainText("[event:");
  await expect(
    home.getByTestId("pulse-briefing-highlight").first(),
  ).toBeAttached();
  await expect(home.getByText(/Explore messages/)).toHaveCount(0);
  expect(
    mock.calls.some(
      (c) =>
        c.path === `/events/${unknownId}` ||
        c.path === `/events/${unrelatedId}`,
    ),
  ).toBe(false);
  await expect(home.getByTestId("chief-details")).toHaveCount(0);
  const open = cards
    .nth(1)
    .getByRole("button", { name: "Open conversation", exact: true });
  await open.focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL((url) => {
    const params = new URLSearchParams(url.hash.split("?")[1]);
    return (
      params.get("conversation") === channel &&
      params.get("messageId") === secondId
    );
  });
  await expect(page.getByTestId("message-input")).toBeVisible();
  await page
    .getByTestId("pulse-app-navigation")
    .getByRole("button", { name: "Home", exact: true })
    .click();
  await expect(briefings).toHaveCount(2);
  expect(mock.calls.filter((c) => c.path.endsWith("/run"))).toHaveLength(0);
  await page.goto("/#/pulse?briefings=saved");
  await expect(home.getByTestId("chief-takeaway")).toHaveCount(6);
  await expect(home.getByTestId("pulse-briefing")).toBeAttached();
});
