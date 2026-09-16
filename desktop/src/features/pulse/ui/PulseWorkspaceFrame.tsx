import { useId, type ReactNode } from "react";
import { WorkspaceResizeHandle } from "./WorkspaceResizeHandle";
import { useWorkspaceResize } from "./useWorkspaceResize";
import { cn } from "@/shared/lib/cn";
import {
  ContentWidthContext,
  useContentSize,
} from "@/shared/lib/contentWidthPreference";
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
  const preference = useContentSize();
  const resize = useWorkspaceResize();
  const helpId = useId();
  const mode = resize.draft ? "custom" : preference.mode;
  const custom = mode === "custom";
  const fullWidth = mode === "full";
  const size = resize.draft ?? preference;
  return (
    <div
      className={cn(
        "flex min-h-0 flex-1 gap-2 px-2",
        fullWidth ? "py-2" : "pb-(--buzz-top-chrome-height,40px)",
      )}
      data-testid={testId}
    >
      <PulseAppNavigation
        active={active}
        onSelect={onSelect}
        className={fullWidth ? "w-auto pr-0" : undefined}
      />
      <div
        ref={resize.host}
        className="flex min-h-0 min-w-0 flex-1 items-center justify-center"
      >
        <div
          ref={resize.panel}
          data-testid="pulse-main-container"
          data-expanded={expanded}
          data-content-width={mode}
          style={
            custom
              ? {
                  width: `min(100%, ${size.width}px)`,
                  height: `min(100%, ${size.height}px)`,
                }
              : undefined
          }
          className={cn(
            "pulse-workspace-surface relative mx-auto flex h-full min-h-0 w-full flex-1 flex-col",
            custom && "flex-none",
            resize.draft && "select-none",
            active === "home"
              ? "rounded-blockui-lg bg-transparent"
              : "rounded-blockui-lg bg-background shadow-sm",
            !fullWidth && !custom && active === "home" && "max-w-[640px]",
            !fullWidth &&
              !custom &&
              !expanded &&
              active !== "home" &&
              "max-w-[960px]",
          )}
        >
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[inherit]">
            <ContentWidthContext.Provider value={mode}>
              {children}
            </ContentWidthContext.Provider>
          </div>
          <WorkspaceResizeHandle
            {...resize.handleProps}
            aria-describedby={helpId}
          />
          <span id={helpId} className="sr-only">
            Drag to resize from the center. Arrow keys adjust width and height;
            hold Shift for larger steps. Home or double-click resets the size.
            Escape cancels a drag.
          </span>
          <span role="status" className="sr-only">
            {resize.announcement}
          </span>
        </div>
      </div>
      {!fullWidth && (!expanded || custom) && (
        <div aria-hidden="true" className="w-24 shrink-0" />
      )}
    </div>
  );
}
