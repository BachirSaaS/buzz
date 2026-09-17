import { ArrowUpRight, Video } from "lucide-react";
import { useState } from "react";
import { attendees } from "./data";
import { Control, DetailDialog, Widget } from "./Widget";

/** Preview an event and attendees without implying a live calendar connection. */
export function UpNextWidget({
  title = "A little room to explore",
  people = attendees,
}: {
  title?: string;
  people?: typeof attendees;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Widget title="Up next" scale="14 / 16 / 24">
      <div className="calendar-time">
        <div className="date-tile">
          <span className="small">SEP</span>
          <strong>17</strong>
        </div>
        <div>
          <p>11:00–11:45 AM</p>
          <p className="small subtle">Today · Pacific time</p>
        </div>
      </div>
      <h3 className="section-anchor">{title}</h3>
      <div className="attendees">
        <div className="avatar-stack" aria-hidden="true">
          {people.slice(0, 3).map((person) => (
            <span className="avatar" key={person.name}>
              {person.initials}
            </span>
          ))}
        </div>
        <p className="small subtle">
          {people
            .map((p) => (p.name === "You" ? "you" : p.name.split(" ")[0]))
            .join(", ")}
        </p>
      </div>
      <Control className="event-action" onClick={() => setOpen(true)}>
        <Video aria-hidden="true" />
        <span>View event</span>
        <ArrowUpRight aria-hidden="true" />
      </Control>
      {open && (
        <DetailDialog title={title} onClose={() => setOpen(false)}>
          <p>Thursday, September 17 · 11:00–11:45 AM Pacific</p>
          <p>
            A working session to share references and explore the next set of
            ideas.
          </p>
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
