import {
  ArrowUpRight,
  ChevronDown,
  ChevronUp,
  CircleDot,
  FileText,
  Folder,
  GitPullRequest,
  Globe,
  ImageOff,
  Presentation,
  Table2,
  GitFork,
} from "lucide-react";
import { useState, type MouseEvent } from "react";
import type { ResolvedLinkPreview } from "@/shared/lib/useResolvedLinkPreviews";
import { cn } from "@/shared/lib/cn";
import { Action } from "@/shared/ui/action";
import {
  ContentWidget,
  WidgetCaption,
  WidgetHeading,
} from "@/shared/ui/content-widget";
import { LinkPreviewControls } from "@/shared/ui/link-preview-controls";
import type { LinkPreviewImageLightboxComponent } from "@/shared/ui/rich-link-preview-attachment";

function previewIdentity(preview: ResolvedLinkPreview) {
  const kind = preview.kind;
  const Icon = kind.endsWith("pull-request")
    ? GitPullRequest
    : kind.endsWith("issue")
      ? CircleDot
      : kind.endsWith("repository")
        ? GitFork
        : kind.endsWith("folder") || kind.endsWith("project")
          ? Folder
          : kind.endsWith("spreadsheet")
            ? Table2
            : kind.endsWith("presentation")
              ? Presentation
              : kind.endsWith("document") || kind.endsWith("file")
                ? FileText
                : Globe;
  let hostname = preview.provider;
  let context: string | null = null;
  try {
    const url = new URL(preview.href);
    if (url.protocol !== "buzz:") hostname = url.hostname.replace(/^www\./, "");
    if (url.hostname === "github.com") {
      const [owner, repo, resource, number] = url.pathname
        .split("/")
        .filter(Boolean);
      if (owner && repo)
        context = `${owner} / ${repo}${(resource === "pull" || resource === "issues") && /^\d+$/.test(number ?? "") ? ` · #${number}` : ""}`;
    }
  } catch {
    /* The parser already supplies an honest provider fallback. */
  }
  const type =
    preview.typeLabel === "PR"
      ? "Pull request"
      : preview.typeLabel === "repo"
        ? "Repository"
        : preview.typeLabel;
  return { Icon, hostname, context, type };
}

/** Presentation only. Metadata, snapshot, media proxy and access policies stay upstream. */
export function LinkPreviewWidget({
  className,
  compact = false,
  ImageLightbox,
  onOpen,
  onRemove,
  preview,
  showControls = false,
  showExpandControl = true,
}: {
  className?: string;
  compact?: boolean;
  ImageLightbox?: LinkPreviewImageLightboxComponent;
  onOpen?: () => void;
  onRemove?: () => void;
  preview: ResolvedLinkPreview;
  showControls?: boolean;
  showExpandControl?: boolean;
}) {
  const [expanded, setExpanded] = useState(true);
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const { Icon, hostname, context, type } = previewIdentity(preview);
  const src = preview.imageState === "image" ? preview.imageDataUrl : null;
  const showImage = Boolean(src && src !== failedSrc);
  const reserveImage = preview.imageState !== "none";
  const fallback =
    preview.imageState === "fallback" || Boolean(src && !showImage);
  const openProps = {
    href: preview.href,
    rel: "noreferrer",
    target: "_blank",
    onClick: onOpen
      ? (event: MouseEvent<HTMLAnchorElement>) => {
          event.preventDefault();
          onOpen();
        }
      : undefined,
  };
  const media =
    reserveImage && expanded ? (
      <div
        className={cn(
          "overflow-hidden rounded-blockui-md bg-muted",
          compact ? "size-16 shrink-0" : "aspect-[1.91/1] w-full",
        )}
        data-link-preview-thumbnail=""
      >
        {showImage ? (
          <img
            alt={`Preview from ${preview.imageDomain ?? hostname}`}
            className="h-full w-full object-cover"
            src={src ?? undefined}
            onError={() => setFailedSrc(src ?? null)}
          />
        ) : fallback ? (
          <div
            aria-hidden="true"
            className="flex h-full w-full items-center justify-center text-muted-foreground"
            data-link-preview-image-fallback=""
          >
            <ImageOff className="size-6" />
          </div>
        ) : (
          <div
            aria-label="Loading preview image"
            role="status"
            className="h-full w-full animate-pulse bg-muted motion-reduce:animate-none"
            data-link-preview-skeleton=""
          />
        )}
      </div>
    ) : null;
  return (
    <ContentWidget
      className={cn(
        "group/preview w-lg max-w-full shrink-0",
        compact && "w-112",
        className,
      )}
      data-image-state={preview.imageState}
      data-link-preview={preview.kind}
      data-link-preview-inline={compact ? undefined : ""}
    >
      <div className="flex min-w-0 items-center gap-2">
        <Icon
          aria-hidden="true"
          className="size-4 shrink-0 text-muted-foreground"
        />
        <WidgetCaption className="min-w-0 flex-1 truncate capitalize">
          {preview.provider} · {type}
        </WidgetCaption>
        {showControls ? (
          <LinkPreviewControls onRemove={onRemove} placement="inline" />
        ) : null}
      </div>
      <div className={cn("flex min-w-0 gap-4", !compact && "flex-col")}>
        {compact ? media : null}
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <WidgetHeading data-slot="attachment-title">
            <a
              {...openProps}
              href={preview.href}
              aria-label={`Open ${preview.provider} ${preview.typeLabel}: ${preview.title}`}
              className="line-clamp-2 break-words text-foreground no-underline hover:underline focus-visible:rounded-blockui-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {preview.title}
            </a>
          </WidgetHeading>
          {context ? (
            <WidgetCaption data-link-preview-context="">
              {context}
            </WidgetCaption>
          ) : null}
          {expanded && preview.description ? (
            <div
              className={cn(
                "space-y-2 text-sm leading-5 text-muted-foreground",
                compact && "line-clamp-2",
              )}
              data-slot="attachment-description"
            >
              {preview.description.split(/\n{2,}/).map((paragraph, index) => (
                <p
                  className="whitespace-pre-line break-words"
                  // biome-ignore lint/suspicious/noArrayIndexKey: paragraphs are immutable preview metadata, including repeated text.
                  key={`${index}-${paragraph}`}
                >
                  {paragraph}
                </p>
              ))}
            </div>
          ) : null}
        </div>
      </div>
      {!compact && media ? (
        showImage && ImageLightbox && src ? (
          <ImageLightbox
            alt={`Preview from ${preview.imageDomain ?? hostname}`}
            src={src}
            className="block rounded-blockui-md"
          >
            {media}
          </ImageLightbox>
        ) : (
          media
        )
      ) : null}
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2 border-t border-border pt-4">
        <div
          className="flex min-w-0 max-w-full items-center gap-2 text-xs font-medium text-muted-foreground"
          data-link-preview-hostname=""
          data-link-preview-identity=""
        >
          {preview.faviconDataUrl ? (
            <img
              alt=""
              aria-hidden="true"
              className="size-4 shrink-0 rounded-blockui-xs object-contain"
              src={preview.faviconDataUrl}
              data-link-preview-hostname-favicon=""
              data-link-preview-favicon=""
            />
          ) : null}
          <span className="truncate">{hostname}</span>
          <ArrowUpRight aria-hidden="true" className="size-4 shrink-0" />
        </div>
        {!compact &&
        showExpandControl &&
        (preview.description || reserveImage) ? (
          <Action
            type="button"
            aria-expanded={expanded}
            className="flex items-center gap-2 rounded-blockui-sm px-2 py-2 text-xs font-medium text-muted-foreground hover:bg-muted"
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded ? (
              <ChevronUp aria-hidden="true" className="size-4" />
            ) : (
              <ChevronDown aria-hidden="true" className="size-4" />
            )}
            {expanded ? "Show less" : "Show more"}
          </Action>
        ) : null}
      </div>
    </ContentWidget>
  );
}
