import type { SupportedLinkPreviewKind } from "@/shared/lib/linkPreview";
import type { ResolvedLinkPreview } from "@/shared/lib/useResolvedLinkPreviews";

// Synthetic fixtures only. The gallery never resolves metadata or reads relay data.
const samples = {
  "github-pull-request": [
    "GitHub",
    "PR",
    "Make the Home feed easier to scan",
    "https://github.com/example/buzz/pull/128",
    "Groups recent conversations into focused summaries, with smaller previews and a clearer path back to the thread.",
  ],
  "github-issue": [
    "GitHub",
    "issue",
    "Keep keyboard focus when a menu closes",
    "https://github.com/example/buzz/issues/142",
    "Return focus to the action that opened the menu. Covers keyboard navigation and nested menus.",
  ],
  "github-repository": [
    "GitHub",
    "repo",
    "A shared place for people and agents",
    "https://github.com/example/buzz",
    "An open source workspace for conversations, projects, and agents.",
  ],
  "linear-issue": [
    "Linear",
    "issue",
    "DES-248 · Refine the workflow editor",
    "https://linear.app/example/issue/DES-248",
    "Bring the canvas, inspector, and menus onto the same spacing and surface system.",
  ],
  "google-drive-file": [
    "Google Drive",
    "file",
    "Launch identity assets.zip",
    "https://drive.google.com/file/d/sample/view",
    "Icons, illustrations, and export-ready assets for the next release.",
  ],
  "google-drive-folder": [
    "Google Drive",
    "folder",
    "Brand explorations",
    "https://drive.google.com/drive/folders/sample",
    "A working collection of references, typography studies, and interface explorations.",
  ],
  "google-docs-document": [
    "Google Docs",
    "document",
    "Design review · September",
    "https://docs.google.com/document/d/sample/edit",
    "A shared agenda for the next design review.\n\nTopics include Home summaries, agent discovery, and workflow authoring.",
  ],
  "google-sheets-spreadsheet": [
    "Google Sheets",
    "spreadsheet",
    "Launch checklist",
    "https://docs.google.com/spreadsheets/d/sample/edit",
    "Milestones, owners, and readiness checks for the release.",
  ],
  "google-slides-presentation": [
    "Google Slides",
    "presentation",
    "A calmer way to catch up",
    "https://docs.google.com/presentation/d/sample/edit",
    "From a wall of messages to a small set of useful places to focus.",
  ],
  "buzz-pull-request": [
    "Buzz",
    "Review",
    "Simplify the activity card layout",
    "buzz://pr?sample=gallery",
    "A local repository review with context from the team conversation.",
  ],
  "buzz-issue": [
    "Buzz",
    "Task",
    "Polish the agent setup flow",
    "buzz://issue?sample=gallery",
    "Clarify the difference between creating an agent and browsing existing agents.",
  ],
  "buzz-repository": [
    "Buzz",
    "repo",
    "Interface experiments",
    "buzz://repo?sample=gallery",
    "A community repository for exploring the next version of the desktop experience.",
  ],
  "buzz-project": [
    "Buzz",
    "project",
    "The next chapter",
    "buzz://project?sample=gallery",
    "A shared home for decisions, tasks, reviews, and the people moving them forward.",
  ],
  "generic-link": [
    "Figma",
    "link",
    "Home · Interface explorations",
    "https://www.figma.com/design/sample",
    "Early explorations of a people-first activity feed and rich conversation previews.",
  ],
} satisfies Record<
  SupportedLinkPreviewKind,
  [string, ResolvedLinkPreview["typeLabel"], string, string, string]
>;

export const linkCardSamples: ResolvedLinkPreview[] = Object.entries(
  samples,
).map(([kind, [provider, typeLabel, title, href, description]]) => ({
  kind: kind as SupportedLinkPreviewKind,
  provider,
  typeLabel,
  title,
  href,
  description,
  imageState: "none",
}));

// A local illustration of a document, not a screenshot of a real provider.
export const sampleImage = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="960" height="500" viewBox="0 0 960 500"><rect width="960" height="500" fill="#e8e8e8"/><rect x="80" y="56" width="800" height="388" rx="32" fill="#fff"/><rect x="120" y="96" width="48" height="48" rx="16" fill="#171717"/><rect x="192" y="108" width="240" height="24" rx="12" fill="#d1d1d1"/><rect x="120" y="184" width="448" height="24" rx="12" fill="#171717"/><rect x="120" y="232" width="336" height="16" rx="8" fill="#d1d1d1"/><rect x="120" y="296" width="344" height="108" rx="24" fill="#f5f5f5"/><rect x="488" y="296" width="344" height="108" rx="24" fill="#f5f5f5"/></svg>')}`;
