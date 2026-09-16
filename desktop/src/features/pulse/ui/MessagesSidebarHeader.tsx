import { Ellipsis } from "lucide-react";
import { Button } from "@/shared/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";
import type { MessagesSidebarLayout } from "../lib/useMessagesSidebarLayout";

/** Messages heading and accessible sidebar organization selector. */
export function MessagesSidebarHeader({
  layout,
  onLayoutChange,
}: {
  layout: MessagesSidebarLayout;
  onLayoutChange: (layout: MessagesSidebarLayout) => void;
}) {
  return (
    <div className="mb-2 flex items-center justify-between gap-2 pl-4">
      <h2 className="py-2 text-base font-semibold">Messages</h2>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className="size-8 rounded-full"
            aria-label="Organize messages"
            title="Organize messages"
          >
            <Ellipsis aria-hidden="true" className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuLabel>Organize messages</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={layout}
            onValueChange={(value) => {
              if (value === "recents" || value === "classic")
                onLayoutChange(value);
            }}
          >
            <DropdownMenuRadioItem value="recents">
              Recents
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="classic">
              Classic
            </DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
