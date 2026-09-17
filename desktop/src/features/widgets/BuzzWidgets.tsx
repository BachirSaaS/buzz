import {
  ArrowUpRight,
  Check,
  Circle,
  Headphones,
  MessageCircle,
  Terminal,
  X,
} from "lucide-react";
import { type ReactNode, useState } from "react";
import { UserAvatar } from "@/shared/ui/UserAvatar";
import { Action } from "@/shared/ui/action";
import { Control, DetailDialog, Widget } from "./Widget";
import "./buzz-widgets.css";

/** A reported operation in the selected agent turn. */
export type WidgetTool = {
  id: string;
  title: string;
  detail: string;
  state: "executing" | "completed" | "failed" | "pending";
};
/** An agent's current state and the latest reported context usage, not billed totals. */
export type AgentWidgetModel = {
  name: string;
  status: string;
  context: string;
  active: boolean;
  tools: WidgetTool[];
  toolCount: number;
  tokens: number | null;
  capacity: number | null;
};

/** Compact agent supervision with a single status anchor and inspectable tools. */
export function AgentActivityWidget({
  agent,
  selection,
  onOpen,
}: {
  agent: AgentWidgetModel;
  selection?: ReactNode;
  onOpen?: () => void;
}) {
  const [detail, setDetail] = useState<WidgetTool | null>(null);
  return (
    <Widget
      title="Agent activity"
      scale="14 / 16 / 24"
      className="agent-work-widget"
    >
      {selection}
      <div className="agent-identity">
        <span className="agent-glyph" aria-hidden="true">
          <Terminal />
        </span>
        <div>
          <p className="agent-name">{agent.name}</p>
          <p className="small subtle">{agent.context}</p>
        </div>
      </div>
      <div className="agent-state">
        <span
          className={`agent-state-dot ${agent.active ? "is-active" : ""}`}
          aria-hidden="true"
        />
        <h3 className="section-anchor" aria-live="polite">
          {agent.status}
        </h3>
      </div>
      {agent.tools.length > 0 && (
        <div className="agent-tool-list">
          {agent.tools.map((tool) => (
            <Action
              key={tool.id}
              className="agent-tool"
              onClick={() => setDetail(tool)}
            >
              <span className="tool-state" aria-hidden="true">
                {tool.state === "completed" ? (
                  <Check />
                ) : tool.state === "failed" ? (
                  <X />
                ) : (
                  <Circle />
                )}
              </span>
              <span>
                <span className="tool-title">{tool.title}</span>
                <span className="small subtle">
                  {tool.state === "executing" && !agent.active
                    ? "Last reported as running"
                    : tool.state === "executing"
                      ? "Running"
                      : tool.state === "completed"
                        ? "Complete"
                        : tool.state === "failed"
                          ? "Failed"
                          : "Queued"}
                </span>
              </span>
              <ArrowUpRight className="tool-arrow" aria-hidden="true" />
            </Action>
          ))}
        </div>
      )}
      <div className="agent-metrics">
        <div>
          <p className="small subtle">Context tokens</p>
          <p className="agent-metric-value">
            {agent.tokens === null ? "—" : agent.tokens.toLocaleString("en-US")}
          </p>
          {agent.capacity !== null && (
            <p className="small subtle">
              of {agent.capacity.toLocaleString("en-US")}
            </p>
          )}
        </div>
        <div>
          <p className="small subtle">Tool calls</p>
          <p className="agent-metric-value">{agent.toolCount}</p>
        </div>
      </div>
      {onOpen && (
        <Control className="communication-action" onClick={onOpen}>
          Open activity
          <ArrowUpRight aria-hidden="true" />
        </Control>
      )}
      {detail && (
        <DetailDialog title={detail.title} onClose={() => setDetail(null)}>
          <p className="small subtle">{detail.state}</p>
          <p className="tool-detail">
            {detail.detail || "No additional details reported."}
          </p>
        </DetailDialog>
      )}
    </Widget>
  );
}

/** Named members of an existing conversation. */
export type WidgetPerson = { id: string; name: string; avatar?: string | null };
/** Accessible participant stack. Names remain visible beside the decorative avatars. */
export function WidgetPeople({
  people,
  total = people.length,
}: {
  people: WidgetPerson[];
  total?: number;
}) {
  return (
    <div className="huddle-people">
      <div className="huddle-avatar-stack" aria-hidden="true">
        {people.slice(0, 4).map((person) => (
          <span className="huddle-person" key={person.id}>
            <UserAvatar
              avatarUrl={person.avatar ?? null}
              displayName={person.name}
              className="widget-person-avatar"
              fallbackDelayMs={0}
            />
          </span>
        ))}
        {total > 4 && <span className="huddle-person">+{total - 4}</span>}
      </div>
      <p className="small subtle">
        {people
          .slice(0, 3)
          .map((person) => person.name)
          .join(", ")}
        {total > 3 ? ` +${total - 3}` : ""}
      </p>
    </div>
  );
}

/** A group huddle launcher; the host owns actual voice-session state. */
export function HuddleWidget({
  title,
  people,
  count,
  selection,
  action,
  error,
}: {
  title: string;
  people: WidgetPerson[];
  count?: number;
  selection?: ReactNode;
  action: ReactNode;
  error?: string | null;
}) {
  return (
    <Widget title="Huddle" scale="14 / 16 / 24" className="huddle-widget">
      <div className="huddle-illustration" aria-hidden="true">
        <Headphones />
        <div className="huddle-wave">
          {[
            ["a", 16],
            ["b", 32],
            ["c", 24],
            ["d", 48],
            ["e", 40],
            ["f", 24],
            ["g", 32],
            ["h", 16],
          ].map(([id, height]) => (
            <span key={id} style={{ height }} />
          ))}
        </div>
      </div>
      <div>
        <h3 className="section-anchor">Better in a huddle.</h3>
        <p className="small subtle huddle-description">{title}</p>
      </div>
      {selection}
      <WidgetPeople people={people} total={count} />
      {error && (
        <p className="small" role="alert">
          {error}
        </p>
      )}
      <div className="huddle-action">{action}</div>
    </Widget>
  );
}

/** Shared row contract for mentions, conversations, and channel activity. */
export type CommunicationRow = {
  id: string;
  title: string;
  context: string;
  body: string;
  avatar?: string | null;
  initials?: string;
  replies?: number;
  onOpen: () => void;
};
/** Three high-value conversations with real navigation owned by the host. */
export function CommunicationWidget({
  title,
  headline,
  rows,
  empty,
  loading,
  error,
  onRetry,
}: {
  title: string;
  headline: string;
  rows: CommunicationRow[];
  empty: string;
  loading?: boolean;
  error?: boolean;
  onRetry?: () => void;
}) {
  return (
    <Widget title={title} scale="14 / 16 / 24">
      <h3 className="section-anchor">{headline}</h3>
      {error && (
        <div className="communication-error" role="alert">
          <p>Couldn’t refresh activity.</p>
          {onRetry && <Control onClick={onRetry}>Try again</Control>}
        </div>
      )}
      {loading && !rows.length ? (
        <p className="small subtle" role="status">
          Loading conversations…
        </p>
      ) : !rows.length ? (
        <p className="small subtle">{empty}</p>
      ) : (
        <div className="communication-list">
          {rows.slice(0, 3).map((row) => (
            <Action
              className="communication-row"
              key={row.id}
              onClick={row.onOpen}
            >
              <span className="avatar" aria-hidden="true">
                {row.initials || (
                  <UserAvatar
                    avatarUrl={row.avatar ?? null}
                    displayName={row.title}
                    className="widget-person-avatar"
                    fallbackDelayMs={0}
                  />
                )}
              </span>
              <span className="communication-copy">
                <span className="communication-row-title">{row.title}</span>
                <span className="small subtle">{row.context}</span>
                <span className="communication-body">{row.body}</span>
                {typeof row.replies === "number" && row.replies > 0 && (
                  <span className="small subtle communication-replies">
                    <MessageCircle aria-hidden="true" />
                    {row.replies} {row.replies === 1 ? "reply" : "replies"}
                  </span>
                )}
              </span>
              <ArrowUpRight
                aria-hidden="true"
                className="communication-arrow"
              />
            </Action>
          ))}
        </div>
      )}
    </Widget>
  );
}
