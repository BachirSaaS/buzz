import type { WorkspaceController } from "../lib/usePulseWorkspaces";
import type { ReactNode } from "react";
import { AppTopChromePortal } from "@/app/AppTopChromePortal";
import { Plus } from "lucide-react";
import { Action } from "@/shared/ui/action";
import { cn } from "@/shared/lib/cn";
import { ContentWidthContext } from "@/shared/lib/contentWidthPreference";
import { PulseAppNavigation, type PulseApp } from "./PulseAppNavigation";

/** Navigation occupies the native title bar; the selected window sits within the padded canvas below. */
export function PulseWorkspaceFrame({
  active,
  workspaces,
  expanded = false,
  children,
  testId,
  renderCanvas,
  onAddView,
  canAddView,
  viewControls,
}: {
  active: PulseApp | "settings";
  workspaces: WorkspaceController;
  expanded?: boolean;
  children: ReactNode;
  testId?: string;
  renderCanvas?: (main: ReactNode) => ReactNode;
  onAddView?: () => void;
  canAddView?: boolean;
  viewControls?: ReactNode;
}) {
  const main = (
    <div
      data-testid="pulse-main-container"
      data-expanded={expanded}
      data-content-width="full"
      style={{
        maxWidth: active === "home" ? 720 : "var(--canvas-main-max, 960px)",
      }}
      className={cn(
        "relative flex h-full min-h-0 w-full flex-1 flex-col self-center overflow-hidden",
        active === "home"
          ? "bg-transparent"
          : "pulse-workspace-surface rounded-blockui-lg bg-background shadow-sm",
      )}
    >
      <ContentWidthContext.Provider value="full">
        {children}
      </ContentWidthContext.Provider>
    </div>
  );
  return (
    <div
      className={cn(
        "relative flex min-h-0 min-w-0 flex-1 flex-col p-[16px]",
        onAddView && "pb-[76px]",
      )}
      data-testid={testId}
      id="pulse-workspace-content"
      role="tabpanel"
      aria-label={`${workspaces.active.name} workspace`}
    >
      <AppTopChromePortal>
        <PulseAppNavigation workspaces={workspaces} />
      </AppTopChromePortal>
      {renderCanvas ? renderCanvas(main) : main}
      {onAddView && (
        <div
          role="toolbar"
          aria-label="Canvas controls"
          className="pulse-canvas-actions absolute bottom-4 right-4 z-40 flex items-center gap-1 rounded-full border border-border/40 bg-background/90 p-1.5 shadow-sm backdrop-blur-lg"
        >
          <Action
            aria-label="Add window"
            data-testid="canvas-add-view"
            disabled={!canAddView}
            onClick={onAddView}
            className="flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3 text-xs hover:bg-muted disabled:opacity-40"
          >
            <Plus aria-hidden className="size-3.5" /> Add window
          </Action>
          {viewControls}
        </div>
      )}
    </div>
  );
}
