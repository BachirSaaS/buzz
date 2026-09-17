import { Grid2X2, Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";
import { ActivityWidget } from "./ActivityWidget";
import { FlightWidget } from "./FlightWidget";
import { InboxWidget } from "./InboxWidget";
import { LocationWidget } from "./LocationWidget";
import { MoodBoardWidget } from "./MoodBoardWidget";
import { MusicWidget } from "./MusicWidget";
import { NewsWidget } from "./NewsWidget";
import { UpNextWidget } from "./UpNextWidget";
import { WeatherWidget } from "./WeatherWidget";
import { Control } from "./Widget";
import { BuzzWidgetGallery } from "./BuzzWidgetGallery";

/** Browser gallery for independent, reusable widget compositions. */
export function WidgetGallery() {
  const [anatomy, setAnatomy] = useState(false);
  const [dark, setDark] = useState(false);
  const [collection, setCollection] = useState<"buzz" | "everyday">("buzz");
  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    return () => document.documentElement.classList.remove("dark");
  }, [dark]);
  return (
    <div
      className={`widget-scope widget-gallery ${anatomy ? "show-anatomy" : ""}`}
    >
      <header className="gallery-bar">
        <a href="#main" className="gallery-brand">
          <span className="block-mark" aria-hidden="true" />
          Block <span className="brand-divider" /> Widgets
        </a>
        <div className="gallery-tools">
          <Control
            className="anatomy-control"
            aria-pressed={anatomy}
            onClick={() => setAnatomy((value) => !value)}
          >
            <Grid2X2 aria-hidden="true" />
            Anatomy
          </Control>
          <Control
            className="icon-control"
            aria-label={dark ? "Use light theme" : "Use dark theme"}
            onClick={() => setDark((value) => !value)}
          >
            {dark ? <Sun aria-hidden="true" /> : <Moon aria-hidden="true" />}
          </Control>
        </div>
      </header>
      <main id="main">
        <div className="gallery-intro">
          <div>
            <p className="intro-kicker">
              {collection === "buzz"
                ? "A little closer to your team"
                : "A collection of everyday things"}
            </p>
            <h1>
              {collection === "buzz"
                ? "Good things happen together."
                : "Your day, at a glance."}
            </h1>
          </div>
          <p className="gallery-context">Thursday, September 17</p>
        </div>
        <fieldset
          className="gallery-collections"
          aria-label="Widget collection"
        >
          <Control
            aria-pressed={collection === "buzz"}
            onClick={() => setCollection("buzz")}
          >
            Buzz
          </Control>
          <Control
            aria-pressed={collection === "everyday"}
            onClick={() => setCollection("everyday")}
          >
            Everyday
          </Control>
        </fieldset>
        {anatomy && (
          <div className="anatomy-key" role="status">
            <span>8px base grid</span>
            <span>24px radius + inset</span>
            <span>≤ 3 sizes · 2 weights per widget</span>
            <span>Cash Sans</span>
          </div>
        )}
        {collection === "buzz" ? (
          <BuzzWidgetGallery />
        ) : (
          <div className="widget-grid">
            <div className="widget-column">
              <LocationWidget />
              <WeatherWidget />
              <FlightWidget />
            </div>
            <div className="widget-column">
              <MusicWidget />
              <NewsWidget />
              <ActivityWidget />
            </div>
            <div className="widget-column">
              <InboxWidget />
              <MoodBoardWidget />
              <UpNextWidget />
            </div>
          </div>
        )}
        <footer className="gallery-footer">
          <span>Small windows. Room for what matters.</span>
          <span>Built with Block UI foundations · Cash Sans</span>
        </footer>
      </main>
    </div>
  );
}
