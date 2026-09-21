import type { SettingsSection } from "@/features/settings/ui/SettingsPanels";
import type { CommandContext, InterfacePlan } from "./plan";

/** Destinations share the same validated plans as voice and typed commands. */
export type CommandEntry = {
  id: string;
  title: string;
  detail: string;
  aliases: string[];
  plan: InterfacePlan;
};
export const commandSettings = {
  profile: "Profile",
  appearance: "Appearance",
  notifications: "Notifications",
  voice: "Voice and audio",
  shortcuts: "Keyboard shortcuts",
  agents: "Agent settings",
  compute: "Compute",
  mobile: "Mobile pairing",
  updates: "Updates",
} satisfies Partial<Record<SettingsSection, string>>;

export function commandEntries(
  ctx: Pick<CommandContext, "catalog" | "workspaces">,
): CommandEntry[] {
  return [
    {
      id: "browse-channels",
      title: "Browse channels",
      detail: "Directory",
      aliases: ["channel directory", "join a channel"],
      plan: { action: "browse_channels" },
    },
    {
      id: "new-channel",
      title: "New channel",
      detail: "Open creation form",
      aliases: ["create a channel", "create channel"],
      plan: { action: "new_channel" },
    },
    {
      id: "new-agent",
      title: "New agent",
      detail: "Open creation form",
      aliases: ["create an agent", "create agent"],
      plan: { action: "new_agent" },
    },
    ...ctx.catalog.map((view) => ({
      id: view.id,
      title: view.title,
      detail: view.kind === "app" ? "App" : view.kind,
      aliases: view.aliases,
      plan: { action: "open_windows" as const, windowIds: [view.id] },
    })),
    ...ctx.workspaces.map((workspace) => ({
      id: `workspace:${workspace.id}`,
      title: workspace.name,
      detail: "Workspace",
      aliases: [`${workspace.name} workspace`],
      plan: { action: "switch_workspace" as const, workspace: workspace.id },
    })),
    {
      id: "settings",
      title: "Settings",
      detail: "Preferences",
      aliases: ["preferences", "buzz settings"],
      plan: { action: "open_settings" },
    },
    ...Object.entries(commandSettings).map(([section, title]) => ({
      id: `settings:${section}`,
      title,
      detail: "Settings",
      aliases: [
        `${title} settings`,
        ...(section === "appearance" ? ["theme", "themes"] : []),
      ],
      plan: { action: "open_settings" as const, section },
    })),
    {
      id: "new-message",
      title: "New message",
      detail: "Open an unsent draft",
      aliases: ["new dm", "new chat"],
      plan: { action: "new_dm", recipients: [] },
    },
    {
      id: "new-workspace",
      title: "New workspace",
      detail: "Create an empty workspace",
      aliases: ["create a workspace"],
      plan: { action: "create_workspace", windowIds: [], layout: "columns" },
    },
  ];
}
const normalize = (text: string) =>
  text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
const destination = (request: string) =>
  normalize(request)
    .replace(/^(?:please |can you |could you |i want to |i need to )/, "")
    .replace(
      /^(?:show me |show |give me |open |browse |view |list |take me to |go to )/,
      "",
    )
    .replace(/^(?:a list of |the list of |all of |all |my |the )+/, "");

/** Exact destinations bypass model confidence; free-form layout and write requests do not. */
export function directCommand(
  request: string,
  entries: CommandEntry[],
): InterfacePlan | null {
  const query = destination(request);
  const exact = entries.filter((entry) =>
    [entry.title, ...entry.aliases].some(
      (name) => normalize(name) === normalize(request),
    ),
  );
  const matches = exact.length
    ? exact
    : entries.filter((entry) =>
        [entry.title, ...entry.aliases].some(
          (name) => normalize(name).replace(/^(?:my |the )/, "") === query,
        ),
      );
  // App lists and a same-named starter workspace are different: show the list.
  const views = matches.filter(
    (entry) => entry.plan.action !== "switch_workspace",
  );
  const unique = views.length ? views : matches;
  if (unique.length === 1) return unique[0].plan;
  const search = request
    .trim()
    .match(
      /^(?:please\s+)?(?:search(?:\s+buzz)?(?:\s+for)?|find(?:\s+messages(?:\s+about)?)?|look\s+up)\s+(.+)$/i,
    );
  return search ? { action: "search_messages", text: search[1].trim() } : null;
}
/** Bounded local discovery; typing never sends model requests. */
export function searchCommandEntries(
  entries: CommandEntry[],
  request: string,
): CommandEntry[] {
  const query = destination(request);
  if (!query) return [];
  const tokens = query.split(" ");
  return entries
    .map((entry) => {
      const names = [entry.title, ...entry.aliases].map(normalize);
      const score = names.some((name) => destination(name) === query)
        ? 100
        : Math.max(
            ...names.map((name) =>
              tokens.every((token) => name.includes(token)) ? 20 : 0,
            ),
          );
      return { entry, score };
    })
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 6)
    .map(({ entry }) => entry);
}
