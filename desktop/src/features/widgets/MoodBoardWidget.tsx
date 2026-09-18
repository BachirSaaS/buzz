import { Action } from "@/shared/ui/action";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useState } from "react";
import { moodPhotos } from "./data";
import { Control, DetailDialog, Widget } from "./Widget";
import { useWidgetSize } from "./WidgetSizing";

/** An image-led board with a keyboard-accessible photo viewer. */
export function MoodBoardWidget({
  photos = moodPhotos,
}: {
  photos?: typeof moodPhotos;
}) {
  const [selected, setSelected] = useState<number | null>(null);
  const size = useWidgetSize();
  const photo = selected === null ? null : photos[selected];
  return (
    <Widget title="Mood board" className="mood-widget" scale="14 / 16 / 24">
      <div className="mood-grid">
        {photos.slice(0, size === "small" ? 2 : 4).map((item, index) => (
          <Action
            type="button"
            key={item.src}
            onClick={() => setSelected(index)}
            aria-label={`Enlarge photo: ${item.alt}`}
          >
            <img src={item.src} alt={item.alt} />
          </Action>
        ))}
      </div>
      {photo && (
        <DetailDialog
          title="A slower kind of day"
          onClose={() => setSelected(null)}
        >
          <img className="photo-viewer" src={photo.src} alt={photo.alt} />
          <div className="photo-navigation">
            <Control
              className="icon-control"
              aria-label="Previous photo"
              onClick={() =>
                setSelected(
                  (index) => ((index ?? 0) + photos.length - 1) % photos.length,
                )
              }
            >
              <ChevronLeft aria-hidden="true" />
            </Control>
            <p className="small subtle" aria-live="polite">
              {(selected ?? 0) + 1} of {photos.length}
            </p>
            <Control
              className="icon-control"
              aria-label="Next photo"
              onClick={() =>
                setSelected((index) => ((index ?? 0) + 1) % photos.length)
              }
            >
              <ChevronRight aria-hidden="true" />
            </Control>
          </div>
        </DetailDialog>
      )}
    </Widget>
  );
}
