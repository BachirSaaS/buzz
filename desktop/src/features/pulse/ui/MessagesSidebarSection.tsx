import { useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/shared/lib/cn";
import { StatusEmoji } from "@/features/user-status/ui/StatusEmoji";
import { Button } from "@/shared/ui/button";

/** Collapsible classic section, using the same capsule rows as Recents. */
export function MessagesSidebarSection({
  id,
  name,
  icon,
  children,
}: {
  id: string;
  name: string;
  icon?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(true);
  return (
    <section
      className="mt-2 border-t border-border/40 pt-2 first:mt-0 first:border-t-0 first:pt-0"
      data-messages-section={id}
      aria-label={name}
    >
      <h3>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="mb-2 h-auto w-full justify-start gap-2 rounded-full px-4 py-2 text-left text-xs font-medium text-muted-foreground hover:bg-muted"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          <ChevronDown
            aria-hidden="true"
            className={cn("size-3 shrink-0", !open && "-rotate-90")}
          />
          {icon && (
            <span aria-hidden="true">
              <StatusEmoji className="size-4" value={icon} />
            </span>
          )}
          <span className="truncate">{name}</span>
        </Button>
      </h3>
      {open && children}
    </section>
  );
}
