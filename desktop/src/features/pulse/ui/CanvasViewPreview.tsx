import {
  Bot,
  Folder,
  Hash,
  MessageCircle,
  LayoutGrid,
  PanelsTopLeft,
} from "lucide-react";
import { WidgetPreview } from "@/features/widgets/WidgetPreview";
import type { CanvasView } from "../lib/canvasLayout";
/** Widget previews use the real small composition; other views keep a compact schematic. */
export function CanvasViewPreview({ view }: { view: CanvasView }) {
  const target = view.target ?? view.kind;
  if (view.kind === "widget") return <WidgetPreview target={target} />;
  if (view.kind === "app" && (target === "conversation" || target === "agents"))
    return (
      <WidgetPreview
        target={target === "conversation" ? "conversations" : "agent-activity"}
      />
    );
  const Icon = {
    app: PanelsTopLeft,
    channel: Hash,
    dm: MessageCircle,
    project: Folder,
    agents: Bot,
    widget: LayoutGrid,
  }[view.kind];
  return (
    <span aria-hidden="true" className="canvas-preview" data-preview={target}>
      <span className="preview-heading">
        <Icon className="size-5" />
        <span className="preview-line" />
      </span>
      {[0, 1, 2].map((i) => (
        <span key={i} className="preview-row">
          {view.kind === "dm" ||
          target === "conversations" ||
          target === "mentions" ||
          target === "agent-activity" ? (
            <span className="preview-avatar" />
          ) : (
            <span className="preview-dot" />
          )}
          <span className={`preview-line ${i === 2 ? "short" : ""}`} />
        </span>
      ))}
    </span>
  );
}
