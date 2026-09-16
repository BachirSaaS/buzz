import * as React from "react";
import type { ReactNode } from "react";
import { Eye } from "lucide-react";
import {
  setThreadViewMode,
  useThreadViewMode,
  type ThreadViewMode,
} from "@/features/channels/lib/threadViewModePreference";
import { useCommunities } from "@/features/communities/useCommunities";
import { LinkPreviewWidget } from "@/shared/ui/link-preview-widget";
import { useTheme } from "@/shared/theme/ThemeProvider";
import {
  previewConversationDensity,
  setConversationDensity,
  useConversationDensity,
  type ConversationDensity,
} from "@/shared/lib/conversationDensityPreference";
import {
  previewFontSize,
  setFontSize,
  useFontSize,
  type FontSize,
} from "@/shared/lib/fontSizePreference";

import { SettingsOptionRow } from "./SettingsOptionGroup";
import { SegmentedControl } from "@/shared/ui/segmented-control";

/** Buzz navigation can use either its production tint or a stronger tab. */

const FONT_SIZE_OPTIONS: { value: FontSize; label: string }[] = [
  { value: "smaller", label: "Smaller" },
  { value: "default", label: "Default" },
  { value: "larger", label: "Larger" },
];
const CONVERSATION_DENSITY_OPTIONS: {
  value: ConversationDensity;
  label: string;
}[] = [
  { value: "compact", label: "Compact" },
  { value: "comfortable", label: "Comfortable" },
  { value: "spacious", label: "Spacious" },
];
function ConversationDensityPreviewMessage({
  avatar,
  author,
  children,
  timestamp,
}: {
  avatar: string;
  author: string;
  children: ReactNode;
  timestamp: string;
}) {
  return (
    <article className="flex gap-2.5 py-conversation-row">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-muted-foreground">
        {avatar}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-1.5 leading-message-author">
          <span className="text-message font-semibold leading-message-author tracking-normal text-foreground">
            {author}
          </span>
          <span className="text-message-timestamp font-normal text-muted-foreground">
            {timestamp}
          </span>
        </div>
        <div className="mt-conversation-body text-message font-normal tracking-normal text-foreground">
          {children}
        </div>
      </div>
    </article>
  );
}

function ConversationPreview() {
  return (
    <div className="px-4 py-3" data-testid="conversation-preview">
      <div
        aria-hidden="true"
        className="relative overflow-hidden rounded-xl border border-border/65 bg-transparent"
        data-testid="conversation-preview-surface"
      >
        <span className="absolute right-3.5 top-3 inline-flex items-center gap-1 text-2xs font-medium text-muted-foreground">
          <Eye aria-hidden="true" className="size-3" />
          Preview
        </span>
        <div className="p-4" data-testid="conversation-preview-content">
          <ConversationDensityPreviewMessage
            avatar="M"
            author="Maya"
            timestamp="9:41"
          >
            The revised conversation layout is ready to review.
          </ConversationDensityPreviewMessage>
          <ConversationDensityPreviewMessage
            avatar="T"
            author="Theo"
            timestamp="9:43"
          >
            <p>
              I added a longer message so you can compare line height and text
              spacing.
            </p>
            <p className="mt-conversation-paragraph">
              The same rhythm carries through channels, threads, DMs, and Inbox.
            </p>
          </ConversationDensityPreviewMessage>
        </div>
      </div>
    </div>
  );
}

/** App-wide type sizing and conversation-specific spacing controls. */
export function ConversationDisplaySettings() {
  const density = useConversationDensity();
  const fontSize = useFontSize();

  return (
    <div data-testid="conversation-display-group">
      <SettingsOptionRow data-testid="font-size-row">
        <div className="min-w-0">
          <p className="text-sm font-medium">Font size</p>
          <p
            className="text-sm font-normal text-muted-foreground"
            data-settings-subcopy
          >
            Applies across conversations and interface text
          </p>
        </div>
        <SegmentedControl
          size="wide"
          legend="Font size"
          onPreviewChange={previewFontSize}
          onValueChange={setFontSize}
          optionTestIdPrefix="font-size"
          options={FONT_SIZE_OPTIONS}
          testId="font-size-control"
          value={fontSize}
        />
      </SettingsOptionRow>
      <SettingsOptionRow data-testid="conversation-density-row">
        <div className="min-w-0">
          <p className="text-sm font-medium">Conversation density</p>
          <p
            className="text-sm font-normal text-muted-foreground"
            data-settings-subcopy
          >
            Spacing in conversations and Markdown content across Buzz
          </p>
        </div>
        <SegmentedControl
          size="wide"
          legend="Conversation density"
          onPreviewChange={previewConversationDensity}
          onValueChange={setConversationDensity}
          optionTestIdPrefix="conversation-density"
          options={CONVERSATION_DENSITY_OPTIONS}
          testId="conversation-density-control"
          value={density}
        />
      </SettingsOptionRow>
      <ConversationPreview />
    </div>
  );
}

/** A representative link bubble, kept inert in Appearance settings. */
export function LinkPreviewStyleSetting() {
  return (
    <div data-testid="link-preview-style-group">
      <SettingsOptionRow>
        <div className="min-w-0">
          <p className="text-sm font-medium">Link previews</p>
          <p className="text-sm text-muted-foreground" data-settings-subcopy>
            Compact message bubbles with a title and source
          </p>
        </div>
      </SettingsOptionRow>
      <div className="px-4 py-3" data-testid="link-preview-sample">
        <div
          aria-hidden="true"
          inert
          data-testid="link-preview-sample-surface"
          className="relative rounded-xl border border-border/65 p-4"
        >
          <span className="mb-3 flex items-center gap-1 text-2xs text-muted-foreground">
            <Eye aria-hidden="true" className="size-3" />
            Preview
          </span>
          <LinkPreviewWidget
            preview={{
              kind: "generic-link",
              href: "https://example.com/product-updates",
              provider: "example.com",
              title: "Product updates — a fresh look at conversations",
              typeLabel: "link",
              description: "",
              imageState: "none",
            }}
          />
        </div>
      </div>
    </div>
  );
}

const THREAD_VIEW_MODE_OPTIONS: {
  value: ThreadViewMode;
  label: string;
  description: string;
}[] = [
  {
    value: "focus",
    label: "Focus",
    description: "Threads open over the channel",
  },
  {
    value: "split",
    label: "Split",
    description: "Threads open in a side panel next to the channel",
  },
];

/** Compact thread preference row in the Appearance preferences card. */
/**
 * Abstract diagram for the thread layout preview, in the same soft-block
 * style as the links sample: a rounded frame holding a channel surface and a
 * thread surface, with light skeleton bars. Inline SVG (not a data-URL image)
 * so fills reference theme tokens directly and follow light/dark
 * changes automatically. Only the panel proportions change between modes.
 */
function ThreadLayoutDiagram({ mode }: { mode: ThreadViewMode }) {
  const { isDark } = useTheme();
  const channelSurface = "var(--muted)";
  const threadSurface = "var(--background)";
  const channelOpacity = isDark ? 0.88 : 0.78;
  const threadOpacity = isDark ? 0.98 : 0.96;
  const bar = "color-mix(in srgb, var(--foreground) 24.0%, transparent)";
  const barSoft =
    "color-mix(in srgb, var(--foreground) 14.000000000000002%, transparent)";

  const isFocus = mode === "focus";
  // Inner content area: 10..230 x 10..122 (inside the frame padding).
  // Split: channel and thread share the area side by side with a gap.
  // Focus: the channel continues beneath the overlaid thread, leaving only
  // a narrow orientation sliver visible at the left edge.
  const gap = 6;
  const threadX = isFocus ? 42 : 124;
  const channelWidth = isFocus ? 64 : threadX - 10 - gap;
  const threadWidth = 230 - threadX;

  /** Two skeleton text bars, clipped to the panel they sit in. */
  const skeleton = (x: number, y: number, width: number) => (
    <>
      <rect fill={bar} height={7} rx={3.5} width={width * 0.62} x={x} y={y} />
      <rect
        fill={barSoft}
        height={7}
        rx={3.5}
        width={width * 0.86}
        x={x}
        y={y + 13}
      />
    </>
  );

  return (
    <svg
      aria-hidden="true"
      className="block w-full max-w-60"
      data-testid={`thread-layout-diagram-${mode}`}
      role="img"
      viewBox="0 0 240 132"
    >
      <rect fill="var(--sidebar)" height={132} rx={16} width={240} />
      {/* Channel surface */}
      <rect
        fill={channelSurface}
        height={112}
        opacity={channelOpacity}
        rx={10}
        width={channelWidth}
        x={10}
        y={10}
      />
      {channelWidth > 60 ? skeleton(22, 24, channelWidth - 24) : null}
      {/* Thread surface */}
      <path
        d={`M ${threadX + 10} 10 H 220 Q 230 10 230 20 V 112 Q 230 122 220 122 H ${threadX + 10} Q ${threadX} 122 ${threadX} 112 V 20 Q ${threadX} 10 ${threadX + 10} 10 Z`}
        fill={threadSurface}
        opacity={threadOpacity}
      />
      {skeleton(threadX + 12, 24, threadWidth - 24)}
    </svg>
  );
}

function ThreadLayoutPreview({ mode }: { mode: ThreadViewMode }) {
  return (
    <div className="px-4 py-3" data-testid="thread-layout-preview">
      <div
        aria-hidden="true"
        className="relative overflow-hidden rounded-xl border border-border/65 bg-transparent"
        data-testid="thread-layout-preview-surface"
      >
        <span className="absolute right-3.5 top-3 inline-flex items-center gap-1 text-2xs font-medium text-muted-foreground">
          <Eye aria-hidden="true" className="size-3" />
          Preview
        </span>
        <div className="p-4 pr-24">
          <ThreadLayoutDiagram mode={mode} />
        </div>
      </div>
    </div>
  );
}

export function ThreadLayoutSetting() {
  const threadViewMode = useThreadViewMode();
  const [previewMode, setPreviewMode] = React.useState<ThreadViewMode | null>(
    null,
  );
  const { communities } = useCommunities();
  const showCommunityScope = communities.length > 1;
  const displayedMode = previewMode ?? threadViewMode;
  const activeOption =
    THREAD_VIEW_MODE_OPTIONS.find((option) => option.value === displayedMode) ??
    THREAD_VIEW_MODE_OPTIONS[0];

  return (
    <div data-testid="thread-layout-group">
      <SettingsOptionRow>
        <div className="min-w-0">
          <p className="text-sm font-medium">
            Thread layout
            {showCommunityScope ? (
              <span className="font-normal text-muted-foreground">
                {" "}
                (all communities)
              </span>
            ) : null}
          </p>
          <p
            className="text-sm font-normal text-muted-foreground"
            data-settings-subcopy
          >
            {activeOption.description}
          </p>
        </div>
        <SegmentedControl
          size="compact"
          legend="Thread layout"
          onPreviewChange={setPreviewMode}
          onValueChange={setThreadViewMode}
          optionTestIdPrefix="thread-layout"
          options={THREAD_VIEW_MODE_OPTIONS}
          testId="thread-layout-control"
          value={threadViewMode}
        />
      </SettingsOptionRow>
      <ThreadLayoutPreview mode={displayedMode} />
    </div>
  );
}
