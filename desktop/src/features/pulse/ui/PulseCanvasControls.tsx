import { useRef } from "react";
import {
  Columns3,
  LayoutGrid,
  Rows3,
  Move,
  Ellipsis,
  Plus,
} from "lucide-react";
import { Action } from "@/shared/ui/action";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from "@/shared/ui/dropdown-menu";
import { canvasContentIds, type CanvasLayout } from "../lib/canvasLayout";
import { captureCanvasFrames } from "../lib/freeformCanvas";

const layouts = [
  { id: "focus", label: "Focus", icon: Rows3 },
  { id: "grid", label: "Grid", icon: LayoutGrid },
  { id: "columns", label: "Columns", icon: Columns3 },
  { id: "freeform", label: "Freeform", icon: Move },
] as const;

/** Optional canvas arrangement lives behind one labeled control; windows own their local actions. */
export function PulseCanvasControls({
  state,
  save,
  onAdd,
  canAdd,
}: {
  onAdd: () => void;
  canAdd: boolean;
  state: CanvasLayout;
  save: (state: CanvasLayout) => boolean;
}) {
  const openingPicker = useRef(false);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Action
          aria-label="Window options"
          data-testid="canvas-options"
          title="Window options"
          className="pulse-control-surface flex size-10 items-center justify-center rounded-full"
        >
          <Ellipsis aria-hidden className="size-5" />
        </Action>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        side="top"
        sideOffset={8}
        aria-label="Window options"
        onCloseAutoFocus={(event) => {
          if (openingPicker.current) event.preventDefault();
          openingPicker.current = false;
        }}
      >
        <DropdownMenuItem
          disabled={!canAdd}
          data-testid="canvas-add-view"
          onSelect={() => {
            openingPicker.current = true;
            onAdd();
          }}
        >
          <Plus aria-hidden className="size-4" /> Add window
        </DropdownMenuItem>
        <DropdownMenuSeparator />
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
