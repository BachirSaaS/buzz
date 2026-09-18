import type { Channel, UserProfileSummary } from "@/shared/api/types";
import type { Project } from "@/features/projects/projectModels";
import { buildDirectMessageIntro } from "@/features/channels/lib/dmParticipantDisplay";
import type { CanvasView } from "./canvasLayout";

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
      aliases: ["messages", "inbox", "chat"],
      description: "Full Messages app with channel and DM sidebar.",
    },
    ...(projectsEnabled
      ? [
          {
            id: "app:projects",
            kind: "app" as const,
            title: "Projects",
            target: "projects",
            aliases: [
              "my projects",
              "repositories",
              "repos",
              "issues",
              "reviews",
            ],
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
  const tokens = normalize(query)
    .split(" ")
    .filter((token) => token.length > 1);
  const score = (entry: WindowCatalogEntry) => {
    const names = [entry.title, ...entry.aliases].map(normalize);
    const words = new Set(names.flatMap((name) => name.split(" ")));
    return tokens.reduce(
      (sum, token) =>
        sum +
        (names.includes(token)
          ? 20
          : words.has(token)
            ? 8
            : names.some((name) => name.includes(token))
              ? 2
              : 0),
      0,
    );
  };
  return entries
    .map((entry, index) => ({ entry, index, score: score(entry) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, limit)
    .map((item) => item.entry);
}
