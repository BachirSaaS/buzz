import type { Channel, UserProfileSummary } from "@/shared/api/types";
import type { Project } from "@/features/projects/projectModels";
import { buildDirectMessageIntro } from "@/features/channels/lib/dmParticipantDisplay";
import type { CanvasView } from "./canvasLayout";
import { hasTypoTolerantPrefixMatch } from "@/shared/lib/fuzzyText";

/** Searchable metadata for an existing, available canvas destination. */
export type WindowCatalogEntry = CanvasView & {
  aliases: string[];
  description: string;
};
const normalize = (text: string) =>
  text
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
/** A metadata-only catalog shared by manual search and workspace planning. */
export function buildWindowCatalog({
  channels,
  profiles,
  currentPubkey,
  projects,
  widgets,
  projectsEnabled,
  workflowsEnabled,
}: {
  channels: Channel[];
  profiles: Record<string, UserProfileSummary>;
  currentPubkey?: string;
  projects: Project[];
  widgets: readonly { id: string; title: string }[];
  projectsEnabled: boolean;
  workflowsEnabled: boolean;
}): WindowCatalogEntry[] {
  const entries: WindowCatalogEntry[] = [
    {
      id: "app:messages",
      kind: "app",
      title: "Messages",
      target: "conversation",
      aliases: [
        "messages",
        "inbox",
        "chat",
        "channels",
        "conversations",
        "direct messages",
      ],
      description: "Full Messages app with channel and DM sidebar.",
    },
    ...(projectsEnabled
      ? [
          {
            id: "app:projects",
            kind: "app" as const,
            title: "Projects",
            target: "projects",
            initialRoute: { feed: "projects", projectSection: "projects" },
            aliases: ["my projects", "project list", "list of projects"],
            description: "Full Projects app showing all your projects.",
          },
        ]
      : []),
    {
      id: "app:agents",
      kind: "app",
      title: "Agents",
      target: "agents",
      aliases: ["agent directory", "bots"],
      description: "Full Agents app.",
    },
    ...(workflowsEnabled
      ? [
          {
            id: "app:workflows",
            kind: "app" as const,
            title: "Apps",
            target: "workflows",
            aliases: ["apps", "workflows", "automations"],
            description: "Full Apps and Workflows app.",
          },
        ]
      : []),
    {
      id: "app:search",
      kind: "app",
      title: "Search",
      target: "search",
      aliases: ["search buzz", "global search", "find messages", "people"],
      description: "Search Buzz message history, people, agents and channels.",
    },
    ...(projectsEnabled
      ? [
          ["repositories", "Repositories", "repos"],
          ["issues", "Issues", "tickets"],
          ["prs", "Pull requests", "reviews"],
          ["all", "Project activity", "project updates"],
          ["channels", "Project channels", "project conversations"],
        ].map(([section, title, alias]) => ({
          id: `app:project-${section}`,
          kind: "app" as const,
          title,
          target: "projects",
          initialRoute: { feed: "projects", projectSection: section },
          aliases: [alias, `my ${title.toLowerCase()}`],
          description: `Show the ${title.toLowerCase()} list across projects.`,
        }))
      : []),
    {
      id: "app:agent-directory",
      kind: "app",
      title: "Browse agents",
      target: "agents",
      initialRoute: { feed: "agents", agentSection: "browse" },
      aliases: ["agent catalog", "available agents", "agent templates"],
      description: "Browse available agent personas and templates.",
    },
    ...(workflowsEnabled
      ? [
          {
            id: "app:new-workflow",
            kind: "app" as const,
            title: "New workflow",
            target: "workflows",
            initialRoute: {
              feed: "workflows",
              view: "create",
              pane: "trigger",
            },
            aliases: [
              "create a workflow",
              "new automation",
              "create an automation",
            ],
            description:
              "Open the workflow creation form; nothing is published or run.",
          },
        ]
      : []),
    {
      id: "agents",
      kind: "agents",
      title: "Agent activity",
      aliases: ["agent conversations"],
      description: "Recent agent conversations.",
    },
    ...[
      { id: "all", title: "All widgets" },
      { id: "buzz", title: "Buzz widgets" },
      ...widgets,
    ].map((widget) => ({
      id: `widget:${widget.id}`,
      kind: "widget" as const,
      title: widget.title,
      target: widget.id,
      aliases: [
        widget.id.replaceAll("-", " "),
        ...(widget.id === "weather" ? ["forecast", "temperature"] : []),
      ],
      description:
        widget.id === "all" || widget.id === "buzz"
          ? "A collection of widgets."
          : `The ${widget.title} widget.`,
    })),
  ];
  for (const channel of channels.filter((c) => c.isMember && !c.archivedAt)) {
    const dm = channel.channelType === "dm";
    const intro = buildDirectMessageIntro({ channel, currentPubkey, profiles });
    const people = channel.participantPubkeys.filter(
      (key) => key.toLowerCase() !== currentPubkey?.toLowerCase(),
    );
    entries.push({
      id: `${dm ? "dm" : "channel"}:${channel.id}`,
      kind: dm ? "dm" : "channel",
      title: dm ? intro?.displayName || channel.name : `#${channel.name}`,
      target: channel.id,
      aliases: [
        ...new Set([
          channel.name,
          ...(dm
            ? people
                .flatMap((key) => {
                  const profile = profiles[key.toLowerCase()];
                  return [
                    profile?.name,
                    profile?.displayName,
                    profile?.nip05Handle,
                  ];
                })
                .filter((name): name is string => Boolean(name))
            : []),
        ]),
      ],
      description: dm
        ? `Existing ${people.length > 1 ? "group" : "one-to-one"} direct message.`
        : "An existing channel you belong to.",
    });
  }
  if (projectsEnabled)
    for (const project of projects)
      entries.push({
        id: `project:${project.id}`,
        kind: "project",
        title: project.name,
        target: project.id,
        aliases: project.repositories.map((repo) => repo.name),
        description: `Open the ${project.name} project.`,
      });
  return entries;
}
/** Search names and username aliases locally; model requests receive at most 80 candidates. */
export function searchWindowCatalog(
  entries: WindowCatalogEntry[],
  query: string,
  limit = 80,
) {
  const normalizedQuery = normalize(query);
  const tokens = normalizedQuery.split(" ").filter((token) => token.length > 1);
  const score = (entry: WindowCatalogEntry) => {
    const names = [entry.title, ...entry.aliases].map(normalize);
    const words = new Set(names.flatMap((name) => name.split(" ")));
    const phraseMatch = names.some(
      (name) => name && ` ${normalizedQuery} `.includes(` ${name} `),
    );
    const scoreToken = (token: string) => {
      if (names.includes(token)) return 20;
      if (words.has(token)) return 8;
      if (
        names.some(
          (name) =>
            name.includes(token) || name.replaceAll(" ", "").includes(token),
        )
      )
        return 2;
      if (
        token.length <= 80 &&
        names.some((name) =>
          hasTypoTolerantPrefixMatch(name.slice(0, 240), token),
        )
      )
        return 1;
      return 0;
    };
    return tokens.reduce(
      (sum, token) => sum + scoreToken(token),
      phraseMatch ? 40 : 0,
    );
  };
  return entries
    .map((entry, index) => ({ entry, index, score: score(entry) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, limit)
    .map((item) => item.entry);
}
