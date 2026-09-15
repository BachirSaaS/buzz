import { Check, CircleAlert, Clock3, LoaderCircle } from "lucide-react";
import { cn } from "@/shared/lib/cn";
import { useTranscriptAnimationEnabled } from "../transcriptAnimationPreference";
import type { TranscriptItem } from "../agentSessionTypes";

/** Render reported tool state; completion never implies an invented outcome. */
export function ActivityToolStatus({
  item,
}: {
  item: Extract<TranscriptItem, { type: "tool" }>;
}) {
  const animationsEnabled = useTranscriptAnimationEnabled();
  const failed = item.isError || item.status === "failed";
  const done = item.status === "completed";
  const running = item.status === "executing";
  const Icon = failed
    ? CircleAlert
    : done
      ? Check
      : running
        ? LoaderCircle
        : Clock3;
  const label = failed
    ? "Failed"
    : done
      ? "Completed"
      : running
        ? "Running"
        : "Pending";
  return (
    <span
      data-activity-status={label.toLowerCase()}
      className={cn(
        "inline-flex shrink-0 items-center gap-2 rounded-blockui-pill bg-muted px-2 py-2 text-xs font-medium",
        failed ? "bg-destructive/10 text-destructive" : "text-muted-foreground",
      )}
    >
      <Icon
        aria-hidden="true"
        className={cn(
          "size-4",
          running &&
            !failed &&
            animationsEnabled &&
            "animate-spin motion-reduce:animate-none",
        )}
      />
      {label}
    </span>
  );
}
