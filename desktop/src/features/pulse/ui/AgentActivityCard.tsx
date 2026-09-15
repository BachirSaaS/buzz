import { ContentWidget } from "@/shared/ui/content-widget";
import { Action } from "@/shared/ui/action";
import { Bot, ChevronDown, ChevronRight } from "lucide-react";
import * as React from "react";

import type { AgentNoteGroup } from "@/features/pulse/lib/groupAgentNotes";
import { UserProfilePopover } from "@/features/profile/ui/UserProfilePopover";
import type { UserProfileSummary } from "@/shared/api/types";
import { Markdown } from "@/shared/ui/markdown";
import { UserAvatar } from "@/shared/ui/UserAvatar";
import { truncateNpub } from "@/shared/lib/pubkey";

type AgentActivityCardProps = {
  group: AgentNoteGroup;
  profile?: UserProfileSummary | null;
  agentStatus?: "online" | "away" | "offline" | "unknown";
};

function formatRelativeTime(unixSeconds: number): string {
  const now = Date.now() / 1_000;
  const diff = now - unixSeconds;

  if (diff < 60) return "just now";
  if (diff < 3_600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86_400) return `${Math.floor(diff / 3_600)}h ago`;
  if (diff < 604_800) return `${Math.floor(diff / 86_400)}d ago`;

  return new Date(unixSeconds * 1_000).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

function StatusDot({ status }: { status: "online" | "away" | "offline" }) {
  const color =
    status === "online"
      ? "bg-success-foreground"
      : status === "away"
        ? "bg-warning-foreground"
        : "bg-muted";
  return (
    <span
      aria-label={`Agent ${status}`}
      role="img"
      className={`inline-block h-2 w-2 rounded-full ${color}`}
    />
  );
}

export function AgentActivityCard({
  group,
  profile,
  agentStatus,
}: AgentActivityCardProps) {
  const [expanded, setExpanded] = React.useState(false);
  const displayName = profile?.displayName ?? truncateNpub(group.pubkey);
  const avatarUrl = profile?.avatarUrl ?? null;
  const isSingleNote = group.notes.length === 1;

  // Show the latest note content as the summary.
  const summaryNote = group.notes[0];

  return (
    <ContentWidget className="blockui-activity">
      {/* Header */}
      <div className="flex items-center gap-4">
        <UserProfilePopover
          botIdenticonValue={displayName}
          pubkey={group.pubkey}
          role={"bot" as const}
        >
          <Action
            aria-label={`Open profile for ${displayName}`}
            className="relative flex shrink-0 rounded-xl pt-1 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
            type="button"
          >
            <UserAvatar
              avatarUrl={avatarUrl}
              displayName={displayName}
              shape="squircle"
            />
            <Bot
              aria-hidden="true"
              className="absolute -bottom-0.5 -right-0.5 size-4 rounded-full bg-background p-0.5 text-muted-foreground"
            />
          </Action>
        </UserProfilePopover>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-base font-semibold leading-none">
              {displayName}
            </span>
            {agentStatus && agentStatus !== "unknown" ? (
              <StatusDot status={agentStatus} />
            ) : null}
            <span className="shrink-0 text-xs text-muted-foreground">
              {formatRelativeTime(group.latestAt)}
            </span>
          </div>
        </div>
        {!isSingleNote ? (
          <Action
            className="flex h-8 items-center gap-2 rounded-full px-2 text-xs text-muted-foreground hover:bg-muted/50 hover:text-foreground"
            aria-expanded={expanded}
            onClick={() => setExpanded(!expanded)}
            type="button"
          >
            {expanded ? (
              <ChevronDown aria-hidden="true" className="size-4" />
            ) : (
              <ChevronRight aria-hidden="true" className="size-4" />
            )}
            {group.notes.length} updates
          </Action>
        ) : null}
      </div>

      {/* Content */}
      {isSingleNote || !expanded ? (
        <div className="mt-0 text-sm leading-relaxed text-foreground">
          <Markdown content={summaryNote.content} />
        </div>
      ) : (
        <div className="space-y-4">
          {group.notes.map((note, idx) => (
            <div
              className="flex gap-2 rounded-blockui-md border border-border bg-muted/20 p-4"
              key={note.id}
            >
              <span className="mt-0.5 shrink-0 text-xs font-medium text-muted-foreground">
                {idx + 1}.
              </span>
              <div className="min-w-0 flex-1 text-sm">
                <Markdown content={note.content} />
                <p className="mt-1 text-xs text-muted-foreground">
                  {formatRelativeTime(note.createdAt)}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </ContentWidget>
  );
}
