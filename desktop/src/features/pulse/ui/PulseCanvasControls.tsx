import { Columns3, LayoutGrid, PanelsTopLeft, Move } from "lucide-react";
import { Action } from "@/shared/ui/action";
import { cn } from "@/shared/lib/cn";
import type { CanvasLayout } from "../lib/canvasLayout";
import { captureCanvasFrames } from "../lib/freeformCanvas";

const layouts = [
  { id: "focus", label: "Focus layout", icon: PanelsTopLeft },
  { id: "grid", label: "Grid layout", icon: LayoutGrid },
  { id: "columns", label: "Columns layout", icon: Columns3 },
  { id: "freeform", label: "Freeform layout", icon: Move },
] as const;

/** Title-bar controls for the current canvas's companion panels. */
export function PulseCanvasControls({
  state,
  save,
}: {
  state: CanvasLayout;
  save: (state: CanvasLayout) => boolean;
}) {
  return (
    <fieldset
      aria-label="Canvas controls"
      className="flex shrink-0 items-center gap-0.5 rounded-lg bg-background/50"
    >
      {layouts.map(({ id, label, icon: Icon }) => (
        <Action
          key={id}
          aria-label={label}
          title={label}
          aria-pressed={state.layout === id}
          onClick={() =>
            save({
              ...state,
              layout: id,
              ...(id === "freeform" && !state.freeform
                ? {
                    freeform: {
                      frames: captureCanvasFrames(
                        document.querySelector('[data-testid="pulse-canvas"]'),
                      ),
                      order: ["main", ...state.windows],
                    },
                  }
                : {}),
            })
          }
          className={cn(
            "flex size-[24px] items-center justify-center rounded-lg text-muted-foreground hover:bg-background/80",
            state.layout === id && "bg-primary text-primary-foreground",
          )}
        >
          <Icon aria-hidden className="size-3.5" />
        </Action>
      ))}
    </fieldset>
  );
}
