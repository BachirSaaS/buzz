import { useLayoutEffect, useRef } from "react";
import { GalleryBuzzWidget } from "./BuzzWidgetGallery";
import { MusicWidget } from "./MusicWidget";
import { WidgetSizing } from "./WidgetSizing";
import { canvasWidgets } from "./widgetCatalog";
import "./widgets.css";

/** Real small compositions with isolated gallery data and no interactive preview controls. */
export function WidgetPreview({ target }: { target: string }) {
  const frame = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const collection = target === "all" || target === "buzz";
  const ids =
    target === "all"
      ? ["weather", "music", "agent-activity", "huddle"]
      : target === "buzz"
        ? ["agent-activity", "huddle", "mentions", "conversations"]
        : [target];
  useLayoutEffect(() => {
    const outer = frame.current,
      inner = content.current;
    if (!outer || !inner) return;
    const fit = () => {
      const scale = Math.min(
        1,
        (outer.clientWidth - 16) / inner.offsetWidth,
        (outer.clientHeight - 16) / inner.offsetHeight,
      );
      inner.style.transform = `translate(-50%, -50%) scale(${Math.max(0, scale)})`;
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(outer);
    observer.observe(inner);
    return () => observer.disconnect();
  }, []);
  return (
    <div
      ref={frame}
      className="canvas-preview canvas-widget-preview"
      data-preview={target}
      inert
      aria-hidden="true"
    >
      <div
        ref={content}
        className="widget-scope canvas-widget-preview-content"
        data-collection={collection || undefined}
      >
        {ids.map((id) => {
          const Component = canvasWidgets.find(
            (widget) => widget.id === id,
          )?.component;
          return (
            <WidgetSizing key={id} size="small">
              {id === "music" ? (
                <MusicWidget preview />
              ) : Component ? (
                <Component />
              ) : (
                <GalleryBuzzWidget id={id} />
              )}
            </WidgetSizing>
          );
        })}
      </div>
    </div>
  );
}
