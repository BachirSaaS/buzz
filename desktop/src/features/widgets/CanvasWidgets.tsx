import type { CanvasFeed } from "@/features/pulse/ui/CanvasWindowContent";
import type { CanvasView } from "@/features/pulse/lib/canvasLayout";
import { BuzzCanvasWidget, buzzWidgetCatalog } from "./BuzzCanvasWidgets";
import { canvasWidgets } from "./widgetCatalog";
import { WidgetSizing, type WidgetSize } from "./WidgetSizing";
import "./widgets.css";

export { canvasWidgets } from "./widgetCatalog";

/** Independent widgets or a collection, embedded directly in Pulse. */
export function CanvasWidgets({
  target,
  size = "auto",
  feed,
  currentPubkey,
  onOpen,
}: {
  target?: string;
  size?: WidgetSize | "auto";
  feed: CanvasFeed;
  currentPubkey?: string;
  onOpen: (view: CanvasView, thread?: string) => void;
}) {
  const items =
    target === "all"
      ? canvasWidgets
      : canvasWidgets.filter((widget) => widget.id === target);
  const buzzItems =
    target === "all" || target === "buzz"
      ? buzzWidgetCatalog
      : buzzWidgetCatalog.filter((widget) => widget.id === target);
  return (
    <div
      className="widget-scope canvas-widget-content"
      data-testid="canvas-widget-content"
    >
      <div
        className={
          target === "all" || target === "buzz"
            ? "canvas-widget-collection"
            : "canvas-widget-single"
        }
      >
        {buzzItems.map((widget) => (
          <WidgetSizing key={widget.id} size={size}>
            <BuzzCanvasWidget
              id={widget.id}
              feed={feed}
              currentPubkey={currentPubkey}
              onOpen={onOpen}
            />
          </WidgetSizing>
        ))}
        {items.map(({ id, component: Component }) => (
          <WidgetSizing key={id} size={size}>
            <Component />
          </WidgetSizing>
        ))}
      </div>
      {!items.length && !buzzItems.length && (
        <p>
          That widget is unavailable. Close this view and add another widget.
        </p>
      )}
    </div>
  );
}
