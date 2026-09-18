import { Columns3, Grid2X2, Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";
import { Control } from "./Widget";
import { GalleryBuzzWidget } from "./BuzzWidgetGallery";
import { canvasWidgets, buzzWidgetCatalog } from "./widgetCatalog";
import { WidgetSizing, type WidgetSize } from "./WidgetSizing";

const sizes: WidgetSize[] = ["small", "medium", "large"];
/** A single set of components, reviewed at three deliberate information densities. */
export function WidgetGallery() {
  const [anatomy, setAnatomy] = useState(false);
  const [dark, setDark] = useState(false);
  const [collection, setCollection] = useState<"buzz" | "everyday">("buzz");
  const [size, setSize] = useState<WidgetSize>("medium");
  const [compare, setCompare] = useState(false);
  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    return () => document.documentElement.classList.remove("dark");
  }, [dark]);
  const items = collection === "buzz" ? buzzWidgetCatalog : canvasWidgets;
  const render = (id: string) => {
    if (collection === "buzz") return <GalleryBuzzWidget id={id} />;
    const Component = canvasWidgets.find(
      (widget) => widget.id === id,
    )?.component;
    return Component ? <Component /> : null;
  };
  return (
    <div
      className={`widget-scope widget-gallery ${anatomy ? "show-anatomy" : ""}`}
    >
      <header className="gallery-bar">
        <a href="#main" className="gallery-brand">
          <span className="block-mark" aria-hidden="true" />
          Block
          <span className="brand-divider" />
          Widgets
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
                ? "Your workspace, at a glance"
                : "A little space for your day"}
            </p>
            <h1>
              {collection === "buzz"
                ? "Closer to the work."
                : "Everyday essentials."}
            </h1>
          </div>
        </div>
        <div className="gallery-view-controls">
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
          <div className="gallery-size-tools">
            <fieldset className="size-controls" aria-label="Widget size">
              {sizes.map((value) => (
                <Control
                  key={value}
                  aria-pressed={!compare && size === value}
                  onClick={() => {
                    setSize(value);
                    setCompare(false);
                  }}
                >
                  {value[0].toUpperCase() + value.slice(1)}
                </Control>
              ))}
            </fieldset>
            <Control
              aria-pressed={compare}
              onClick={() => setCompare((value) => !value)}
            >
              <Columns3 aria-hidden="true" />
              Compare sizes
            </Control>
          </div>
        </div>
        {anatomy && (
          <div className="anatomy-key" role="status">
            <span>8px base grid</span>
            <span>24px radius + inset</span>
            <span>≤ 3 sizes · 2 weights per widget</span>
            <span>Cash Sans</span>
          </div>
        )}
        {compare ? (
          <div className="widget-comparisons">
            {items.map((widget) => (
              <section
                className="widget-comparison"
                key={widget.id}
                aria-label={`${widget.title} size comparison`}
              >
                <h2>{widget.title}</h2>
                <div className="comparison-grid">
                  {sizes.map((value) => (
                    <div className="comparison-example" key={value}>
                      <p className="size-caption">{value}</p>
                      <WidgetSizing size={value}>
                        {render(widget.id)}
                      </WidgetSizing>
                    </div>
                  ))}
                </div>
              </section>
            ))}
          </div>
        ) : (
          <div className="sized-widget-grid" data-gallery-size={size}>
            {items.map((widget) => (
              <WidgetSizing key={widget.id} size={size}>
                {render(widget.id)}
              </WidgetSizing>
            ))}
          </div>
        )}
        <footer className="gallery-footer">
          <span>Small, medium, large. Only what earns its space.</span>
          <span>Block UI · Cash Sans</span>
        </footer>
      </main>
    </div>
  );
}
