import * as React from "react";
import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { cn } from "@/shared/lib/cn";

/** Block UI behavior and focus treatment for compound actions (rows, tiles, media).
 * Ordinary standalone actions use Button and its verified Figma variants.
 */
export const Action = React.forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement>
>(({ className, type = "button", ...props }, ref) => (
  <ButtonPrimitive
    {...props}
    ref={ref}
    type={type}
    data-slot="action"
    className={cn("blockui-action", className)}
  />
));
Action.displayName = "Action";
