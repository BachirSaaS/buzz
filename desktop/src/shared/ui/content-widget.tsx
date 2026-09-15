import type { ComponentProps } from "react";
import { Card } from "@/shared/blockui/components/card";
import { cn } from "@/shared/lib/cn";

/** Rich content composition: 8px grid, 24px inset/radius, three type levels. */
export function ContentWidget({ className, ...props }: ComponentProps<"div">) {
  return (
    <Card
      data-content-widget=""
      data-block-media=""
      className={cn(
        "content-widget relative min-w-0 gap-4 rounded-blockui-lg border border-border bg-card p-6 font-sans text-sm font-normal text-card-foreground shadow-none ring-0",
        className,
      )}
      {...props}
    />
  );
}

export function WidgetHeading({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn("min-w-0 text-base font-semibold leading-snug", className)}
      {...props}
    />
  );
}

export function WidgetCaption({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "text-xs font-medium leading-4 text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}
