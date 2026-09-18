import { ActivityWidget } from "./ActivityWidget";
import { FlightWidget } from "./FlightWidget";
import { InboxWidget } from "./InboxWidget";
import { LocationWidget } from "./LocationWidget";
import { MoodBoardWidget } from "./MoodBoardWidget";
import { MusicWidget } from "./MusicWidget";
import { NewsWidget } from "./NewsWidget";
import { UpNextWidget } from "./UpNextWidget";
import { WeatherWidget } from "./WeatherWidget";

/** Stable IDs shared by the gallery and persisted Pulse views. */
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
/** Buzz adapters own data access; this catalog is safe in the standalone gallery. */
export const buzzWidgetCatalog = [
  { id: "agent-activity", title: "Agent activity" },
  { id: "huddle", title: "Huddle" },
  { id: "mentions", title: "Mentions" },
  { id: "conversations", title: "Conversations" },
  { id: "channels", title: "Active channels" },
] as const;
