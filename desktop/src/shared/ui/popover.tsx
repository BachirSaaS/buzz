import * as React from "react";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import { cn } from "@/shared/lib/cn";
import {
  POPOVER_RADIX_MOTION_CLASS,
  POPOVER_RADIX_SIDE_MOTION_CLASS,
  POPOVER_SURFACE_CLASS,
} from "./popoverSurface";
export const DEFAULT_POPOVER_HOVER_OPEN_DELAY_MS = 500;
const Popover = PopoverPrimitive.Root;
const PopoverTrigger = PopoverPrimitive.Trigger;
const PopoverAnchor = PopoverPrimitive.Anchor;
const PopoverContent = React.forwardRef<
  React.ComponentRef<typeof PopoverPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Content> & {
    portalled?: boolean;
  }
>(
  (
    { className, align = "center", portalled = true, sideOffset = 4, ...props },
    ref,
  ) => {
    const content = (
      <PopoverPrimitive.Content
        ref={ref}
        align={align}
        sideOffset={sideOffset}
        data-slot="popover-content"
        className={cn(
          "z-50 w-72 origin-(--radix-popover-content-transform-origin) rounded-xl p-2.5 text-sm outline-hidden",
          POPOVER_SURFACE_CLASS,
          POPOVER_RADIX_MOTION_CLASS,
          POPOVER_RADIX_SIDE_MOTION_CLASS,
          className,
        )}
        {...props}
      />
    );
    return portalled ? (
      <PopoverPrimitive.Portal>{content}</PopoverPrimitive.Portal>
    ) : (
      content
    );
  },
);
PopoverContent.displayName = "PopoverContent";
export { Popover, PopoverTrigger, PopoverContent, PopoverAnchor };
