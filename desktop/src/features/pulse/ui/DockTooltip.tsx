import type { ReactElement } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/shared/ui/tooltip";

/** Dock labels appear outside the scrollable rail for pointer and keyboard users. */
export function DockTooltip({
  label,
  children,
  side = "right",
}: {
  label: string;
  children: ReactElement;
  side?: "right" | "bottom";
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent
        side={side}
        sideOffset={12}
        className="rounded-full px-3 py-2 text-sm"
      >
        {label}
      </TooltipContent>
    </Tooltip>
  );
}
