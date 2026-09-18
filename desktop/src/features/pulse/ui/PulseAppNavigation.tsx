import { AppTopChromePortal } from "@/app/AppTopChromePortal";
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
}: {
  workspaces: WorkspaceController;
}) {
  return (
    <nav
      aria-label="Workspace navigation"
      data-testid="pulse-app-navigation"
      className="flex min-w-0 flex-1 items-center gap-3"
      data-tauri-drag-region
    >
      <WorkspaceTabs workspaces={workspaces} />
      <div className="min-w-3 flex-1 self-stretch" data-tauri-drag-region />
      <AppTopChromePortal slot="trailing">
        <PulseQuickAccess key={workspaces.scope} />
      </AppTopChromePortal>
    </nav>
  );
}
