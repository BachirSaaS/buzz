import {
  Columns3,
  LayoutGrid,
  PanelsTopLeft,
  Move,
  ChevronDown,
} from "lucide-react";
import { Action } from "@/shared/ui/action";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from "@/shared/ui/dropdown-menu";
import { canvasContentIds, type CanvasLayout } from "../lib/canvasLayout";
import { captureCanvasFrames } from "../lib/freeformCanvas";

const layouts = [
  { id: "focus", label: "Focus", icon: PanelsTopLeft },
  { id: "grid", label: "Grid", icon: LayoutGrid },
  { id: "columns", label: "Columns", icon: Columns3 },
  { id: "freeform", label: "Freeform", icon: Move },
] as const;

/** Optional canvas arrangement lives behind one labeled control; windows own their local actions. */
export function PulseCanvasControls({
  state,
  save,
}: {
  state: CanvasLayout;
  save: (state: CanvasLayout) => boolean;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Action
          aria-label="Arrange windows"
          className="flex h-8 shrink-0 items-center gap-1 rounded-full px-3 text-xs text-muted-foreground hover:bg-muted data-[state=open]:bg-muted"
        >
          Arrange <ChevronDown aria-hidden className="size-3" />
        </Action>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        side="top"
        sideOffset={8}
        aria-label="Arrange windows"
      >
        <DropdownMenuLabel>Arrange windows</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={state.layout}
          onValueChange={(value) => {
            const layout = layouts.find((item) => item.id === value)?.id;
            if (!layout) return;
            save({
              ...state,
              layout,
              ...(layout === "freeform" && !state.freeform
                ? {
                    freeform: {
                      frames: captureCanvasFrames(
                        document.querySelector('[data-testid="pulse-canvas"]'),
                      ),
                      order: canvasContentIds(state),
                    },
                  }
                : {}),
            });
          }}
        >
          {layouts.map(({ id, label, icon: Icon }) => (
            <DropdownMenuRadioItem
              key={id}
              value={id}
              aria-label={`${label} layout`}
            >
              <Icon aria-hidden className="size-4" />
              {label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
