import {
  CircleDot,
  FileText,
  Folder,
  GitPullRequest,
  Globe,
  Presentation,
  Table2,
  GitFork,
} from "lucide-react";
import type { MouseEvent } from "react";
import type { ResolvedLinkPreview } from "@/shared/lib/useResolvedLinkPreviews";
import { cn } from "@/shared/lib/cn";
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

/** A link uses the same compact surface and colors as its surrounding message. */
export function LinkPreviewWidget({
  className,
  onOpen,
  onRemove,
  preview,
  showControls = false,
}: {
  className?: string;
  /** Accepted for older callers; both legacy layouts now use a text bubble. */
  compact?: boolean;
  ImageLightbox?: LinkPreviewImageLightboxComponent;
  onOpen?: () => void;
  onRemove?: () => void;
  preview: ResolvedLinkPreview;
  showControls?: boolean;
  showExpandControl?: boolean;
}) {
  const { Icon, hostname, context, type } = previewIdentity(preview);
  const source = context
    ? `${preview.provider} · ${type} · ${context}`
    : preview.kind === "generic-link"
      ? hostname
      : `${preview.provider} · ${type}`;
  return (
    <div
      className={cn(
        "link-message-bubble relative isolate flex w-fit max-w-sm items-start gap-2 rounded-blockui-lg px-3.5 py-2 font-sans text-message leading-snug",
        className,
      )}
      data-block-media=""
      data-link-preview={preview.kind}
    >
      <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <div className="min-w-0 flex-1">
        <a
          href={preview.href}
          rel="noreferrer"
          target="_blank"
          onClick={
            onOpen
              ? (event: MouseEvent<HTMLAnchorElement>) => {
                  event.preventDefault();
                  onOpen();
                }
              : undefined
          }
          aria-label={`Open ${preview.provider} ${preview.typeLabel}: ${preview.title}`}
          className="line-clamp-2 break-words font-normal text-inherit no-underline after:absolute after:inset-0 after:z-10 after:rounded-[inherit] after:content-[''] hover:underline focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-inset focus-visible:after:ring-ring"
          data-slot="attachment-title"
        >
          {preview.title || hostname}
        </a>
        <div
          className="mt-0.5 truncate text-xs leading-4 opacity-70"
          data-link-preview-context=""
          title={source}
        >
          {source}
        </div>
      </div>
      {showControls && onRemove ? (
        <LinkPreviewControls onRemove={onRemove} />
      ) : null}
    </div>
  );
}
