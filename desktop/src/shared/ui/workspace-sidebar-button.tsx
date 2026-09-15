import * as React from "react";
import { cn } from "@/shared/lib/cn";
import { Button, type ButtonProps } from "./button";

type WorkspaceSidebarButtonProps = Omit<ButtonProps, "variant"> & {
  active: boolean;
};

/** Shared capsule navigation used by the embedded workspace sidebars. */
export const WorkspaceSidebarButton = React.forwardRef<
  HTMLButtonElement,
  WorkspaceSidebarButtonProps
>(({ active, className, ...props }, ref) => (
  <Button
    ref={ref}
    variant="ghost"
    aria-current={active ? "page" : undefined}
    {...props}
    data-workspace-sidebar-row=""
    className={cn(
      "h-12 w-full min-w-0 justify-start gap-2 rounded-blockui-pill px-4 text-left text-sm font-medium",
      active &&
        "bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground",
      className,
    )}
  />
));
WorkspaceSidebarButton.displayName = "WorkspaceSidebarButton";
