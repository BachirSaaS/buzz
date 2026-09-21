import { SlidersHorizontal } from "lucide-react";
import { AppTopChromePortal } from "@/app/AppTopChromePortal";
import { PULSE_NAVIGATION_LAYOUT } from "../lib/navigationLayout";
import { useAppShell } from "@/app/AppShellContext";
import { Action } from "@/shared/ui/action";
import { TooltipProvider } from "@/shared/ui/tooltip";
import { DockTooltip } from "./DockTooltip";
import { WorkspaceTabs } from "./WorkspaceTabs";
import { PulseQuickAccess } from "./PulseQuickAccess";
import type { WorkspaceController } from "../lib/usePulseWorkspaces";
import type { PulseWorkspacePage } from "../lib/workspaceNavigation";
import "./PulseAppNavigation.css";

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

/** Workspace tabs and pinned chats stay accessible independently of canvas windows. */
export function PulseAppNavigation({
  workspaces,
  settingsActive = false,
}: {
  workspaces: WorkspaceController;
  settingsActive?: boolean;
}) {
  const { onOpenSettings } = useAppShell();
  if (PULSE_NAVIGATION_LAYOUT === "top")
    return (
      <TooltipProvider delayDuration={350} skipDelayDuration={250}>
        <AppTopChromePortal>
          <nav
            aria-label="Workspace navigation"
            data-testid="pulse-app-navigation"
            className="pulse-top-navigation flex min-w-0 flex-1 items-center gap-3"
            data-tauri-drag-region
          >
            <WorkspaceTabs
              workspaces={workspaces}
              settingsActive={settingsActive}
              layout="top"
            />
            <div
              className="min-w-3 flex-1 self-stretch"
              data-tauri-drag-region
            />
          </nav>
        </AppTopChromePortal>
        <AppTopChromePortal slot="trailing">
          <div className="pulse-top-actions flex shrink-0 items-center gap-3">
            <PulseQuickAccess key={workspaces.scope} layout="top" />
            <DockTooltip label="Settings" side="bottom">
              <Action
                aria-label="Settings"
                aria-current={settingsActive ? "page" : undefined}
                className="pulse-top-icon pulse-control-surface"
                onClick={() => onOpenSettings?.("profile")}
              >
                <SlidersHorizontal aria-hidden className="size-4" />
              </Action>
            </DockTooltip>
          </div>
        </AppTopChromePortal>
      </TooltipProvider>
    );
  return (
    <TooltipProvider delayDuration={350} skipDelayDuration={250}>
      <nav
        aria-label="Workspace navigation"
        data-testid="pulse-app-navigation"
        className="pulse-app-dock pulse-control-surface"
      >
        <div className="pulse-dock-scroll">
          <WorkspaceTabs
            workspaces={workspaces}
            settingsActive={settingsActive}
          />
          <div className="pulse-dock-separator" />
          <PulseQuickAccess key={workspaces.scope} />
        </div>
        <div className="pulse-dock-separator" />
        <DockTooltip label="Settings">
          <Action
            aria-label="Settings"
            aria-current={settingsActive ? "page" : undefined}
            className="pulse-dock-icon"
            onClick={() => onOpenSettings?.("profile")}
          >
            <SlidersHorizontal aria-hidden className="size-6" />
          </Action>
        </DockTooltip>
      </nav>
    </TooltipProvider>
  );
}
