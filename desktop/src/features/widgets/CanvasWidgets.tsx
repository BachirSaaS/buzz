import type { CanvasFeed } from "@/features/pulse/ui/CanvasWindowContent";
import type { CanvasView } from "@/features/pulse/lib/canvasLayout";
import { BuzzCanvasWidget, buzzWidgetCatalog } from "./BuzzCanvasWidgets";
import { ActivityWidget } from "./ActivityWidget";
import { FlightWidget } from "./FlightWidget";
import { InboxWidget } from "./InboxWidget";
import { LocationWidget } from "./LocationWidget";
import { MoodBoardWidget } from "./MoodBoardWidget";
import { MusicWidget } from "./MusicWidget";
import { NewsWidget } from "./NewsWidget";
import { UpNextWidget } from "./UpNextWidget";
import { WeatherWidget } from "./WeatherWidget";
import "./widgets.css";

/** Stable IDs are persisted in the existing community-scoped canvas layout. */
export const canvasWidgets = [
  { id: "location", title: "Location", component: LocationWidget },
  { id: "weather", title: "Weather", component: WeatherWidget },
  { id: "news", title: "News", component: NewsWidget },
  { id: "music", title: "Music", component: MusicWidget },
  { id: "flight", title: "Flight", component: FlightWidget },
  { id: "inbox", title: "Inbox", component: InboxWidget },
  { id: "mood-board", title: "Mood board", component: MoodBoardWidget },
  { id: "up-next", title: "Up next", component: UpNextWidget },
  { id: "activity", title: "Activity", component: ActivityWidget },
] as const;

/** Independent widgets or a collection, embedded directly in Pulse. */
export function CanvasWidgets({
  target,
  feed,
  currentPubkey,
  onOpen,
}: {
  target?: string;
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
          <BuzzCanvasWidget
            key={widget.id}
            id={widget.id}
            feed={feed}
            currentPubkey={currentPubkey}
            onOpen={onOpen}
          />
        ))}
        {items.map(({ id, component: Component }) => (
          <Component key={id} />
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
