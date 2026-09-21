import type { CanvasFrame, CanvasLayout } from "../lib/canvasLayout";
import { fitCanvasFrame, type CanvasBounds } from "../lib/freeformCanvas";
import { parentWindowIds } from "../lib/parentWindows";

// Fractions of the available Buzz canvas, independent of display resolution.
const regions = {
  left_half: [0, 0, 0.5, 1],
  right_half: [0.5, 0, 0.5, 1],
  top_half: [0, 0, 1, 0.5],
  bottom_half: [0, 0.5, 1, 0.5],
  left_third: [0, 0, 1 / 3, 1],
  middle_third: [1 / 3, 0, 1 / 3, 1],
  right_third: [2 / 3, 0, 1 / 3, 1],
  top_third: [0, 0, 1, 1 / 3],
  center_third: [0, 1 / 3, 1, 1 / 3],
  bottom_third: [0, 2 / 3, 1, 1 / 3],
  left_two_thirds: [0, 0, 2 / 3, 1],
  right_two_thirds: [1 / 3, 0, 2 / 3, 1],
  top_two_thirds: [0, 0, 1, 2 / 3],
  bottom_two_thirds: [0, 1 / 3, 1, 2 / 3],
  top_left_quarter: [0, 0, 0.5, 0.5],
  top_right_quarter: [0.5, 0, 0.5, 0.5],
  bottom_left_quarter: [0, 0.5, 0.5, 0.5],
  bottom_right_quarter: [0.5, 0.5, 0.5, 0.5],
  full: [0, 0, 1, 1],
} satisfies Record<string, number[]>;
export const areaChoices = {
  ...Object.fromEntries(
    Object.keys(regions).map((id) => [
      id,
      `Fill the ${id.replaceAll("_", " ")} of the canvas (move AND resize)`,
    ]),
  ),
  left: "Move to left edge, keeping size",
  right: "Move to right edge, keeping size",
  top: "Move to top edge, keeping size",
  bottom: "Move to bottom edge, keeping size",
  center: "Center the window, keeping size",
  top_left: "Move to top left corner, keeping size",
  top_right: "Move to top right corner, keeping size",
  bottom_left: "Move to bottom left corner, keeping size",
  bottom_right: "Move to bottom right corner, keeping size",
};
export const sizeChoices = {
  bigger:
    "Bigger: increase width and height (default 25%, or the explicit percentage)",
  smaller:
    "Smaller: decrease width and height (default 25%, or the explicit percentage)",
  wider:
    "Wider: increase width (default 25% unless an explicit percentage is supplied)",
  narrower: "Narrower: decrease width (default 25%)",
  shorter: "Shorter: decrease height (default 25%)",
  half: "Half the current width and height (50% size)",
  double: "Double the current width and height (200% size)",
  scale:
    "Resize TO the requested percentage of current width and height, not BY that percentage",
  taller: "25 percent taller",
  small: "Small window: 35% canvas width and 40% height",
  medium: "Medium window: 60% canvas width and 65% height",
  large: "Large window: 85% canvas width and 85% height",
  maximize: "Fill available canvas",
};
export const layoutChoices = {
  auto: "No explicit arrangement",
  focus:
    "Focus: a centered single vertical scrolling list, like Home. Newly added windows go at the top. Reading/feed layout, not equal rows fitted to the screen.",
  columns: "Equal columns, side by side, split screen / vertical divider",
  rows: "Equal rows, stacked, top and bottom split screen / horizontal divider",
  grid: "Equal grid / tile all windows",
  freeform: "Floating windows with no prescribed arrangement",
  custom: "Specific named windows assigned to different screen areas",
};
/** Apply invisible screen areas while keeping controls reachable on small canvases. */
export function areaFrame(
  area: string,
  original: CanvasFrame,
  bounds: CanvasBounds,
): CanvasFrame {
  if (Object.hasOwn(regions, area)) {
    const [x, y, width, height] = regions[area as keyof typeof regions];
    return fitCanvasFrame(
      {
        x: x * bounds.width,
        y: y * bounds.height,
        width: width * bounds.width,
        height: height * bounds.height,
      },
      bounds,
    );
  }
  if (!Object.hasOwn(areaChoices, area))
    throw new Error("That screen area isn't supported.");
  const frame = fitCanvasFrame(original, bounds);
  if (area === "center")
    return {
      ...frame,
      x: (bounds.width - frame.width) / 2,
      y: (bounds.height - frame.height) / 2,
    };
  if (area.includes("left")) frame.x = 0;
  if (area.includes("right")) frame.x = bounds.width - frame.width;
  if (area.includes("top")) frame.y = 0;
  if (area.includes("bottom")) frame.y = bounds.height - frame.height;
  return frame;
}
/** Absolute size presets preserve the current center; relative sizes preserve the origin. */
export function sizedFrame(
  size: string,
  original: CanvasFrame,
  bounds: CanvasBounds,
  percentage = 25,
): CanvasFrame {
  if (!Number.isFinite(percentage) || percentage <= 0 || percentage > 400)
    throw new Error("Use a percentage greater than 0 and no more than 400.");
  const shrinking = ["smaller", "narrower", "shorter"].includes(size);
  if (shrinking && percentage >= 100)
    throw new Error("Shrink by less than 100% so the windows remain usable.");
  const ratios: Record<string, number[]> = {
    small: [0.35, 0.4],
    medium: [0.6, 0.65],
    large: [0.85, 0.85],
  };
  if (size === "maximize") return areaFrame("full", original, bounds);
  const frame = { ...original };
  if (ratios[size]) {
    frame.width = bounds.width * ratios[size][0];
    frame.height = bounds.height * ratios[size][1];
    frame.x += (original.width - frame.width) / 2;
    frame.y += (original.height - frame.height) / 2;
  } else {
    const factor =
      size === "half"
        ? 0.5
        : size === "double"
          ? 2
          : size === "scale"
            ? percentage / 100
            : 1 + ((shrinking ? -1 : 1) * percentage) / 100;
    if (["bigger", "smaller", "half", "double", "scale"].includes(size)) {
      frame.width *= factor;
      frame.height *= factor;
    } else if (["wider", "narrower"].includes(size)) frame.width *= factor;
    else if (["taller", "shorter"].includes(size)) frame.height *= factor;
    else throw new Error("That window size isn't supported.");
  }
  return fitCanvasFrame(frame, bounds);
}
/** Tile parent windows together; connected panes and Home's anchored summary stay intact. */
export function arrangeCanvas(
  state: CanvasLayout,
  preset: string | undefined,
  areas: Record<string, string> | undefined,
  bounds: CanvasBounds,
  captured: Record<string, CanvasFrame>,
  home: boolean,
): CanvasLayout {
  const parents = parentWindowIds(state).filter(
    (id) => !(home && id === "main"),
  );
  const frames = { ...state.freeform?.frames, ...captured };
  const tiled = preset && ["columns", "rows", "grid"].includes(preset);
  if (tiled) {
    const columns =
      preset === "rows"
        ? 1
        : preset === "grid"
          ? Math.ceil(Math.sqrt(parents.length))
          : parents.length;
    const rows = Math.ceil(parents.length / Math.max(1, columns));
    if (
      parents.length &&
      (bounds.width / columns < Math.min(240, bounds.width) ||
        bounds.height / rows < Math.min(180, bounds.height))
    )
      throw new Error(
        "The canvas is too small for that arrangement. Enlarge Buzz or use fewer windows.",
      );
    parents.forEach((id, index) => {
      frames[id] = fitCanvasFrame(
        {
          x: ((index % columns) * bounds.width) / columns,
          y: (Math.floor(index / columns) * bounds.height) / rows,
          width: bounds.width / columns,
          height: bounds.height / rows,
        },
        bounds,
      );
    });
  }
  const assigned = new Map<string, string>();
  for (const [target, area] of Object.entries(areas ?? {})) {
    const parent =
      Object.entries(state.interiors ?? {}).find(([, layout]) =>
        layout.groups.some((g) => g.tabs.includes(target)),
      )?.[0] ?? target;
    if (!parents.includes(parent))
      throw new Error("That window is unavailable or anchored in Home.");
    if (assigned.has(parent) && assigned.get(parent) !== area)
      throw new Error(
        "Connected panes move together. Choose one area for their window.",
      );
    assigned.set(parent, area);
    frames[parent] = areaFrame(
      area,
      frames[parent] ?? { x: 0, y: 0, width: 440, height: 520 },
      bounds,
    );
  }
  if (tiled || assigned.size || preset === "freeform")
    return {
      ...state,
      layout: "freeform",
      freeform: { frames, order: parents },
    };
  if (preset === "focus") return { ...state, layout: "focus" };
  return state;
}
