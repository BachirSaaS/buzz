import type { ReactNode } from "react";
import {
  House,
  Bot,
  Folders,
  Hash,
  MessageCircle,
  Zap,
  Plus,
  Search,
  Grid2X2,
} from "lucide-react";
import { useFeatureEnabled } from "@/shared/features";
import { cn } from "@/shared/lib/cn";
import { Action } from "@/shared/ui/action";
import { UserAvatar } from "@/shared/ui/UserAvatar";
import { useNavigationRecents } from "../lib/useNavigationRecents";
import { usePulseUnreadChannels, PulseUnreadDot } from "./PulseUnreadDot";
import { PulseAgentShortcuts } from "./PulseAgentShortcuts";
import type {
  PulseApp,
  PulseAppSelection,
  PulseNavigationDestination,
} from "./PulseAppNavigation";
export const tabs = {
  home: { label: "Home", icon: House },
  messages: { label: "Messages", icon: MessageCircle },
  projects: { label: "Projects", icon: Folders },
  agents: { label: "Agents", icon: Bot },
  apps: { label: "Apps", icon: Grid2X2 },
};
export type NavTab = keyof typeof tabs;

export function NavigationRow({
  children,
  icon,
  onClick,
  label,
  trailing,
  prominent = false,
}: {
  children: ReactNode;
  icon: ReactNode;
  onClick: () => void;
  label?: string;
  trailing?: ReactNode;
  prominent?: boolean;
}) {
  return (
    <Action
      aria-label={label}
      onClick={onClick}
      className={cn(
        "flex min-h-11 w-full items-center gap-3 rounded-xl px-2 py-2 text-left text-sm hover:bg-muted focus-visible:bg-muted",
        prominent && "font-semibold",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "flex size-7 shrink-0 items-center justify-center rounded-lg",
          prominent && "bg-primary text-primary-foreground",
        )}
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {trailing}
    </Action>
  );
}

/** Shared destinations keep the app bar and window switcher consistent. */
export function PulseNavigationDestinations({
  tab,
  onSelect,
  onClose: closeMenu,
}: {
  tab: NavTab;
  onSelect: PulseAppSelection;
  onClose: () => void;
}) {
  const projectsEnabled = useFeatureEnabled("projects");
  const workflowsEnabled = useFeatureEnabled("workflows");
  const data = useNavigationRecents(projectsEnabled);
  const unread = usePulseUnreadChannels();
  const select = (app: PulseApp, destination?: PulseNavigationDestination) => {
    if (onSelect(app, destination) !== false) closeMenu();
  };

  if (tab === "home")
    return (
      <p className="px-2 pb-2 pt-3 text-xs text-muted-foreground">
        Your briefings and a catch-up on what matters.
      </p>
    );
  if (tab === "agents")
    return (
      <PulseAgentShortcuts
        active={true}
        onSelect={onSelect}
        onClose={closeMenu}
      />
    );
  if (tab === "apps")
    return workflowsEnabled ? (
      <NavigationRow
        icon={<Zap className="size-4" />}
        onClick={() => select("workflows")}
      >
        Workflows
      </NavigationRow>
    ) : (
      <p className="p-2 text-xs text-muted-foreground">
        Enable Workflows in Settings to add apps.
      </p>
    );
  if (tab === "projects")
    return (
      <>
        <p className="px-2 pb-1 pt-3 text-2xs text-muted-foreground">
          {data.hasRecentProjects ? "Recently opened" : "Your projects"}
        </p>
        {data.projectsQuery.isPending && (
          <p role="status" className="p-2 text-xs text-muted-foreground">
            Loading projects…
          </p>
        )}
        {data.projectsQuery.isError && (
          <NavigationRow
            icon={<Folders className="size-4" />}
            onClick={() => void data.projectsQuery.refetch()}
          >
            Couldn’t load projects. Retry
          </NavigationRow>
        )}
        {data.projects.map((project) => (
          <NavigationRow
            key={project.id}
            label={`Open project ${project.name}`}
            icon={<Folders className="size-4" />}
            onClick={() => select("projects", { projectId: project.id })}
          >
            {project.name}
          </NavigationRow>
        ))}
        {data.projectsQuery.isSuccess && !data.projects.length && (
          <p className="p-2 text-xs text-muted-foreground">
            Your projects will appear here.
          </p>
        )}
      </>
    );
  return (
    <>
      <p className="px-2 pb-1 pt-3 text-2xs text-muted-foreground">
        Recent conversations
      </p>
      {data.channelsQuery.isPending && (
        <p role="status" className="p-2 text-xs text-muted-foreground">
          Loading conversations…
        </p>
      )}
      {data.channelsQuery.isError && (
        <NavigationRow
          icon={<MessageCircle className="size-4" />}
          onClick={() => void data.channelsQuery.refetch()}
        >
          Couldn’t load conversations. Retry
        </NavigationRow>
      )}
      {data.conversations.map(({ channel, name, person }) => (
        <NavigationRow
          key={channel.id}
          label={`Open ${channel.channelType === "dm" ? "DM with" : "channel"} ${name}`}
          icon={
            person ? (
              <UserAvatar
                avatarUrl={person.avatarUrl}
                displayName={name}
                size="sm"
                shape={person.isAgent ? "squircle" : "circle"}
              />
            ) : (
              <Hash className="size-4 text-muted-foreground" />
            )
          }
          trailing={
            unread(channel.id) ? (
              <>
                <span className="sr-only">Unread</span>
                <PulseUnreadDot />
              </>
            ) : undefined
          }
          onClick={() => select("messages", { conversation: channel.id })}
        >
          {name}
        </NavigationRow>
      ))}
      {data.channelsQuery.isSuccess && !data.conversations.length && (
        <p className="p-2 text-xs text-muted-foreground">
          No conversations yet.
        </p>
      )}
      <div className="mt-2 border-t border-border/50 pt-2">
        <NavigationRow
          icon={<Plus className="size-4" />}
          onClick={() => select("messages", { compose: "message" })}
        >
          New message
        </NavigationRow>
        <NavigationRow
          icon={<Search className="size-4" />}
          onClick={() => select("messages", { feed: "search" })}
        >
          Search messages
        </NavigationRow>
      </div>
    </>
  );
}
