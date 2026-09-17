import { AppTopChromePortal } from "@/app/AppTopChromePortal";
import { PulseAgentShortcuts } from "./PulseAgentShortcuts";
import type { ReactNode } from "react";
import { useNavigationPopovers } from "../lib/useNavigationPopovers";
import "./PulseAppNavigation.css";
import {
  ArrowRight,
  House,
  Bot,
  Folders,
  Hash,
  MessageCircle,
  Settings2,
  Zap,
  Plus,
  Search,
  Grid2X2,
} from "lucide-react";
import { useAppShell } from "@/app/AppShellContext";
import { useFeatureEnabled } from "@/shared/features";
import { cn } from "@/shared/lib/cn";
import { Action } from "@/shared/ui/action";
import { Popover, PopoverContent, PopoverTrigger } from "@/shared/ui/popover";
import { UserAvatar } from "@/shared/ui/UserAvatar";
import type { PulseWorkspacePage } from "../lib/workspaceNavigation";
import { useNavigationRecents } from "../lib/useNavigationRecents";
import { usePulseUnreadChannels, PulseUnreadDot } from "./PulseUnreadDot";

export type PulseApp = "home" | "messages" | PulseWorkspacePage;
export type PulseNavigationDestination = {
  conversation?: string;
  projectId?: string;
  compose?: "message";
  feed?: "search";
};
export type PulseAppSelection = (
  app: PulseApp,
  destination?: PulseNavigationDestination,
) => boolean | undefined;

const tabs = {
  home: { label: "Home", icon: House },
  messages: { label: "Messages", icon: MessageCircle },
  projects: { label: "Projects", icon: Folders },
  agents: { label: "Agents", icon: Bot },
  apps: { label: "Apps", icon: Grid2X2 },
};
type NavTab = keyof typeof tabs;

function NavigationRow({
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

/** Hover previews destinations; selection opens the main workspace. */
export function PulseAppNavigation({
  active,
  onSelect,
  onAddView,
  canAddView = true,
  viewControls,
}: {
  active: PulseApp | "settings";
  onSelect: PulseAppSelection;
  onAddView?: () => void;
  canAddView?: boolean;
  viewControls?: ReactNode;
}) {
  const { onOpenSettings } = useAppShell();
  const projectsEnabled = useFeatureEnabled("projects");
  const workflowsEnabled = useFeatureEnabled("workflows");
  const data = useNavigationRecents(projectsEnabled);
  const unread = usePulseUnreadChannels();
  const visibleTabs = (Object.keys(tabs) as NavTab[]).filter(
    (tab) => tab !== "projects" || projectsEnabled,
  );
  const menus = useNavigationPopovers<NavTab | "profile">([
    ...visibleTabs,
    "profile",
  ]);
  const { open } = menus;
  const closeMenu = () => menus.close(true);
  const selected = active === "workflows" ? "apps" : active;
  const select = (app: PulseApp, destination?: PulseNavigationDestination) => {
    if (onSelect(app, destination) !== false) closeMenu();
  };

  function destinations(tab: NavTab) {
    if (tab === "home")
      return (
        <p className="px-2 pb-2 pt-3 text-xs text-muted-foreground">
          Your briefings and a catch-up on what matters.
        </p>
      );
    if (tab === "agents")
      return (
        <PulseAgentShortcuts
          active={open === "agents"}
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

  return (
    <nav
      aria-label="Apps"
      data-testid="pulse-app-navigation"
      className="flex min-w-0 flex-1 items-center gap-3"
      data-tauri-drag-region
    >
      <div className="flex min-w-0 items-center gap-2 overflow-x-auto py-1">
        {visibleTabs.map((tab) => {
          const { label, icon: Icon } = tabs[tab];
          return (
            <Popover
              key={tab}
              open={open === tab}
              onOpenChange={(next) => menus.onOpenChange(tab, next)}
            >
              <PopoverTrigger asChild>
                <Action
                  {...menus.triggerProps(tab)}
                  aria-label={label}
                  aria-current={selected === tab ? "page" : undefined}
                  className={cn(
                    "pulse-navigation-trigger pulse-nav-tab flex h-[24px] shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-sm leading-none",
                    selected === tab
                      ? "bg-primary text-primary-foreground"
                      : "bg-background/50 text-foreground/70 hover:bg-background/80",
                    open === tab && "ring-1 ring-border",
                  )}
                >
                  <Icon aria-hidden className="size-3.5" />
                  {label}
                </Action>
              </PopoverTrigger>
              <PopoverContent
                {...menus.contentProps(tab)}
                aria-label={`${label} destinations`}
                align="start"
                sideOffset={10}
                className="pulse-navigation-popover w-72 p-3"
              >
                {tab !== "apps" && (
                  <NavigationRow
                    prominent
                    label={`Open ${label}`}
                    icon={<Icon className="size-4" />}
                    trailing={
                      <ArrowRight
                        aria-hidden
                        className="size-4 text-muted-foreground"
                      />
                    }
                    onClick={() => select(tab)}
                  >
                    {label}
                  </NavigationRow>
                )}
                {destinations(tab)}
              </PopoverContent>
            </Popover>
          );
        })}
        {onAddView && (
          <Action
            aria-label="Add view"
            title="Add a view to your canvas"
            data-testid="canvas-add-view"
            disabled={!canAddView}
            onClick={onAddView}
            className="flex size-[24px] shrink-0 items-center justify-center rounded-lg bg-background/50 text-muted-foreground hover:bg-background/80 disabled:opacity-40"
          >
            <Plus aria-hidden className="size-4" />
          </Action>
        )}
      </div>
      <div className="min-w-3 flex-1 self-stretch" data-tauri-drag-region />
      <AppTopChromePortal slot="trailing">
        {viewControls}
        <Popover
          open={open === "profile"}
          onOpenChange={(next) => menus.onOpenChange("profile", next)}
        >
          <PopoverTrigger asChild>
            <Action
              {...menus.triggerProps("profile")}
              aria-label="Account and settings"
              className="pulse-navigation-trigger flex size-8 shrink-0 items-center justify-center rounded-full bg-background shadow-sm"
            >
              <span aria-hidden>
                <UserAvatar
                  avatarUrl={data.profile?.avatarUrl ?? null}
                  displayName={data.profile?.displayName ?? "You"}
                  size="sm"
                />
              </span>
            </Action>
          </PopoverTrigger>
          <PopoverContent
            {...menus.contentProps("profile")}
            align="end"
            sideOffset={10}
            aria-label="Account and settings"
            className="pulse-navigation-popover w-64 p-3"
          >
            <p className="px-2 pb-2 pt-1 text-sm font-medium">
              {data.profile?.displayName ?? "Your workspace"}
            </p>
            <NavigationRow
              icon={<Settings2 className="size-4" />}
              onClick={() => {
                closeMenu();
                onOpenSettings?.("appearance");
              }}
            >
              Settings
            </NavigationRow>
          </PopoverContent>
        </Popover>
      </AppTopChromePortal>
    </nav>
  );
}
