import { Action } from "@/shared/ui/action";
import { ArrowUpRight } from "lucide-react";
import { useState } from "react";
import { type Headline, headlines } from "./data";
import { DetailDialog, Widget } from "./Widget";

/** Three headlines with progressively disclosed article previews. */
export function NewsWidget({ stories = headlines }: { stories?: Headline[] }) {
  const [open, setOpen] = useState<Headline | null>(null);
  return (
    <Widget title="News" scale="14 / 16 / 24">
      <h3 className="section-anchor">Today’s headlines</h3>
      <div className="news-list">
        {stories.slice(0, 3).map((story) => (
          <Action
            type="button"
            key={story.id}
            className="news-row"
            onClick={() => setOpen(story)}
          >
            <div>
              <p className="small subtle">{story.source}</p>
              <h4>{story.title}</h4>
            </div>
            <img src={story.image} alt="" />
            <ArrowUpRight aria-hidden="true" className="row-arrow" />
          </Action>
        ))}
      </div>
      {open && (
        <DetailDialog title={open.title} onClose={() => setOpen(null)}>
          <p className="small subtle">{open.source}</p>
          <img className="detail-image" src={open.image} alt="" />
          <p>{open.summary}</p>
        </DetailDialog>
      )}
    </Widget>
  );
}
