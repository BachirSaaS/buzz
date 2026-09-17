export const CANVAS_GAP = 8;
export const CANVAS_STACK_WIDTH = 760;

/** Fit a default main width and flexible companions into the current canvas. */
export function canvasColumnWidths(
  width: number,
  count: number,
  mainMax: number,
  saved?: number[],
) {
  const usable = Math.max(0, width - CANVAS_GAP * (count - 1));
  const minimum = Math.min(240, usable / count);
  const previous = saved?.length === count ? saved : undefined;
  const main = Math.max(
    minimum,
    Math.min(previous?.[0] ?? mainMax, usable - minimum * (count - 1)),
  );
  const extra = Math.max(0, usable - main - minimum * (count - 1));
  const weights = Array.from({ length: count - 1 }, (_, index) =>
    Math.max(0, (previous?.[index + 1] ?? minimum + 1) - minimum),
  );
  const total = weights.reduce((sum, value) => sum + value, 0);
  return [
    main,
    ...weights.map(
      (weight) =>
        minimum + extra * (total ? weight / total : 1 / weights.length),
    ),
  ];
}

/** Resize only the adjacent pair, preserving its combined width and readable minimums. */
export function resizeCanvasColumns(
  widths: number[],
  index: number,
  delta: number,
) {
  const minimum = Math.min(240, ...widths);
  const pair = widths[index] + widths[index + 1];
  const maximum = pair - minimum;
  const left = Math.max(minimum, Math.min(maximum, widths[index] + delta));
  return widths.map((width, column) =>
    column === index ? left : column === index + 1 ? pair - left : width,
  );
}
