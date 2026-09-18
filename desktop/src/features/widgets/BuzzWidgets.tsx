import {
  Check,
  ChevronRight,
  Circle,
  MessageCircle,
  Terminal,
  X,
} from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { UserAvatar } from "@/shared/ui/UserAvatar";
import { Action } from "@/shared/ui/action";
import { Control, DetailDialog, Widget } from "./Widget";
import { useWidgetSize } from "./WidgetSizing";
import { CompactAgentActivity } from "./CompactAgentActivity";
import "./buzz-widgets.css";

/** A reported operation in the selected agent turn. */
export type WidgetTool = {
  id: string;
  title: string;
  detail: string;
  state: "executing" | "completed" | "failed" | "pending";
};
/** Latest reported context usage, not billed totals or task-completion progress. */
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

/** The current operation leads; larger sizes disclose more of the same turn. */
export function AgentActivityWidget({
  agent,
  selection,
  onOpen,
}: {
  agent: AgentWidgetModel;
  selection?: ReactNode;
  onOpen?: () => void;
}) {
  const size = useWidgetSize();
  const [detail, setDetail] = useState<WidgetTool | null>(null);
  const visibleTools = agent.tools.slice(
    -(size === "small" ? 1 : size === "medium" ? 2 : 3),
  );
  const tokenText =
    agent.tokens === null ? "—" : agent.tokens.toLocaleString("en-US");
  if (size === "small")
    return (
      <CompactAgentActivity
        agent={agent}
        selection={selection}
        onOpen={onOpen}
      />
    );
  return (
    <Widget
      title="Agent activity"
      scale="14 / 16 / 24"
      className="agent-work-widget"
    >
      <div className="agent-identity">
        <span className="agent-glyph" aria-hidden="true">
          <Terminal />
        </span>
        <div className="agent-identity-copy">
          {selection || <p className="agent-name">{agent.name}</p>}
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
      {visibleTools.length > 0 && (
        <div className="agent-tool-list">
          {visibleTools.map((tool) => (
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
                {size === "large" &&
                  tool.state === "executing" &&
                  tool.detail && (
                    <span className="small subtle tool-preview">
                      {tool.detail}
                    </span>
                  )}
              </span>
              <ChevronRight className="tool-arrow" aria-hidden="true" />
            </Action>
          ))}
        </div>
      )}
      <div className="agent-usage small subtle">
        <span>
          <span className="metric-ink">{tokenText}</span>
          {agent.capacity !== null
            ? ` / ${agent.capacity.toLocaleString("en-US")}`
            : ""}{" "}
          context tokens
        </span>
        {
          <span>
            {agent.toolCount} tool {agent.toolCount === 1 ? "call" : "calls"}
          </span>
        }
      </div>
      {onOpen && (
        <Control className="agent-open" onClick={onOpen}>
          Open activity
          <ChevronRight aria-hidden="true" />
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
/** Grouped avatars carry identity visually; names are available to assistive technology. */
export function WidgetPeople({
  people,
  total = people.length,
  limit = 4,
}: {
  people: WidgetPerson[];
  total?: number;
  limit?: number;
}) {
  const names = people.map((person) => person.name).join(", ");
  return (
    <span
      className="huddle-avatar-stack"
      role="img"
      aria-label={names || "Participants loading"}
      title={names}
    >
      {people.slice(0, limit).map((person) => (
        <span className="huddle-person" key={person.id} aria-hidden="true">
          <UserAvatar
            avatarUrl={person.avatar ?? null}
            displayName={person.name}
            className="widget-person-avatar"
            fallbackDelayMs={0}
          />
        </span>
      ))}
      {total > limit && (
        <span className="huddle-person" aria-hidden="true">
          +{total - limit}
        </span>
      )}
    </span>
  );
}

/** A compact launcher; the group selector is the title when the host provides it. */
export function HuddleWidget({
  title,
  people,
  count,
  selection,
  action,
  error,
  active = false,
}: {
  title: string;
  people: WidgetPerson[];
  count?: number;
  selection?: ReactNode;
  action: ReactNode;
  error?: string | null;
  active?: boolean;
}) {
  const size = useWidgetSize();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (active) setOpen(false);
  }, [active]);
  if (size === "small")
    return (
      <Widget
        title="Huddle"
        scale="14 / 16"
        className="huddle-widget avatar-only-widget"
      >
        <Action
          className="avatar-launcher huddle-avatar-launcher"
          aria-label={`Open ${title} huddle`}
          title={`${title} · ${people.map((person) => person.name).join(", ")}`}
          onClick={() => setOpen(true)}
        >
          <WidgetPeople
            people={people.length ? people : [{ id: "group", name: title }]}
            limit={3}
            total={Math.min(people.length, 3)}
          />
        </Action>
        {error && !open && (
          <p className="small" role="alert">
            {error}
          </p>
        )}
        {open && (
          <DetailDialog title="Huddle" onClose={() => setOpen(false)}>
            {selection || <p>{title}</p>}
            <ul className="participant-names">
              {people.map((person) => (
                <li key={person.id}>{person.name}</li>
              ))}
            </ul>
            {error && <p role="alert">{error}</p>}
            <div className="huddle-action">{action}</div>
          </DetailDialog>
        )}
      </Widget>
    );
  return (
    <Widget title="Huddle" scale="14 / 16 / 24" className="huddle-widget">
      {selection || <h3 className="section-anchor">{title}</h3>}
      {size === "large" && (
        <div className="participant-roster">
          {people.slice(0, 4).map((person) => (
            <div className="participant-entry" key={person.id}>
              <WidgetPeople people={[person]} />
              <span>{person.name}</span>
            </div>
          ))}
        </div>
      )}
      {size === "large" && people.length > 4 && (
        <Control className="people-control" onClick={() => setOpen(true)}>
          View all participants
        </Control>
      )}
      {error && (
        <p className="small" role="alert">
          {error}
        </p>
      )}
      <div className="huddle-footer">
        {size !== "large" && (
          <Action
            className="people-control"
            aria-label="View huddle participants"
            onClick={() => setOpen(true)}
          >
            <WidgetPeople people={people} total={count} limit={4} />
          </Action>
        )}
        <div className="huddle-action">{action}</div>
      </div>
      {open && (
        <DetailDialog title={title} onClose={() => setOpen(false)}>
          <ul className="participant-names">
            {people.map((person) => (
              <li key={person.id}>{person.name}</li>
            ))}
          </ul>
        </DetailDialog>
      )}
    </Widget>
  );
}

/** Shared row contract for mentions, conversations, and channel activity. */
export type CommunicationRow = {
  id: string;
  title: string;
  context?: string;
  body: string;
  avatar?: string | null;
  initials?: string;
  people?: WidgetPerson[];
  /** Recent people represent an active channel in the compact avatar surface. */
  compactPeople?: WidgetPerson[];
  replies?: number;
  onOpen: () => void;
};
/** Avatar launchers at small, concise rows at medium, supporting context at large. */
export function CommunicationWidget({
  title,
  rows,
  empty,
  loading,
  error,
  onRetry,
}: {
  title: string;
  rows: CommunicationRow[];
  empty: string;
  loading?: boolean;
  error?: boolean;
  onRetry?: () => void;
}) {
  const size = useWidgetSize();
  return (
    <Widget
      title={title}
      scale="14 / 16"
      className={`communication-widget ${size === "small" ? "avatar-only-widget" : ""}`}
    >
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
      ) : size === "small" ? (
        <div className="avatar-launchers">
          {rows.slice(0, 3).map((row) => {
            const people = row.compactPeople?.length
              ? row.compactPeople
              : row.people?.length
                ? row.people
                : [{ id: row.id, name: row.title, avatar: row.avatar }];
            const label = `${row.title}${row.context ? ` · ${row.context}` : ""}`;
            return (
              <Action
                key={row.id}
                className={`avatar-launcher ${people.length > 1 ? "avatar-launcher-group" : ""}`}
                aria-label={`Open ${label}`}
                title={label}
                onClick={row.onOpen}
              >
                <WidgetPeople
                  people={people}
                  limit={2}
                  total={Math.min(people.length, 2)}
                />
              </Action>
            );
          })}
        </div>
      ) : (
        <div className="communication-list">
          {rows.slice(0, 3).map((row) => (
            <Action
              className="communication-row"
              key={row.id}
              onClick={row.onOpen}
            >
              <span className="communication-identity" aria-hidden="true">
                {row.people?.length ? (
                  <WidgetPeople
                    people={row.people}
                    limit={2}
                    total={Math.min(row.people.length, 2)}
                  />
                ) : (
                  <span className="avatar">
                    {row.initials || (
                      <UserAvatar
                        avatarUrl={row.avatar ?? null}
                        displayName={row.title}
                        className="widget-person-avatar"
                        fallbackDelayMs={0}
                      />
                    )}
                  </span>
                )}
              </span>
              <span className="communication-copy">
                <span className="communication-row-heading">
                  <span className="communication-row-title">{row.title}</span>
                  {row.context && (
                    <span className="small subtle">{row.context}</span>
                  )}
                </span>
                <span className="communication-body">{row.body}</span>
                {size === "large" &&
                  typeof row.replies === "number" &&
                  row.replies > 0 && (
                    <span className="small subtle communication-replies">
                      <MessageCircle aria-hidden="true" />
                      {row.replies} {row.replies === 1 ? "reply" : "replies"}
                    </span>
                  )}
              </span>
            </Action>
          ))}
        </div>
      )}
    </Widget>
  );
}
