import type { ObserverEvent } from "./agentSessionTypes";
import { describeRawEvent } from "./agentSessionTranscript";
import { observerEventScrollId } from "./agentSessionPanelLayout";
import { TranscriptTimestamp } from "./activityRenderClasses/TranscriptTimestamp";
import { useTranscriptTimestampsEnabled } from "./transcriptTimestampPreference";

export function RawEventRail({ events }: { events: ObserverEvent[] }) {
  const showTimestamps = useTranscriptTimestampsEnabled();

  return (
    <section className="flex min-h-0 w-full flex-col text-foreground">
      <div className="min-h-0 flex-1">
        {events.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No raw events yet.
          </p>
        ) : (
          <div className="space-y-4">
            {events.map((event) => (
              <details
                className="activity-widget group rounded-blockui-lg border border-border bg-card p-6"
                data-message-id={observerEventScrollId(event)}
                key={observerEventScrollId(event)}
              >
                <summary className="cursor-pointer select-none text-xs text-muted-foreground transition-colors group-open:text-foreground">
                  <span className="font-mono text-muted-foreground">
                    #{event.seq}
                  </span>{" "}
                  {describeRawEvent(event)}
                  {showTimestamps ? (
                    <span
                      className="mt-2 flex justify-start"
                      data-testid="raw-event-timestamp"
                    >
                      <TranscriptTimestamp timestamp={event.timestamp} />
                    </span>
                  ) : null}
                </summary>
                <pre className="mt-4 max-h-72 overflow-auto whitespace-pre-wrap wrap-break-word rounded-blockui-md border border-border bg-muted p-4 font-mono text-xs leading-5 text-muted-foreground">
                  {JSON.stringify(event.payload, null, 2)}
                </pre>
              </details>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
