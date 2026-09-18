import { ChevronRight, Ellipsis } from "lucide-react";
import { type ReactNode, useState } from "react";
import { Action } from "@/shared/ui/action";
import type { AgentWidgetModel, WidgetTool } from "./BuzzWidgets";
import { Control, DetailDialog, Widget } from "./Widget";

/** Quiet glanceable state; agent selection and full activity stay one step away. */
export function CompactAgentActivity({
  agent,
  selection,
  onOpen,
}: {
  agent: AgentWidgetModel;
  selection?: ReactNode;
  onOpen?: () => void;
}) {
  const [options, setOptions] = useState(false);
  const [inspect, setInspect] = useState<WidgetTool | null>(null);
  const tool = agent.tools.at(-1);
  return (
    <Widget
      title="Agent activity"
      scale="14 / 16"
      className="agent-work-widget compact-agent"
    >
      <div className="compact-agent-identity">
        <p className="small subtle">{agent.name}</p>
        {(selection || onOpen) && (
          <Control
            className="icon-control agent-options"
            aria-label="Agent options"
            onClick={() => setOptions(true)}
          >
            <Ellipsis aria-hidden="true" />
          </Control>
        )}
      </div>
      <p className="compact-agent-state" aria-live="polite">
        <span
          className={`agent-state-dot ${agent.active ? "is-active" : ""}`}
          aria-hidden="true"
        />
        {agent.status}
      </p>
      {tool && (
        <Action
          className="agent-tool compact-agent-tool"
          onClick={() => setInspect(tool)}
        >
          <span>
            <span className="tool-title">{tool.title}</span>
            <span className="small subtle">
              {tool.state === "executing"
                ? agent.active
                  ? "Running"
                  : "Last reported as running"
                : tool.state === "completed"
                  ? "Complete"
                  : tool.state === "failed"
                    ? "Failed"
                    : "Queued"}
            </span>
          </span>
          <ChevronRight className="tool-arrow" aria-hidden="true" />
        </Action>
      )}
      <p className="small subtle">
        {agent.tokens === null ? "—" : agent.tokens.toLocaleString("en-US")}{" "}
        context tokens
      </p>
      {inspect && (
        <DetailDialog title={inspect.title} onClose={() => setInspect(null)}>
          <p className="small subtle">{inspect.state}</p>
          <p className="tool-detail">
            {inspect.detail || "No additional details reported."}
          </p>
        </DetailDialog>
      )}
      {options && (
        <DetailDialog title="Agent activity" onClose={() => setOptions(false)}>
          {selection}
          <p className="small subtle">{agent.context}</p>
          {onOpen && (
            <Control
              onClick={() => {
                setOptions(false);
                onOpen();
              }}
            >
              Open activity
              <ChevronRight aria-hidden="true" />
            </Control>
          )}
        </DetailDialog>
      )}
    </Widget>
  );
}
