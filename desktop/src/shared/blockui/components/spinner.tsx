// Adapted from Block UI. See ../SOURCE.json.
import { cn } from "@/shared/lib/cn";
import { Loader2Icon } from "lucide-react";

function Spinner({
  className,
  size,
  ...props
}: React.ComponentProps<"svg"> & { size?: number }) {
  return (
    <Loader2Icon
      size={size}
      data-slot="spinner"
      role="status"
      aria-label="Loading"
      className={cn("size-4 motion-safe:animate-spin", className)}
      {...props}
    />
  );
}

export { Spinner };
