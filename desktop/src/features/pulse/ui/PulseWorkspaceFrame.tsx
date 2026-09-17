import type { ReactNode } from "react";
import { AppTopChromePortal } from "@/app/AppTopChromePortal";
import { cn } from "@/shared/lib/cn";
import { ContentWidthContext } from "@/shared/lib/contentWidthPreference";
import {
  PulseAppNavigation,
  type PulseApp,
  type PulseAppSelection,
} from "./PulseAppNavigation";

/** Navigation occupies the native title bar; the selected window sits within the padded canvas below. */
export function PulseWorkspaceFrame({
  active,
  onSelect,
  expanded = false,
  children,
  testId,
  renderCanvas,
  onAddView,
  canAddView,
  viewControls,
}: {
  active: PulseApp | "settings";
  onSelect: PulseAppSelection;
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
        "pulse-workspace-surface relative flex h-full min-h-0 w-full flex-1 flex-col self-center overflow-hidden rounded-blockui-lg",
        active === "home" ? "bg-transparent" : "bg-background shadow-sm",
      )}
    >
      <ContentWidthContext.Provider value="full">
        {children}
      </ContentWidthContext.Provider>
    </div>
  );
  return (
    <div
      className="flex min-h-0 min-w-0 flex-1 flex-col p-[24px]"
      data-testid={testId}
    >
      <AppTopChromePortal>
        <PulseAppNavigation
          active={active}
          onSelect={onSelect}
          onAddView={onAddView}
          canAddView={canAddView}
          viewControls={viewControls}
        />
      </AppTopChromePortal>
      {renderCanvas ? renderCanvas(main) : main}
    </div>
  );
}
