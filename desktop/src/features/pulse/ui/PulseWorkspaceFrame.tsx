import "./PulseSurface.css";
import type { WorkspaceController } from "../lib/usePulseWorkspaces";
import type { ReactNode } from "react";
import { cn } from "@/shared/lib/cn";
import { ContentWidthContext } from "@/shared/lib/contentWidthPreference";
import { PulseAppNavigation, type PulseApp } from "./PulseAppNavigation";
import { InterfaceCommandsProvider } from "../voice/InterfaceCommandsProvider";

/** Navigation can occupy the title bar or overlay the symmetric canvas as a dock. */
export function PulseWorkspaceFrame({
  active,
  workspaces,
  expanded = false,
  children,
  testId,
  renderCanvas,
  viewControls,
}: {
  active: PulseApp | "settings";
  workspaces: WorkspaceController;
  expanded?: boolean;
  children: ReactNode;
  testId?: string;
  renderCanvas?: (main: ReactNode) => ReactNode;
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
    <InterfaceCommandsProvider key={workspaces.scope} workspaces={workspaces}>
      <div
        className={cn(
          "relative flex min-h-0 min-w-0 flex-1 flex-col p-[16px]",
          "pb-[76px]",
        )}
        data-testid={testId}
        id="pulse-workspace-content"
        role="tabpanel"
        aria-label={`${workspaces.active.name} workspace`}
      >
        <PulseAppNavigation
          workspaces={workspaces}
          settingsActive={active === "settings"}
        />
        {renderCanvas ? renderCanvas(main) : main}
        <div
          role="toolbar"
          aria-label="Canvas controls"
          className="pulse-canvas-actions absolute bottom-4 right-4 z-40"
        >
          {viewControls}
        </div>
      </div>
    </InterfaceCommandsProvider>
  );
}
