import {
  Check,
  CircleDot,
  FolderGit2,
  GitCommitHorizontal,
  GitPullRequest,
  MessageSquare,
  TriangleAlert,
  UserPlus,
} from "lucide-react";
import type { ComponentType } from "react";

import { cn } from "@/shared/lib/cn";

export type ProjectEventKind =
  | "repository"
  | "commit"
  | "pull-request"
  | "issue"
  | "comment"
  | "approval"
  | "changes-requested"
  | "review-request";

export const PROJECT_EVENT_VISUALS: Record<
  ProjectEventKind,
  {
    icon: ComponentType<{ className?: string }>;
    iconClassName: string;
    badgeClassName: string;
    detailClassName: string;
  }
> = {
  repository: {
    icon: FolderGit2,
    iconClassName: "text-primary",
    badgeClassName: "bg-primary/10 text-primary",
    detailClassName: "border-primary/30 text-primary",
  },
  commit: {
    icon: GitCommitHorizontal,
    iconClassName: "text-primary",
    badgeClassName: "bg-primary/10 text-primary",
    detailClassName: "border-primary/30 text-primary",
  },
  "pull-request": {
    icon: GitPullRequest,
    iconClassName: "text-success-foreground dark:text-success-foreground",
    badgeClassName:
      "bg-success text-success-foreground dark:bg-success dark:text-success-foreground",
    detailClassName:
      "border-success-foreground/30 text-success-foreground dark:border-success-foreground/30 dark:text-success-foreground",
  },
  issue: {
    icon: CircleDot,
    iconClassName: "text-warning-foreground",
    badgeClassName:
      "bg-warning text-warning-foreground dark:text-warning-foreground",
    detailClassName:
      "border-warning-foreground/30 text-warning-foreground dark:border-warning-foreground/30 dark:text-warning-foreground",
  },
  comment: {
    icon: MessageSquare,
    iconClassName: "text-muted-foreground",
    badgeClassName: "bg-muted text-muted-foreground",
    detailClassName: "border-border/60 text-muted-foreground",
  },
  approval: {
    icon: Check,
    iconClassName: "text-success-foreground dark:text-success-foreground",
    badgeClassName:
      "bg-success text-success-foreground dark:bg-success dark:text-success-foreground",
    detailClassName:
      "border-success-foreground/30 text-success-foreground dark:border-success-foreground/30 dark:text-success-foreground",
  },
  "changes-requested": {
    icon: TriangleAlert,
    iconClassName: "text-warning-foreground dark:text-warning-foreground",
    badgeClassName:
      "bg-warning text-warning-foreground dark:bg-warning dark:text-warning-foreground",
    detailClassName:
      "border-warning-foreground/30 text-warning-foreground dark:text-warning-foreground",
  },
  "review-request": {
    icon: UserPlus,
    iconClassName: "text-info-foreground dark:text-info-foreground",
    badgeClassName:
      "bg-info text-info-foreground dark:bg-info dark:text-info-foreground",
    detailClassName:
      "border-info-foreground/30 text-info-foreground dark:border-info-foreground/30 dark:text-info-foreground",
  },
};

export function ProjectEventTypeIcon({
  className,
  kind,
}: {
  className?: string;
  kind: ProjectEventKind;
}) {
  const visual = PROJECT_EVENT_VISUALS[kind];
  const Icon = visual.icon;

  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full ring-1 ring-border/60",
        visual.badgeClassName,
        className,
      )}
    >
      <Icon className={cn("h-3 w-3", visual.iconClassName)} />
    </span>
  );
}
