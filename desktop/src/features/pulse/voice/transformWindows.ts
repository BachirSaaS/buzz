import { canvasContentIds, type CanvasFrame } from "../lib/canvasLayout";
import {
  defaultCanvasFrame,
  fitCanvasFrame,
  type CanvasBounds,
} from "../lib/freeformCanvas";
import { parentWindowIds } from "../lib/parentWindows";
import type { CommandContext, InterfacePlan } from "./plan";
import { areaFrame, sizedFrame } from "./canvasAreas";

/** Transform a validated set of parent windows once, committing no partial geometry. */
export function transformWindows(
  plan: InterfacePlan,
  ctx: CommandContext,
  bounds: CanvasBounds,
  captured: Record<string, CanvasFrame>,
) {
  const state = ctx.active.canvas;
  const ids = canvasContentIds(state);
  const targets = plan.targets ?? (plan.target ? [plan.target] : []);
  if (!targets.length || targets.some((id) => !ids.includes(id)))
    throw new Error("One of those windows is no longer open. Try again.");
  const parents = parentWindowIds(state);
  const selected = [
    ...new Set(
      targets.map(
        (target) =>
          Object.entries(state.interiors ?? {}).find(([, layout]) =>
            layout.groups.some((g) => g.tabs.includes(target)),
          )?.[0] ?? target,
      ),
    ),
  ];
  if (selected.some((id) => !parents.includes(id)))
    throw new Error("One of those windows is no longer available.");
  if (ctx.active.id === "home" && selected.includes("main"))
    throw new Error(
      "Home’s summary stays anchored. Choose one of its added windows.",
    );
  const frames = { ...state.freeform?.frames, ...captured };
  const originals = selected.map(
    (id) => frames[id] ?? defaultCanvasFrame(parents.indexOf(id), bounds, 960),
  );
  if (plan.action === "resize_window") {
    selected.forEach((id, index) => {
      frames[id] = sizedFrame(
        plan.size ?? "",
        originals[index],
        bounds,
        plan.percentage,
      );
    });
  } else if (plan.action === "move_window") {
    // Move the selection as a group, preserving its spacing instead of piling windows up.
    const x = Math.min(...originals.map((frame) => frame.x));
    const y = Math.min(...originals.map((frame) => frame.y));
    const group = {
      x,
      y,
      width: Math.max(...originals.map((frame) => frame.x + frame.width)) - x,
      height: Math.max(...originals.map((frame) => frame.y + frame.height)) - y,
    };
    const direction = plan.placement?.replace(/^nudge_/, "");
    const nudging = plan.placement?.startsWith("nudge_");
    if (
      nudging &&
      !["left", "right", "top", "bottom"].includes(direction ?? "")
    )
      throw new Error("Choose a direction to move these windows.");
    const dx =
      direction === "left"
        ? -bounds.width * 0.08
        : direction === "right"
          ? bounds.width * 0.08
          : 0;
    const dy =
      direction === "top"
        ? -bounds.height * 0.08
        : direction === "bottom"
          ? bounds.height * 0.08
          : 0;
    const destination = nudging
      ? {
          ...group,
          x: Math.max(
            0,
            Math.min(Math.max(0, bounds.width - group.width), group.x + dx),
          ),
          y: Math.max(
            0,
            Math.min(Math.max(0, bounds.height - group.height), group.y + dy),
          ),
        }
      : areaFrame(plan.placement ?? "", group, bounds);
    selected.forEach((id, index) => {
      const original = originals[index];
      const width = (original.width * destination.width) / group.width;
      const height = (original.height * destination.height) / group.height;
      if (
        selected.length > 1 &&
        (width < Math.min(240, bounds.width) ||
          height < Math.min(180, bounds.height))
      )
        throw new Error(
          "That area is too small for these windows. Use a larger area or fewer windows.",
        );
      frames[id] = fitCanvasFrame(
        {
          x:
            destination.x +
            ((original.x - x) * destination.width) / group.width,
          y:
            destination.y +
            ((original.y - y) * destination.height) / group.height,
          width,
          height,
        },
        bounds,
      );
    });
  } else throw new Error("That transformation isn't supported.");
  const existingOrder = [
    ...new Set([...(state.freeform?.order ?? []), ...parents]),
  ].filter((id) => parents.includes(id));
  const order = [
    ...existingOrder.filter((id) => !selected.includes(id)),
    ...existingOrder.filter((id) => selected.includes(id)),
  ];
  return { ...state, layout: "freeform" as const, freeform: { frames, order } };
}
