import { ChevronDown, ChevronUp, Ellipsis, EyeOff, ZoomIn } from "lucide-react";
import { Button } from "@/shared/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";

/** Per-card presentation controls; the saved Appearance preference is unchanged. */
export function LinkPreviewControls({
  compact,
  expanded,
  onCompactChange,
  onExpandedChange,
  onRemove,
  onViewImage,
}: {
  compact: boolean;
  expanded: boolean;
  onCompactChange: (compact: boolean) => void;
  onExpandedChange?: (expanded: boolean) => void;
  onRemove?: () => void;
  onViewImage?: () => void;
}) {
  return (
    <div className="relative z-20 shrink-0">
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button
            aria-label="Link display settings"
            className="size-8 rounded-full text-muted-foreground hover:bg-muted"
            size="icon-xs"
            title="Link display settings"
            type="button"
            variant="ghost"
          >
            <Ellipsis aria-hidden="true" className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" side="bottom">
          {onExpandedChange ? (
            <>
              <DropdownMenuItem onSelect={() => onExpandedChange(!expanded)}>
                {expanded ? (
                  <ChevronUp aria-hidden="true" />
                ) : (
                  <ChevronDown aria-hidden="true" />
                )}
                {expanded ? "Show less" : "Show more"}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
            </>
          ) : null}
          <DropdownMenuRadioGroup
            value={compact ? "compact" : "rich"}
            onValueChange={(value) => onCompactChange(value === "compact")}
          >
            <DropdownMenuRadioItem value="rich">
              Full preview
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="compact">
              Compact preview
            </DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
          {onViewImage ? (
            <DropdownMenuItem onSelect={onViewImage}>
              <ZoomIn aria-hidden="true" />
              View image
            </DropdownMenuItem>
          ) : null}
          {onRemove ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onSelect={onRemove}
              >
                <EyeOff aria-hidden="true" />
                Remove preview
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
