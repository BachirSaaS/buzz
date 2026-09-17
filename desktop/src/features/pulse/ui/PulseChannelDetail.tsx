import * as React from "react";
import { useTerminalContextOverride } from "@/app/TerminalContextOverrideContext";
import { useLocation } from "@tanstack/react-router";
import { selectSearchHighlightRouteState } from "@/app/routes/searchHighlightRouteState";
import { useIdentityQuery } from "@/shared/api/hooks";
import type { Channel } from "@/shared/api/types";
import { useHistorySearchState } from "@/shared/hooks/useHistorySearchState";
import { MainInsetProvider } from "@/shared/layout/MainInsetContext";
import { MessageBubbleContext } from "@/features/messages/ui/MessageBubbleContext";
import { PULSE_CONVERSATION_KEYS } from "../lib/pulsePanelState";
import { LocalHistorySearchProvider } from "@/shared/hooks/LocalHistorySearchProvider";
import { ContentWidthContext } from "@/shared/lib/contentWidthPreference";

const ChannelRouteScreen = React.lazy(async () => {
  const module = await import("@/app/routes/ChannelRouteScreen");
  return { default: module.ChannelRouteScreen };
});

type PulseChannelDetailProps = {
  channel?: Channel;
  channelId?: string;
  /** Keep threads, profiles, and forum posts local to this companion panel. */
  independent?: boolean;
};

export function PulseChannelDetail(props: PulseChannelDetailProps) {
  return props.independent ? (
    <LocalHistorySearchProvider key={props.channelId ?? props.channel?.id}>
      <ContentWidthContext.Provider value="full">
        <ConversationDetail {...props} />
      </ContentWidthContext.Provider>
    </LocalHistorySearchProvider>
  ) : (
    <ConversationDetail {...props} />
  );
}

function ConversationTerminalContext({
  channelId,
  channelName,
  threadId,
}: {
  channelId: string;
  channelName: string;
  threadId: string | null;
}) {
  const context = React.useMemo(
    () => ({ channelId, channelName, threadId }),
    [channelId, channelName, threadId],
  );
  useTerminalContextOverride(context);
  return null;
}

function ConversationDetail({
  channel,
  channelId = channel?.id,
  independent = false,
}: PulseChannelDetailProps) {
  const identity = useIdentityQuery();
  const searchHighlight = useLocation({
    select: selectSearchHighlightRouteState,
  });
  const detailRef = React.useRef<HTMLDivElement>(null);
  const { values, applyPatch } = useHistorySearchState(PULSE_CONVERSATION_KEYS);
  return (
    <div
      className="flex min-h-0 min-w-0 flex-1 flex-col"
      data-testid="pulse-message-view"
    >
      {!independent && (
        <ConversationTerminalContext
          channelId={channelId ?? ""}
          channelName={channel?.name ?? "Conversation"}
          threadId={values.thread}
        />
      )}
      <div
        ref={detailRef}
        className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
      >
        <MessageBubbleContext.Provider value={identity.data?.pubkey ?? null}>
          <MainInsetProvider mainInsetRef={detailRef}>
            <React.Suspense
              fallback={
                <p role="status" className="p-6 text-sm text-muted-foreground">
                  Loading conversation…
                </p>
              }
            >
              {channelId && (
                <ChannelRouteScreen
                  key={channelId}
                  embedded
                  channelId={channelId}
                  autoSendDraftKey={null}
                  searchHighlight={independent ? null : searchHighlight}
                  onSelectForumPost={
                    independent
                      ? (post) => applyPatch({ post, reply: null })
                      : undefined
                  }
                  onCloseForumPost={
                    independent
                      ? () => applyPatch({ post: null, reply: null })
                      : undefined
                  }
                  selectedPostId={values.post}
                  targetReplyId={values.reply}
                  targetMessageId={values.messageId}
                  targetThreadRootId={values.threadRootId ?? values.thread}
                />
              )}
            </React.Suspense>
          </MainInsetProvider>
        </MessageBubbleContext.Provider>
      </div>
    </div>
  );
}
