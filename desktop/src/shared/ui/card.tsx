import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cn } from "@/shared/lib/cn";
export {
  CardHeader,
  CardFooter,
  CardTitle,
  CardDescription,
  CardContent,
  CardAction,
} from "@/shared/blockui/components/card";

/** Block UI card surface. Composition preserves a single interactive owner. */
export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  asChild?: boolean;
}
export const Card = React.forwardRef<HTMLDivElement, CardProps>(
  ({ asChild, className, ...props }, ref) => {
    const Comp = asChild ? Slot : "div";
    return (
      <Comp
        ref={ref}
        data-slot="card"
        className={cn(
          "group/card flex flex-col gap-4 rounded-2xl bg-card p-4 text-sm text-card-foreground ring-1 ring-foreground/10 [--card-spacing:1rem]",
          className,
        )}
        {...props}
      />
    );
  },
);
Card.displayName = "Card";
