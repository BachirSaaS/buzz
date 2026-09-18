import type { ReactNode, HTMLAttributes } from "react";
import { Plus, X } from "lucide-react";
import { Action } from "@/shared/ui/action";

/** Shared window chrome for main views, widgets, floating windows, and tab groups. */
export function WindowToolbar({
  title,
  children,
  onSplit,
  canSplit,
  addBeside = false,
  onClose,
  ...headerProps
}: {
  title: string;
  children?: ReactNode;
  onSplit: () => void;
  canSplit: boolean;
  addBeside?: boolean;
  onClose?: () => void;
} & HTMLAttributes<HTMLElement>) {
  return (
    <div
      role="toolbar"
      className="panel-dock-header"
      data-testid="window-toolbar"
      {...headerProps}
      tabIndex={headerProps.onPointerDown ? 0 : undefined}
      aria-label={
        headerProps.onPointerDown ? `Move ${title} window` : undefined
      }
    >
      {children ?? (
        <span className="panel-window-title text-sm font-medium">{title}</span>
      )}
      <div className="panel-dock-header-space" aria-hidden />
      <Action
        className="panel-window-action"
        aria-label={
          addBeside ? "Add window beside Home" : `Split ${title} window`
        }
        disabled={!canSplit}
        title={
          canSplit
            ? addBeside
              ? "Add a window beside Home"
              : "Add a connected split"
            : "Four windows maximum. Close a window to add a split."
        }
        onClick={onSplit}
      >
        <Plus aria-hidden className="size-3.5" />
      </Action>
      {onClose && (
        <Action
          className="panel-window-action"
          aria-label={`Close ${title} window`}
          onClick={onClose}
        >
          <X aria-hidden className="size-3.5" />
        </Action>
      )}
    </div>
  );
}
