import { Ellipsis, EyeOff } from "lucide-react";
import { Button } from "@/shared/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";

/** Keep removal available without restoring oversized presentation modes. */
export function LinkPreviewControls({ onRemove }: { onRemove: () => void }) {
  return (
    <div className="relative z-20 shrink-0">
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button
            aria-label="Link actions"
            className="size-6 rounded-full text-inherit hover:bg-current/10 hover:text-inherit"
            size="icon-xs"
            type="button"
            variant="ghost"
          >
            <Ellipsis aria-hidden="true" className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" side="bottom">
          <DropdownMenuItem onSelect={onRemove}>
            <EyeOff aria-hidden="true" />
            Remove preview
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
