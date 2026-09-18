import { Action } from "@/shared/ui/action";
import { ArrowUpRight } from "lucide-react";
import { useState } from "react";
import { type Headline, headlines } from "./data";
import { DetailDialog, Widget } from "./Widget";
import { useWidgetSize } from "./WidgetSizing";

/** Three headlines with progressively disclosed article previews. */
export function NewsWidget({ stories = headlines }: { stories?: Headline[] }) {
  const [open, setOpen] = useState<Headline | null>(null);
  const size = useWidgetSize();
  return (
    <Widget title="News" className="news-widget" scale="14 / 16 / 24">
      <div className="news-list">
        {stories.slice(0, size === "small" ? 1 : 3).map((story, index) => (
          <Action
            type="button"
            key={story.id}
            className="news-row"
            onClick={() => setOpen(story)}
          >
            <div>
              <p className="small subtle">{story.source}</p>
              <h4>{story.title}</h4>
              {size === "large" && index === 0 && (
                <p className="small subtle news-summary">{story.summary}</p>
              )}
            </div>
            {size === "large" && <img src={story.image} alt="" />}
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
