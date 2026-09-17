import type { CanvasFrame, CanvasLayout } from "./canvasLayout";

export type CanvasBounds = { width: number; height: number };

/** Keep the whole window and its controls reachable inside the padded canvas. */
export function fitCanvasFrame(
  frame: CanvasFrame,
  bounds: CanvasBounds,
  maximum = bounds.width,
): CanvasFrame {
  const width = Math.max(
    1,
    Math.min(bounds.width, maximum, Math.max(240, frame.width)),
  );
  const height = Math.max(
    1,
    Math.min(bounds.height, Math.max(180, frame.height)),
  );
  return {
    width,
    height,
    x: Math.max(0, Math.min(bounds.width - width, frame.x)),
    y: Math.max(0, Math.min(bounds.height - height, frame.y)),
  };
}

/** Cascade newly added windows without discarding earlier placements. */
export function defaultCanvasFrame(
  index: number,
  bounds: CanvasBounds,
  mainMax: number,
): CanvasFrame {
  return fitCanvasFrame(
    {
      x: index * 64,
      y: index * 48,
      width: index === 0 ? mainMax : 440,
      height: index === 0 ? bounds.height : Math.min(520, bounds.height),
    },
    bounds,
    index === 0 ? mainMax : bounds.width,
  );
}

/** Capture current tiled geometry before lifting windows into freeform mode. */
export function captureCanvasFrames(
  canvas: HTMLElement | null,
): Record<string, CanvasFrame> {
  if (!canvas) return {};
  const origin = canvas.getBoundingClientRect();
  const frames: Record<string, CanvasFrame> = {};
  for (const element of canvas.querySelectorAll<HTMLElement>(
    "[data-canvas-frame]",
  )) {
    const id = element.dataset.canvasFrame;
    if (!id || (id === "main" && canvas.dataset.fixedMain)) continue;
    const box = element.getBoundingClientRect();
    frames[id] = {
      x: Math.max(0, box.x - origin.x),
      y: Math.max(0, box.y - origin.y),
      width: box.width,
      height: box.height,
    };
  }
  return frames;
}

/** Remove a companion and its position/stacking metadata in one snapshot. */
export function withoutCanvasWindow(
  state: CanvasLayout,
  id: string,
): CanvasLayout {
  const next = {
    ...state,
    windows: state.windows.filter((window) => window !== id),
  };
  if (state.freeform) {
    const frames = { ...state.freeform.frames };
    delete frames[id];
    next.freeform = {
      frames,
      order: state.freeform.order.filter((window) => window !== id),
    };
  }
  return next;
}
