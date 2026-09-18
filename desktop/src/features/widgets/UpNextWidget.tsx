import { ChevronRight } from "lucide-react";
import { useState } from "react";
import { Action } from "@/shared/ui/action";
import { WidgetPeople } from "./BuzzWidgets";
import { attendees } from "./data";
import { DetailDialog, Widget } from "./Widget";
import { useWidgetSize } from "./WidgetSizing";

/** One event, one time treatment, with attendees disclosed as space allows. */
export function UpNextWidget({
  title = "Design catch-up",
  people = attendees,
}: {
  title?: string;
  people?: typeof attendees;
}) {
  const [open, setOpen] = useState(false);
  const size = useWidgetSize();
  const participants = people.map((person) => ({
    id: person.name,
    name: person.name,
  }));
  return (
    <Widget title="Up next" scale="14 / 16 / 24" className="up-next-widget">
      <Action
        className="event-summary"
        aria-label="View event"
        onClick={() => setOpen(true)}
      >
        <span>
          <span className="section-anchor event-title">{title}</span>
          <span className="small subtle event-time">
            Today · 11:00–11:45 AM Pacific
          </span>
        </span>
        <ChevronRight aria-hidden="true" />
      </Action>
      {size === "medium" && <WidgetPeople people={participants} />}
      {size === "large" && (
        <>
          <p className="small subtle">
            Share references and decide what to explore next.
          </p>
          <div className="participant-roster">
            {participants.map((person) => (
              <div className="participant-entry" key={person.id}>
                <WidgetPeople people={[person]} />
                <span>{person.name}</span>
              </div>
            ))}
          </div>
        </>
      )}
      {open && (
        <DetailDialog title={title} onClose={() => setOpen(false)}>
          <p>Thursday, September 17 · 11:00–11:45 AM Pacific</p>
          <p>Share references and decide what to explore next.</p>
          <p className="subtle">Attendees</p>
          <ul>
            {people.map((person) => (
              <li key={person.name}>{person.name}</li>
            ))}
          </ul>
        </DetailDialog>
      )}
    </Widget>
  );
}
