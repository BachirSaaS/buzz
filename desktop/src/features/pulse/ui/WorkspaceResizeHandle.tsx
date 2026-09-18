import type { ButtonHTMLAttributes } from "react";
import { Action } from "@/shared/ui/action";
import type { WindowCorner } from "../lib/freeformCanvas";
/** An invisible corner hit target with a stroke revealed only on hover or keyboard focus. */
export function WorkspaceResizeHandle({
  corner = "se",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { corner?: WindowCorner }) {
  return (
    <Action
      {...props}
      title="Drag to resize · Arrow keys to adjust"
      data-testid="content-resize-handle"
      data-corner={corner}
      className="window-corner-handle"
    >
      <svg aria-hidden="true" viewBox="0 0 32 32">
        <path
          data-resize-hit=""
          d="M 28 4 V 12 A 16 16 0 0 1 12 28 H 4"
          fill="none"
          stroke="transparent"
          strokeWidth="14"
        />
        <path
          className="window-corner-stroke"
          d="M 28 4 V 12 A 16 16 0 0 1 12 28 H 4"
          fill="none"
          stroke="white"
          strokeWidth="3"
          strokeLinecap="round"
          pointerEvents="none"
        />
      </svg>
    </Action>
  );
}
