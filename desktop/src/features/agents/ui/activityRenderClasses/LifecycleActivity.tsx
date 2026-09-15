import { AlertCircle, CheckCircle2, ShieldCheck, XCircle } from "lucide-react";

import { formatTranscriptTimestampTitle } from "../agentSessionUtils";
import { ActivityRow, ActivityRowLabel } from "./ActivityRow";
import { ToolActivity } from "./ToolActivity";
import type { ActivityRenderClassItemProps } from "./types";

/**
 * Split the permission item's text into the request description lines and the
 * options line.  The text is newline-joined by describePermissionRequest:
 *   [request title?] [toolCallId?] ["Options: ..."]
 * We surface the options line separately so the render can style it distinctly.
 */
function splitPermissionText(text: string): {
  requestLines: string;
  optionsLine: string | null;
} {
  const lines = text.split("\n");
  const optionsIdx = lines.findIndex((l) => l.startsWith("Options: "));
  if (optionsIdx === -1) {
    return { requestLines: text, optionsLine: null };
  }
  return {
    requestLines: lines.slice(0, optionsIdx).join("\n"),
    optionsLine: lines[optionsIdx],
  };
}

/**
 * Derive the visual tone and icon for a resolved permission outcome string.
 * Outcome strings come from describePermissionOutcome:
 *   "Approved (...)" | "Denied (...)" | "Cancelled"
 */
function permissionOutcomeTone(outcome: string): "approve" | "deny" | "cancel" {
  if (outcome.startsWith("Approved")) return "approve";
  if (outcome.startsWith("Denied")) return "deny";
  return "cancel";
}

export function LifecycleActivity(props: ActivityRenderClassItemProps) {
  if (props.item.type === "tool") {
    return <ToolActivity {...props} />;
  }
  if (props.item.type !== "lifecycle") {
    return null;
  }

  const isError =
    props.item.renderClass === "error" ||
    props.item.title.toLowerCase().includes("error");
  const isPermission = props.item.renderClass === "permission";
  const timestampTitle = formatTranscriptTimestampTitle(props.item.timestamp);

  if (isPermission) {
    const { requestLines, optionsLine } = splitPermissionText(props.item.text);
    const outcome = props.item.outcome;
    const tone = outcome ? permissionOutcomeTone(outcome) : null;
    return (
      <div
        className="activity-widget rounded-blockui-lg border border-warning-foreground/30 bg-warning p-6 text-left text-sm text-warning-foreground dark:text-warning-foreground"
        data-testid="transcript-permission-item"
        title={timestampTitle}
      >
        {/* Row 1: request */}
        <div>
          <ShieldCheck
            aria-hidden="true"
            className="mr-2 inline size-4 align-text-bottom"
          />
          <span className="font-medium">{props.item.title}</span>
          {requestLines ? (
            <span className="opacity-80"> · {requestLines}</span>
          ) : null}
        </div>
        {/* Row 2: options (muted sub-line) */}
        {optionsLine ? (
          <div className="mt-4 text-xs text-muted-foreground">
            {optionsLine}
          </div>
        ) : null}
        {/* Row 3: decision — only when outcome is resolved */}
        {outcome && tone ? (
          <>
            <div className="my-4 border-t border-warning-foreground/30" />
            <div
              className={
                tone === "approve"
                  ? "flex items-center gap-2 text-sm font-medium text-success-foreground dark:text-success-foreground"
                  : tone === "deny"
                    ? "flex items-center gap-2 text-sm font-medium text-destructive"
                    : "flex items-center gap-2 text-sm font-medium text-muted-foreground"
              }
              data-testid="transcript-permission-outcome"
            >
              {tone === "approve" ? (
                <CheckCircle2 aria-hidden="true" className="size-4 shrink-0" />
              ) : tone === "deny" ? (
                <XCircle aria-hidden="true" className="size-4 shrink-0" />
              ) : (
                <XCircle
                  aria-hidden="true"
                  className="size-4 shrink-0 opacity-50"
                />
              )}
              {outcome}
            </div>
          </>
        ) : null}
      </div>
    );
  }

  if (isError) {
    return (
      <div
        className="activity-widget rounded-blockui-lg border border-destructive/20 bg-destructive/5 p-6 text-left text-sm text-destructive"
        data-testid="transcript-lifecycle-item"
        title={timestampTitle}
      >
        <AlertCircle
          aria-hidden="true"
          className="mr-2 inline size-4 align-text-bottom"
        />
        <span className="font-medium">{props.item.title}</span>
        {props.item.text ? (
          <span className="opacity-80"> · {props.item.text}</span>
        ) : null}
      </div>
    );
  }

  return (
    <ActivityRow testId="transcript-lifecycle-item" title={timestampTitle}>
      <ActivityRowLabel
        object={props.item.text || undefined}
        openToneScope="none"
        verb={props.item.title}
      />
    </ActivityRow>
  );
}
