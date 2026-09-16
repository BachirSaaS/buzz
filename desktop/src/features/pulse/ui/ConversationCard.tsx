import { PulseMessagePreview } from "./PulseMessagePreview";
import { Action } from "@/shared/ui/action";
import {
  ArrowUpRight,
  Globe2,
  Hash,
  LockKeyhole,
  MessageCircle,
} from "lucide-react";
import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAppNavigation } from "@/app/navigation/useAppNavigation";
import { useCommunities } from "@/features/communities/useCommunities";
import { ForumComposer } from "@/features/forum/ui/ForumComposer";
import { splitOutgoingTags } from "@/features/messages/lib/imetaMediaMarkdown";
import { usePublishNoteMutation } from "@/features/pulse/hooks";
import type { PulseConversation } from "@/features/pulse/lib/unifiedFeed";
import { sendChannelMessage } from "@/shared/api/tauri";
import type { UserProfileSummary } from "@/shared/api/types";
import {
  hasSameMessageAuthor,
  isWithinGroupingWindow,
} from "@/features/messages/lib/messageGrouping";

export function ConversationCard({
  item,
  currentPubkey,
  profiles,
  onRefresh,
  summary,
  summaryMessageId,
  divider = false,
  onOpenContext,
}: {
  item: PulseConversation;
  currentPubkey?: string;
  profiles: Record<string, UserProfileSummary>;
  onRefresh: () => void;
  summary?: string;
  summaryMessageId?: string;
  divider?: boolean;
  onOpenContext?: () => void;
}) {
  const [expanded, setExpanded] = React.useState(false);
  const [replying, setReplying] = React.useState(false);
  const [sending, setSending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const { activeCommunity } = useCommunities();
  const queryClient = useQueryClient();
  const publish = usePublishNoteMutation(currentPubkey);
  const { goChannel, goForumPost } = useAppNavigation();
  const head =
    item.messages.find((m) => m.id === item.rootId) ?? item.messages[0];
  const replies = item.messages.filter((m) => m.id !== head.id);
  const visibleReplies = expanded ? replies : [];
  const isDm = item.channel?.channelType === "dm";
  const SourceIcon = item.isPrivate
    ? LockKeyhole
    : item.channel
      ? Hash
      : Globe2;
  const sourceLabel = isDm
    ? `DM · ${item.channel?.name}`
    : item.channel
      ? `${item.channel.visibility === "private" ? "Private channel · " : ""}#${item.channel.name}`
      : "Public note";
  const destination = isDm
    ? `Reply privately in ${item.channel?.name}`
    : item.channel
      ? `Reply in #${item.channel.name}`
      : "Reply publicly";
  const openContext = () => {
    if (onOpenContext) {
      onOpenContext();
      return;
    }
    if (!item.channel) return;
    if (item.channel.channelType === "forum")
      void goForumPost(item.channel.id, item.rootId);
    else
      void goChannel(item.channel.id, {
        messageId: head.id,
        threadRootId: item.rootId,
        thread: item.rootId,
      });
  };
  const submit = async (
    content: string,
    mentions: string[],
    tags?: string[][],
  ) => {
    setSending(true);
    setError(null);
    try {
      if (item.channel) {
        const { mediaTags, emojiTags, mentionTags } = splitOutgoingTags(tags);
        await sendChannelMessage(
          item.channel.id,
          content,
          head.id,
          mediaTags,
          mentions,
          item.channel.channelType === "forum" ? 45003 : undefined,
          emojiTags,
          mentionTags,
          undefined,
          undefined,
          activeCommunity?.relayUrl,
          currentPubkey,
          item.rootId,
        );
        void queryClient.invalidateQueries({
          queryKey: ["channel-messages", item.channel.id],
        });
      } else {
        await publish.mutateAsync({
          content,
          replyTo: head.id,
          mentionPubkeys: [
            ...new Set([head.pubkey ?? "", ...mentions].filter(Boolean)),
          ],
          mediaTags: tags,
        });
      }
      setReplying(false);
      onRefresh();
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Could not send your reply. Try again.",
      );
      throw failure;
    } finally {
      setSending(false);
    }
  };
  const replyToggle =
    replies.length > 0 ? (
      <Action
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded(!expanded)}
        className="my-3 flex items-center gap-2 rounded text-xs font-medium text-muted-foreground hover:text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
      >
        {expanded
          ? "Hide replies"
          : `View ${replies.length} ${replies.length === 1 ? "reply" : "replies"}`}
      </Action>
    ) : null;
  const actions = (
    <div
      className={`flex items-center gap-5 text-xs text-muted-foreground ${summary ? "mt-5" : "mt-2"}`}
    >
      <Action
        type="button"
        aria-expanded={replying}
        aria-label="Reply"
        title="Reply"
        onClick={() => setReplying(!replying)}
        className="inline-flex h-8 min-w-8 items-center justify-center gap-2 rounded-full px-2 hover:bg-muted/50 hover:text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
      >
        <MessageCircle aria-hidden className="size-4" />
        {summary ? (
          <span>Reply</span>
        ) : (
          replies.length > 0 && <span>{replies.length}</span>
        )}
      </Action>
      {(item.channel || onOpenContext) && (
        <Action
          type="button"
          onClick={openContext}
          aria-label="Open conversation"
          title="Open conversation"
          className="ml-auto inline-flex h-8 min-w-8 items-center justify-center gap-2 rounded-full px-2 hover:bg-muted/50 hover:text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
        >
          {summary && <span>View conversation</span>}
          <ArrowUpRight aria-hidden className="size-3.5" />
        </Action>
      )}
    </div>
  );
  return (
    <article
      data-testid={summary ? "pulse-briefing-highlight" : "pulse-conversation"}
      data-conversation-id={item.id}
      className={`${summary ? "px-6" : "px-5 sm:px-7"} ${summary || divider ? "border-b border-border/50" : ""} ${summary ? "py-6" : "py-[12px]"}`}
    >
      {!summary && head.id !== item.rootId && (
        <p className="mb-3 pl-12 text-xs text-muted-foreground">
          <Action
            type="button"
            className="underline underline-offset-2"
            onClick={openContext}
          >
            Open earlier context
          </Action>
        </p>
      )}
      <PulseMessagePreview
        message={
          summary && summaryMessageId
            ? (item.messages.find(
                (message) => message.id === summaryMessageId,
              ) ?? head)
            : head
        }
        summary={Boolean(summary)}
        currentPubkey={currentPubkey}
        profiles={profiles}
        footer={
          !summary ? (
            <>
              {replyToggle}
              {actions}
            </>
          ) : undefined
        }
        context={
          item.channel ? (
            <Action
              type="button"
              onClick={openContext}
              aria-label={sourceLabel}
              title={sourceLabel}
              className="inline-flex min-w-0 max-w-64 items-center gap-1 rounded text-muted-foreground hover:text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
            >
              {item.isPrivate && (
                <LockKeyhole aria-hidden className="size-3 shrink-0" />
              )}
              <span className="truncate">
                {isDm ? item.channel.name : `#${item.channel.name}`}
              </span>
            </Action>
          ) : (
            <span title="Public note" className="text-muted-foreground">
              <Globe2 aria-hidden className="size-3" />
              <span className="sr-only">Public note</span>
            </span>
          )
        }
      />
      {summary && (
        <p className="mt-4 break-words text-xl leading-relaxed tracking-tight">
          {summary}
        </p>
      )}
      {summary && replyToggle}
      {visibleReplies.length > 0 && (
        <div className="mt-[24px]">
          {visibleReplies.map((message, index) => {
            const previous = visibleReplies[index - 1];
            const continuation =
              hasSameMessageAuthor(previous, message) &&
              isWithinGroupingWindow(previous?.createdAt, message.createdAt);
            return (
              <div
                key={message.id}
                className={
                  index === 0
                    ? undefined
                    : continuation
                      ? "mt-[2px]"
                      : "mt-[24px]"
                }
              >
                <PulseMessagePreview
                  message={message}
                  continuation={continuation}
                  currentPubkey={currentPubkey}
                  profiles={profiles}
                />
              </div>
            );
          })}
        </div>
      )}
      {summary && actions}
      {replying && (
        <div
          className={`mt-4 rounded-xl border border-border/60 bg-muted/15 p-3 ${summary ? "" : "ml-12"}`}
        >
          <p className="mb-3 flex items-center gap-1.5 text-xs font-medium">
            <SourceIcon aria-hidden className="size-3" />
            {destination}
          </p>
          {error && (
            <p role="alert" className="mb-2 text-xs text-destructive">
              {error}
            </p>
          )}
          <ForumComposer
            channelId={item.channel?.id}
            channelType={item.channel?.channelType}
            draftKey={item.channel ? `thread:${item.rootId}` : undefined}
            className="border-0 bg-transparent p-0 shadow-none"
            placeholder={destination}
            isSending={sending}
            disabled={!currentPubkey}
            onSubmit={submit}
            onCancel={() => setReplying(false)}
            profiles={profiles}
          />
        </div>
      )}
    </article>
  );
}
