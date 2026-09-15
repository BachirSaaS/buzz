import { cn } from "@/shared/lib/cn";
import { Spinner } from "@/shared/ui/spinner";
import { useTranscriptAnimationEnabled } from "./transcriptAnimationPreference";
/** A single status owner; honors both transcript animation and reduced motion. */
export function TurnLivenessIndicator({
  className,
}: {
  className?: string;
  fuzz?: boolean;
}) {
  const animationsEnabled = useTranscriptAnimationEnabled();
  return (
    <div
      aria-label="Agent turn in progress"
      className={cn(
        "inline-flex items-center gap-2 text-xs text-muted-foreground",
        className,
      )}
      data-testid="turn-liveness-indicator"
      role="status"
    >
      <Spinner
        aria-hidden="true"
        role="presentation"
        className={cn("size-4", !animationsEnabled && "animate-none!")}
      />
      <span aria-hidden="true">Working…</span>
    </div>
  );
}
