import { currentCommandMemory } from "./commandMemory";
import { canvasContentIds } from "../lib/canvasLayout";
import { canvasWindowView } from "../lib/canvasWindowView";
import type { CommandContext } from "./plan";

/** Offer explicit groups alongside individual windows; never let focus stand in for “all”. */
export function windowTargetOptions(ctx: CommandContext, bulk: boolean) {
  const ids = canvasContentIds(ctx.active.canvas);
  const choices: Record<string, string> = {};
  const groups: Record<string, string[]> = {};
  const names = ids.map((id) => {
    const view = canvasWindowView(
      id,
      ctx.catalog,
      id === "main" ? ctx.active.route : ctx.active.canvas.routes?.[id],
    );
    const name = view?.title ?? (id === "main" ? ctx.active.name : id);
    choices[id] =
      `${name} (${view?.kind ?? "app"})${id === ctx.focused ? " — focused; 'this window'" : ""}`;
    return name;
  });
  if (bulk) {
    const movable = ids.filter(
      (id) => !(ctx.active.id === "home" && id === "main"),
    );
    if (movable.length) {
      groups.all = movable;
      choices.all = `ALL movable windows together: ${movable.map((id) => names[ids.indexOf(id)]).join(", ")}. Also 'both' when these are the two windows. Home's summary stays anchored.`;
    }
    // The canvas is bounded, and so is the provider's choice vocabulary.
    const add = (indexes: number[], start: number) => {
      if (Object.keys(choices).length >= 124) return;
      if (indexes.length >= 2 && indexes.length < movable.length) {
        const key = `group:${indexes.join(",")}`;
        groups[key] = indexes.map((i) => movable[i]);
        choices[key] =
          `Only these windows together: ${groups[key].map((id) => names[ids.indexOf(id)]).join(" and ")}`;
      }
      if (indexes.length === 4) return;
      for (
        let i = start;
        i < movable.length && Object.keys(choices).length < 124;
        i++
      )
        add([...indexes, i], i + 1);
    };
    add([], 0);
  }
  const recent = currentCommandMemory(ctx.recent, ctx.active);
  if (recent && (bulk || recent.targets.length === 1)) {
    const key =
      recent.targets.length === 1
        ? recent.targets[0]
        : (Object.entries(groups).find(
            ([, ids]) =>
              ids.length === recent.targets.length &&
              ids.every((id) => recent.targets.includes(id)),
          )?.[0] ?? "recent");
    if (key === "recent") groups[key] = recent.targets;
    choices[key] =
      `${choices[key] ?? recent.targets.map((id) => names[ids.indexOf(id)]).join(" and ")} — LAST SUCCESSFUL SELECTION; it/that/them/those refer to exactly this selection. Previous request: ${recent.request}`;
  }
  choices.unavailable =
    "No clear matching window or group; 'both' without two identifiable windows is ambiguous";
  return { choices, groups };
}

/** Extract numeric choices from literal percentages, including common spoken number forms. */
export function percentageChoices(
  request: string,
): Record<string, string> | null {
  const units = [
    "zero",
    "one",
    "two",
    "three",
    "four",
    "five",
    "six",
    "seven",
    "eight",
    "nine",
    "ten",
    "eleven",
    "twelve",
    "thirteen",
    "fourteen",
    "fifteen",
    "sixteen",
    "seventeen",
    "eighteen",
    "nineteen",
  ];
  const tens = [
    "",
    "",
    "twenty",
    "thirty",
    "forty",
    "fifty",
    "sixty",
    "seventy",
    "eighty",
    "ninety",
  ];
  const words = Object.fromEntries(
    Array.from({ length: 101 }, (_, n) => [
      n === 100
        ? "one hundred"
        : n < 20
          ? units[n]
          : `${tens[Math.floor(n / 10)]}${n % 10 ? ` ${units[n % 10]}` : ""}`,
      n,
    ]),
  );
  const pattern = new RegExp(
    `\\b(\\d+(?:\\.\\d+)?|${Object.keys(words)
      .sort((a, b) => b.length - a.length)
      .join("|")})\\s*(?:%|per\\s*cent\\b)`,
    "gi",
  );
  const values = [...request.replaceAll("-", " ").matchAll(pattern)].map(
    (match) => Number(words[match[1].toLowerCase()] ?? match[1]),
  );
  if (!values.length) {
    if (/%|\bper\s*cent\b/i.test(request))
      throw new Error(
        "Use a numeric percentage, such as ‘all windows 25% smaller’.",
      );
    return null;
  }
  if (
    values.some((value) => !Number.isFinite(value) || value <= 0 || value > 400)
  )
    throw new Error("Use a percentage greater than 0 and no more than 400.");
  return Object.fromEntries(
    [...new Set(values)]
      .slice(0, 8)
      .map((value) => [String(value), `${value} percent, exactly as requested`])
      .concat([
        ["unavailable", "No single percentage applies to the requested resize"],
      ]),
  );
}
