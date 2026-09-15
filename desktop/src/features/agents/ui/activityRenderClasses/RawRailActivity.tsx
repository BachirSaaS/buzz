import { ChevronDown } from "lucide-react";

import {
  ActivityRow,
  ActivityRowContent,
  ActivityRowLabel,
} from "./ActivityRow";
import { ToolActivity } from "./ToolActivity";
import { formatTranscriptTimestampTitle } from "../agentSessionUtils";
import { PromptSectionList } from "../PromptSectionAccordion";
import type { ActivityRenderClassItemProps } from "./types";

export function RawRailActivity(props: ActivityRenderClassItemProps) {
  if (props.item.type === "tool") {
    return <ToolActivity {...props} />;
  }
  if (props.item.type !== "metadata") {
    return null;
  }

  const sectionCount = props.item.sections.length;
  const sectionSuffix = `${sectionCount} section${sectionCount === 1 ? "" : "s"}`;
  const isRawPayload = props.item.acpSource === "raw_json_rpc";

  return (
    <ActivityRow
      testId="transcript-metadata-item"
      title={formatTranscriptTimestampTitle(props.item.timestamp)}
    >
      <ActivityRowLabel
        object={sectionSuffix}
        openToneScope="tool"
        verb={props.item.title}
      />
      <ActivityRowContent className="flex flex-col gap-4">
        {isRawPayload ? (
          props.item.sections.map((section) => (
            <details
              className="group/section"
              key={`${section.title}:${section.body.slice(0, 48)}`}
            >
              <summary className="inline-flex max-w-full cursor-pointer list-none items-center gap-2 text-xs font-medium text-muted-foreground group-open/section:text-foreground">
                <span className="truncate">{section.title}</span>
                <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform group-open/section:rotate-180 group-open/section:text-foreground" />
              </summary>
              <pre className="mt-4 max-h-56 overflow-auto whitespace-pre-wrap wrap-break-word rounded-blockui-md bg-muted p-4 font-mono text-xs leading-5 text-muted-foreground">
                {section.body.trim() || "No metadata."}
              </pre>
            </details>
          ))
        ) : (
          <PromptSectionList sections={props.item.sections} />
        )}
      </ActivityRowContent>
    </ActivityRow>
  );
}
