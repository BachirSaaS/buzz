import type { ReactNode } from "react";
import { cn } from "@/shared/lib/cn";
import { PulseAppNavigation, type PulseApp } from "./PulseAppNavigation";

/** Shared dock and window geometry for every Pulse app, including Settings. */
export function PulseWorkspaceFrame({
  active,
  onSelect,
  expanded = false,
  children,
  testId,
}: {
  active: PulseApp | "settings";
  onSelect: (app: PulseApp) => void;
  expanded?: boolean;
  children: ReactNode;
  testId?: string;
}) {
  return (
    <div
      className="flex min-h-0 flex-1 gap-2 px-2 pb-(--buzz-top-chrome-height,40px)"
      data-testid={testId}
    >
      <PulseAppNavigation active={active} onSelect={onSelect} />
      <div className="flex min-h-0 min-w-0 flex-1">
        <div
          data-testid="pulse-main-container"
          data-expanded={expanded}
          className={cn(
            "pulse-workspace-surface relative mx-auto flex min-h-0 w-full flex-1 flex-col overflow-hidden rounded-blockui-lg bg-background shadow-sm",
            !expanded && "max-w-[960px]",
          )}
        >
          {children}
        </div>
      </div>
      {!expanded && <div aria-hidden="true" className="w-24 shrink-0" />}
    </div>
  );
}
