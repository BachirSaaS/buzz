import type * as React from "react";
import { useKnownAgentPubkeys } from "@/features/agents/useKnownAgentPubkeys";
import { getConfigNudgeAuthorPubkey } from "@/features/messages/ui/configNudgeAuthPubkey";
import { Bot } from "lucide-react";
import type { TimelineMessage } from "@/features/messages/types";
import type { UserProfileSummary } from "@/shared/api/types";
import { UserProfilePopover } from "@/features/profile/ui/UserProfilePopover";
import { UserAvatar } from "@/shared/ui/UserAvatar";
import { hasLinkPreviewSuppression } from "@/features/messages/lib/formatTimelineMessages";
import { Markdown } from "@/shared/ui/markdown";
import { MessageBubbleContext } from "@/features/messages/ui/MessageBubbleContext";
import { MessageBubbleLayout } from "@/features/messages/ui/MessageBubbleLayout";
import { normalizePubkey } from "@/shared/lib/pubkey";
import { resolveMentionProps } from "@/shared/lib/resolveMentionNames";
import { parseImetaTags } from "@/shared/ui/markdown/parseImeta";

function relativeTime(time: number) {
  const minutes = Math.max(0, Math.floor((Date.now() / 1000 - time) / 60));
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h`;
  return new Date(time * 1000).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

export function PulseMessagePreview({
  message,
  continuation = false,
  context,
  summary,
  currentPubkey,
  profiles,
  footer,
}: {
  message: TimelineMessage;
  continuation?: boolean;
  context?: React.ReactNode;
  summary?: boolean;
  currentPubkey?: string;
  profiles: Record<string, UserProfileSummary>;
  footer?: React.ReactNode;
}) {
  const knownAgents = useKnownAgentPubkeys();
  const configAuthor = getConfigNudgeAuthorPubkey(message, (pubkey) => {
    const normalized = normalizePubkey(pubkey);
    return (
      knownAgents.has(normalized) || profiles[normalized]?.isAgent === true
    );
  });
  const outgoing = Boolean(
    currentPubkey &&
      message.pubkey &&
      normalizePubkey(currentPubkey) === normalizePubkey(message.pubkey),
  );
  const mentionProps = resolveMentionProps(
    message.tags,
    profiles,
    message.body,
  );
  const avatar = (
    <UserProfilePopover
      pubkey={message.pubkey ?? ""}
      role={message.isAgent ? "bot" : undefined}
      triggerAriaLabel={`Open ${message.author}'s profile`}
    >
      <span className="relative z-10 h-fit shrink-0 rounded-full bg-background focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring">
        <UserAvatar
          avatarUrl={message.avatarUrl ?? null}
          displayName={message.author}
          fallbackDelayMs={0}
          className={summary ? "!h-12 !w-12" : "!h-7 !w-7"}
          shape={message.isAgent ? "squircle" : "circle"}
        />
      </span>
    </UserProfilePopover>
  );
  const header = (
    <div
      className={`flex flex-wrap items-center gap-x-1.5 gap-y-1 ${summary ? "text-message" : "text-message-timestamp"}`}
    >
      <span className="font-semibold text-foreground">{message.author}</span>
      {message.isAgent && (
        <span className="text-muted-foreground" title="Agent">
          <Bot aria-hidden className="size-3" />
          <span className="sr-only">Agent</span>
        </span>
      )}
      {context}
      <span aria-hidden className="text-muted-foreground/60">
        ·
      </span>
      <time
        className="text-muted-foreground"
        dateTime={new Date(message.createdAt * 1000).toISOString()}
        title={`${new Date(message.createdAt * 1000).toLocaleString()}${message.edited ? " · Edited" : ""}`}
      >
        {relativeTime(message.createdAt)}
      </time>
    </div>
  );
  if (summary)
    return (
      <div className="relative flex gap-3">
        {avatar}
        <div className="min-w-0 flex-1 self-center">{header}</div>
      </div>
    );
  return (
    <MessageBubbleContext.Provider value={currentPubkey ?? ""}>
      <div className={`relative flex gap-2.5 ${outgoing ? "justify-end" : ""}`}>
        <MessageBubbleLayout
          outgoing={outgoing}
          continuation={continuation}
          avatar={avatar}
          header={header}
          metadata={header}
          extras={null}
          footer={footer}
          body={
            <Markdown
              content={message.body}
              configNudgeAuthorPubkey={configAuthor}
              messageId={message.id}
              linkPreviewTags={message.tags}
              linkPreviewsSuppressed={hasLinkPreviewSuppression(message.tags)}
              {...mentionProps}
              imetaByUrl={
                message.tags ? parseImetaTags(message.tags) : undefined
              }
            />
          }
        />
      </div>
    </MessageBubbleContext.Provider>
  );
}
