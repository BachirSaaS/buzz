import {
  useEffect,
  useRef,
  useState,
  type PointerEvent,
  type KeyboardEvent,
} from "react";
import {
  setContentSize,
  setContentWidth,
  type ContentSize,
} from "@/shared/lib/contentWidthPreference";

/** Center-anchored resizing with one persist on release and cancellation on interruption. */
export function useWorkspaceResize() {
  const host = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState<ContentSize | null>(null);
  const drag = useRef<{
    pointerId: number;
    x: number;
    y: number;
    start: ContentSize;
    next: ContentSize;
  } | null>(null);
  const [announcement, setAnnouncement] = useState("");
  function cancel() {
    drag.current = null;
    setDraft(null);
  }
  useEffect(() => {
    const onBlur = () => {
      drag.current = null;
      setDraft(null);
    };
    window.addEventListener("blur", onBlur);
    return () => window.removeEventListener("blur", onBlur);
  }, []);
  function bounds(size: ContentSize): ContentSize {
    const maxWidth = host.current?.clientWidth ?? size.width;
    const maxHeight = host.current?.clientHeight ?? size.height;
    return {
      width: Math.min(maxWidth, Math.max(Math.min(360, maxWidth), size.width)),
      height: Math.min(
        maxHeight,
        Math.max(Math.min(280, maxHeight), size.height),
      ),
    };
  }
  function commit(size: ContentSize) {
    setContentSize(size);
    setAnnouncement(
      `Content size ${Math.round(size.width)} by ${Math.round(size.height)} pixels`,
    );
  }
  function onPointerDown(event: PointerEvent<HTMLButtonElement>) {
    if (
      event.button !== 0 ||
      !event.isPrimary ||
      drag.current ||
      !panel.current
    )
      return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.focus({ preventScroll: true });
    event.currentTarget.setPointerCapture(event.pointerId);
    const start = {
      width: panel.current.offsetWidth,
      height: panel.current.offsetHeight,
    };
    drag.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      start,
      next: start,
    };
  }
  function onPointerMove(event: PointerEvent<HTMLButtonElement>) {
    const current = drag.current;
    if (!current || event.pointerId !== current.pointerId) return;
    const rect = host.current?.getBoundingClientRect();
    const scale = rect?.width
      ? (host.current?.clientWidth ?? rect.width) / rect.width
      : 1;
    current.next = bounds({
      width: current.start.width + 2 * (event.clientX - current.x) * scale,
      height: current.start.height + 2 * (event.clientY - current.y) * scale,
    });
    setDraft(current.next);
  }
  function onPointerUp(event: PointerEvent<HTMLButtonElement>) {
    if (event.pointerId !== drag.current?.pointerId) return;
    onPointerMove(event);
    const next = drag.current.next;
    drag.current = null;
    commit(next);
    setDraft(null);
    event.currentTarget.releasePointerCapture(event.pointerId);
  }
  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "Escape" && drag.current) {
      event.preventDefault();
      cancel();
      return;
    }
    if (drag.current || event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.key === "Home") {
      event.preventDefault();
      setContentWidth("standard");
      setAnnouncement("Standard content size");
      return;
    }
    if (
      !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(
        event.key,
      ) ||
      !panel.current
    )
      return;
    event.preventDefault();
    event.stopPropagation();
    const step = event.shiftKey ? 64 : 16;
    commit(
      bounds({
        width:
          panel.current.offsetWidth +
          (event.key === "ArrowRight"
            ? step
            : event.key === "ArrowLeft"
              ? -step
              : 0),
        height:
          panel.current.offsetHeight +
          (event.key === "ArrowDown"
            ? step
            : event.key === "ArrowUp"
              ? -step
              : 0),
      }),
    );
  }
  return {
    host,
    panel,
    draft,
    announcement,
    handleProps: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel: (event: PointerEvent<HTMLButtonElement>) => {
        if (event.pointerId === drag.current?.pointerId) cancel();
      },
      onLostPointerCapture: (event: PointerEvent<HTMLButtonElement>) => {
        if (event.pointerId === drag.current?.pointerId) cancel();
      },
      onKeyDown,
      onDoubleClick: () => {
        cancel();
        setContentWidth("standard");
      },
    },
  };
}
