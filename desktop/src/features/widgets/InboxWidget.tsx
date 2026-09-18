import { Action } from "@/shared/ui/action";
import { useState } from "react";
import { type EmailPreview, emails } from "./data";
import { DetailDialog, Widget } from "./Widget";
import { useWidgetSize } from "./WidgetSizing";

/** Opening a sample email marks it read locally for this mounted widget. */
export function InboxWidget({
  messages = emails,
}: {
  messages?: EmailPreview[];
}) {
  const [open, setOpen] = useState<EmailPreview | null>(null);
  const size = useWidgetSize();
  const [read, setRead] = useState<Set<string>>(() => new Set());
  return (
    <Widget title="Inbox" className="inbox-widget" scale="14 / 16">
      <div className="inbox-list">
        {messages.slice(0, size === "small" ? 1 : 3).map((message) => {
          const unread = message.unread && !read.has(message.id);
          return (
            <Action
              type="button"
              className="email-row"
              key={message.id}
              onClick={() => {
                setOpen(message);
                setRead((current) => new Set([...current, message.id]));
              }}
              aria-label={`${unread ? "Unread: " : ""}${message.sender}, ${message.subject}`}
            >
              <span className="avatar" aria-hidden="true">
                {message.initials}
              </span>
              <span className="email-copy">
                <span className="email-sender">
                  <span>{message.sender}</span>
                  {size !== "small" && (
                    <time className="small subtle">{message.time}</time>
                  )}
                </span>
                <span className="email-subject">
                  {message.subject}
                  {unread && <span className="unread-dot" aria-hidden="true" />}
                </span>
                {size === "large" && (
                  <span className="email-preview small subtle">
                    {message.preview}
                  </span>
                )}
              </span>
            </Action>
          );
        })}
      </div>
      {open && (
        <DetailDialog title={open.subject} onClose={() => setOpen(null)}>
          <p className="subtle">
            {open.sender} · {open.time}
          </p>
          <p>{open.body}</p>
        </DetailDialog>
      )}
    </Widget>
  );
}
