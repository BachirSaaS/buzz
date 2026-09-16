import { expect, test, type Page } from "@playwright/test";
import type { AgentSecurityPolicy } from "../../src/shared/api/types";
import type { SecurityDefaults } from "../../src/shared/api/tauriSecurityDefaults";
import { installMockBridge, TEST_IDENTITIES } from "../helpers/bridge";
import { openSettings } from "../helpers/settings";

const POLICY: AgentSecurityPolicy = {
  schema_version: 1,
  writable_roots: ["/Users/demo/Projects"],
  denied_reads: ["/Users/demo/Private"],
  denied_writes: [],
  network: { mode: "allowlist", destinations: ["api.example.com"] },
  environment: [],
};

type SecurityTestState = {
  defaults: SecurityDefaults;
  policy: AgentSecurityPolicy | null;
  defaultWrites: SecurityDefaults[];
  agentWrites: { input: { securityPolicy: AgentSecurityPolicy | null } }[];
  failDefault: boolean;
  failAgent: boolean;
};

declare global {
  interface Window {
    securityTest: SecurityTestState;
  }
}

// These tests exercise real React dialogs and IPC payloads. The mock models
// atomic native persistence, not kernel enforcement (covered by native tests).
async function setup(page: Page, enabled = true) {
  page.on("pageerror", (error) => console.error(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") console.error(message.text());
  });
  await installMockBridge(page, {
    managedAgents: [
      {
        pubkey: TEST_IDENTITIES.tyler.pubkey,
        name: "Security Agent",
        personaId: "security-persona",
        runtime: "buzz-agent",
        status: "stopped",
        channelNames: ["agents"],
      },
    ],
    personas: [
      {
        id: "security-persona",
        displayName: "Security Persona",
        systemPrompt: "Test agent",
        runtime: "buzz-agent",
      },
    ],
    acpRuntimesCatalog: [
      {
        id: "buzz-agent",
        label: "Buzz Agent",
        command: "buzz-agent",
        binary_path: "/Applications/Buzz.app/Contents/MacOS/buzz-agent",
        install_hint: "Included with Buzz",
        install_instructions_url: "",
        can_auto_install: false,
        requires_external_cli: false,
        underlying_cli_path: null,
        node_required: false,
        source: "builtin",
        availability: "available",
        default_args: [],
        avatar_url: "",
        mcp_command: "buzz-dev-mcp",
        supports_sandpit: true,
        provider_env_var: "BUZZ_AGENT_PROVIDER",
        model_env_var: "BUZZ_AGENT_MODEL",
        auth_status: { status: "not_applicable" },
      },
    ],
  });
  await page.goto("/");
  await page.waitForFunction(() => {
    const target = window as unknown as {
      __TAURI_INTERNALS__?: { invoke?: unknown };
    };
    return typeof target.__TAURI_INTERNALS__?.invoke === "function";
  });
  await page.evaluate(
    ({ enabled, policy, pubkey }) => {
      const target = window as unknown as {
        __TAURI_INTERNALS__: {
          invoke: (
            command: string,
            args?: Record<string, unknown>,
          ) => Promise<unknown>;
        };
      };
      const invoke = target.__TAURI_INTERNALS__.invoke;
      window.securityTest = {
        defaults: { experimental_enabled: enabled, policy },
        policy: null,
        defaultWrites: [],
        agentWrites: [],
        failDefault: false,
        failAgent: false,
      };
      target.__TAURI_INTERNALS__.invoke = async (command, args) => {
        const state = window.securityTest;
        if (command === "get_agent_security_connections")
          return ["relay.example.com", "model.example.com"];
        if (command === "get_agent_security_defaults")
          return structuredClone(state.defaults);
        if (command === "set_agent_security_defaults") {
          if (state.failDefault)
            throw new Error("Security settings could not be saved");
          state.defaults = structuredClone(args?.settings as SecurityDefaults);
          state.defaultWrites.push(structuredClone(state.defaults));
          return structuredClone(state.defaults);
        }
        if (command === "update_managed_agent") {
          if (state.failAgent)
            throw new Error("Agent security could not be saved");
          const update = args as SecurityTestState["agentWrites"][number];
          state.agentWrites.push(structuredClone(update));
          state.policy = structuredClone(update.input.securityPolicy);
          const response = (await invoke(command, args)) as {
            agent: Record<string, unknown>;
          };
          response.agent.security_policy = state.policy;
          return response;
        }
        const response = await invoke(command, args);
        if (command === "list_managed_agents") {
          for (const agent of response as Record<string, unknown>[]) {
            if (agent.pubkey === pubkey) agent.security_policy = state.policy;
          }
        }
        return response;
      };
    },
    { enabled, policy: POLICY, pubkey: TEST_IDENTITIES.tyler.pubkey },
  );
}

async function openRuntime(page: Page) {
  await page.getByTestId("open-agents-view").click();
  await page
    .getByRole("button", { name: "Security Persona agent profile" })
    .click();
  await page.getByRole("tab", { name: "Runtime", exact: true }).click();
}

async function closeProfile(page: Page) {
  await page.keyboard.press("Escape");
}

test("experiment gates setup; failed toggle preserves saved state and policy", async ({
  page,
}) => {
  await setup(page, false);
  await openRuntime(page);
  await expect(
    page.getByRole("button", { name: "Edit security", exact: true }),
  ).toHaveCount(0);
  await closeProfile(page);
  await openSettings(page, "agents");
  await expect(page.getByTestId("security-defaults-card")).toHaveCount(0);
  await page.getByTestId("settings-nav-experimental").click();
  const toggle = page.getByTestId("feature-toggle-agentSecurity");
  await expect(toggle).not.toBeChecked();
  await page.evaluate(() => {
    window.securityTest.failDefault = true;
  });
  await toggle.click();
  await expect(page.getByRole("alert")).toContainText(
    "Couldn’t save this setting",
  );
  await expect(toggle).not.toBeChecked();
  expect(await page.evaluate(() => window.securityTest.defaultWrites)).toEqual(
    [],
  );
  await page.evaluate(() => {
    window.securityTest.failDefault = false;
  });
  await toggle.click();
  await expect(toggle).toBeChecked();
  await page.getByTestId("settings-nav-agents").click();
  await expect(page.getByTestId("security-defaults-card")).toBeVisible();
  await page.getByTestId("settings-nav-experimental").click();
  await toggle.click();
  await expect(toggle).not.toBeChecked();
  expect(await page.evaluate(() => window.securityTest.defaults)).toEqual({
    experimental_enabled: false,
    policy: POLICY,
  });
  expect(
    await page.evaluate(() => window.securityTest.defaultWrites),
  ).toHaveLength(2);
});

test("default save and agent customization are independent atomic drafts", async ({
  page,
}) => {
  await setup(page);
  await openSettings(page, "agents");
  await page.getByRole("button", { name: "Edit default", exact: true }).click();
  const dialog = page.getByTestId("agent-security-dialog");
  await dialog
    .getByLabel("Folders the agent can change 1", { exact: true })
    .fill("/Users/demo/Shared");
  await page.evaluate(() => {
    window.securityTest.failDefault = true;
  });
  await dialog
    .getByRole("button", { name: "Save changes", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toContainText("could not be saved");
  await expect(
    dialog.getByLabel("Folders the agent can change 1", { exact: true }),
  ).toHaveValue("/Users/demo/Shared");
  expect(
    await page.evaluate(() => window.securityTest.defaults.policy),
  ).toEqual(POLICY);
  await page.evaluate(() => {
    window.securityTest.failDefault = false;
  });
  await dialog
    .getByRole("button", { name: "Save changes", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  const savedDefault = {
    ...POLICY,
    writable_roots: ["/Users/demo/Shared"],
    network: {
      mode: "allowlist",
      destinations: [
        "api.example.com",
        "relay.example.com",
        "model.example.com",
      ],
    },
  };
  expect(await page.evaluate(() => window.securityTest.defaultWrites)).toEqual([
    { experimental_enabled: true, policy: savedDefault },
  ]);
  expect(await page.evaluate(() => window.securityTest.agentWrites)).toEqual(
    [],
  );
  await page.getByTestId("settings-back-to-app").click();
  await openRuntime(page);
  await page
    .getByRole("button", { name: "Edit security", exact: true })
    .click();
  await expect(page.getByTestId("persona-dialog")).not.toBeVisible();
  await expect(page.getByTestId("edit-agent-dialog")).not.toBeVisible();
  await expect(dialog.getByLabel("Enable protection")).not.toBeChecked();
  await dialog.getByRole("button", { name: "Use current default" }).click();
  await expect(
    dialog.getByRole("region", { name: "Required connections" }),
  ).toContainText("relay.example.com");
  await expect(
    dialog.getByLabel("Folders the agent can change 1", { exact: true }),
  ).toHaveValue("/Users/demo/Shared");
  await dialog
    .getByLabel("Folders the agent can change 1", { exact: true })
    .fill("/Users/demo/Cancelled");
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  expect(await page.evaluate(() => window.securityTest.agentWrites)).toEqual(
    [],
  );
  await page
    .getByRole("button", { name: "Edit security", exact: true })
    .click();
  await expect(dialog.getByLabel("Enable protection")).not.toBeChecked();
  await dialog.getByRole("button", { name: "Use current default" }).click();
  await expect(
    dialog.getByRole("region", { name: "Required connections" }),
  ).toContainText("relay.example.com");
  await dialog
    .getByLabel("Folders the agent can change 1", { exact: true })
    .fill("/Users/demo/AgentOnly");
  await page.evaluate(() => {
    window.securityTest.failAgent = true;
  });
  await dialog
    .getByRole("button", { name: "Save changes", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toContainText("could not be saved");
  expect(await page.evaluate(() => window.securityTest.policy)).toBeNull();
  await page.evaluate(() => {
    window.securityTest.failAgent = false;
  });
  await dialog
    .getByRole("button", { name: "Save changes", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  const writes = await page.evaluate(() => window.securityTest.agentWrites);
  expect(writes).toHaveLength(1);
  expect(writes[0].input.securityPolicy).toEqual({
    ...savedDefault,
    writable_roots: ["/Users/demo/AgentOnly"],
  });
  expect(
    await page.evaluate(() => window.securityTest.defaults.policy),
  ).toEqual(savedDefault);
});

test("empty protection cannot save and keyboard adds editable rule rows", async ({
  page,
}) => {
  await setup(page);
  await openRuntime(page);
  await page
    .getByRole("button", { name: "Edit security", exact: true })
    .click();
  const dialog = page.getByTestId("agent-security-dialog");
  await dialog.getByLabel("Enable protection").check();
  await expect(
    dialog.getByRole("button", { name: "Save changes", exact: true }),
  ).toBeDisabled();
  await dialog.getByRole("button", { name: "Add folder", exact: true }).click();
  const first = dialog.getByLabel("Folders the agent can change 1", {
    exact: true,
  });
  await first.fill("/Users/demo/One");
  await first.press("Enter");
  const second = dialog.getByLabel("Folders the agent can change 2", {
    exact: true,
  });
  await expect(second).toBeFocused();
  await second.fill("/Users/demo/Two");
  await dialog
    .getByRole("combobox", { name: "Internet access", exact: true })
    .selectOption("allowlist");
  const required = dialog.getByRole("region", { name: "Required connections" });
  await expect(required).toContainText("relay.example.com");
  await expect(required).toContainText("model.example.com");
  await expect(required.getByText("Required", { exact: true })).toHaveCount(2);
  await expect(required.getByRole("textbox")).toHaveCount(0);
  await expect(required.getByRole("button")).toHaveCount(0);
  await dialog.getByRole("button", { name: "Add domain", exact: true }).click();
  await dialog
    .getByLabel("Additional allowed domains 1", { exact: true })
    .fill("custom.example.com");
  await dialog
    .getByRole("combobox", { name: "Internet access", exact: true })
    .selectOption("deny_all");
  await dialog
    .getByRole("combobox", { name: "Internet access", exact: true })
    .selectOption("allowlist");
  await expect(
    dialog.getByLabel("Additional allowed domains 1", { exact: true }),
  ).toHaveValue("custom.example.com");
  await dialog
    .getByRole("button", {
      name: "Remove additional allowed domains 1",
      exact: true,
    })
    .click();
  await expect(required).toContainText("relay.example.com");
  await expect(
    dialog.getByRole("button", { name: "Save changes", exact: true }),
  ).toBeEnabled();
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  expect(await page.evaluate(() => window.securityTest.agentWrites)).toEqual(
    [],
  );
});

for (const theme of ["light", "dark"] as const) {
  for (const width of [1200, 560]) {
    test(`security editor screenshot ${theme} ${width}px`, async ({
      page,
    }, testInfo) => {
      await page.setViewportSize({ width: 1200, height: 850 });
      await page.addInitScript((theme) => {
        localStorage.setItem(
          "buzz-theme",
          theme === "dark" ? "buzz-dark" : "buzz",
        );
      }, theme);
      await setup(page);
      await openSettings(page, "agents");
      await page
        .getByRole("button", { name: "Edit default", exact: true })
        .click();
      const dialog = page.getByTestId("agent-security-dialog");
      await expect(
        dialog.getByLabel("Folders the agent can change 1", { exact: true }),
      ).toBeVisible();
      await page.setViewportSize({ width, height: 850 });
      await expect(page.locator("html")).toHaveClass(new RegExp(theme));
      await expect(dialog).toBeVisible();
      const bounds = await dialog.boundingBox();
      expect(bounds?.width).toBeLessThanOrEqual(width);
      expect(
        await dialog.evaluate((node) => node.scrollWidth <= node.clientWidth),
      ).toBe(true);
      await page.screenshot({
        path: testInfo.outputPath(`security-${theme}-${width}.png`),
        animations: "disabled",
      });
    });
  }
}
