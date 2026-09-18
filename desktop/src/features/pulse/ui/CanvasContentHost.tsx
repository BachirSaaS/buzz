import { useLayoutEffect, useRef } from "react";
/** Moving a stable portal host preserves conversation drafts and subscriptions. */
export function CanvasContentHost({ host }: { host?: HTMLDivElement }) {
  const slot = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const container = slot.current;
    if (!host || !container) return;
    container.replaceChildren(host);
    return () => {
      // A reparented host may already belong to another slot. Leave it there.
      if (host.parentNode === container) host.remove();
    };
  }, [host]);
  return <div ref={slot} className="canvas-content-slot" />;
}
