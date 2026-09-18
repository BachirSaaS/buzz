import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";

/** Sizes change content priority as well as the composition's footprint. */
export type WidgetSize = "small" | "medium" | "large";
const SizeContext = createContext<WidgetSize>("medium");
/** Read the host's presentation size without changing the widget's data source. */
export const useWidgetSize = () => useContext(SizeContext);
/** Explicit sizes for the gallery; actual available width drives widgets in Pulse. */
export function WidgetSizing({
  size = "auto",
  children,
}: {
  size?: WidgetSize | "auto";
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [automatic, setAutomatic] = useState<WidgetSize>("medium");
  useEffect(() => {
    const element = ref.current;
    if (!element || size !== "auto") return;
    const observer = new ResizeObserver(([entry]) => {
      const width = entry.contentRect.width;
      if (width > 0)
        setAutomatic(width < 320 ? "small" : width < 432 ? "medium" : "large");
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [size]);
  const resolved = size === "auto" ? automatic : size;
  return (
    <div ref={ref} className="widget-slot" data-widget-size={resolved}>
      <SizeContext.Provider value={resolved}>{children}</SizeContext.Provider>
    </div>
  );
}
