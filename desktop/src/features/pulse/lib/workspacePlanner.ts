import { invoke, isTauri } from "@tauri-apps/api/core";
import { searchWindowCatalog, type WindowCatalogEntry } from "./windowCatalog";
/** Validated arrangement ready for a single atomic workspace creation. */
export type WorkspaceBlueprint = {
  name: string;
  layout: "focus" | "grid" | "columns";
  windowIds: string[];
};
/** Keep the model input small and metadata-only, with exact aliases ranked first. */
export function workspacePlanInput(
  request: string,
  entries: WindowCatalogEntry[],
) {
  const catalog = searchWindowCatalog(entries, request).map((entry) => ({
    id: entry.id,
    kind: entry.kind,
    title: entry.title.slice(0, 160),
    description: entry.description.slice(0, 240),
    aliases: entry.aliases.slice(0, 6).map((alias) => alias.slice(0, 80)),
  }));
  const input = { request: request.trim().slice(0, 1000), catalog };
  while (
    new TextEncoder().encode(JSON.stringify(input)).length > 60_000 &&
    catalog.length
  )
    catalog.pop();
  return input;
}
/** Only real catalog IDs can cross from generated text into persisted workspace state. */
export function parseWorkspacePlan(
  value: unknown,
  catalog: readonly { id: string }[],
): WorkspaceBlueprint {
  const plan = value as WorkspaceBlueprint & { unresolved: string[] };
  if (
    !plan ||
    typeof plan.name !== "string" ||
    !plan.name.trim() ||
    plan.name.length > 48 ||
    !["focus", "columns", "grid"].includes(plan.layout) ||
    !Array.isArray(plan.windowIds) ||
    plan.windowIds.length > 4 ||
    new Set(plan.windowIds).size !== plan.windowIds.length ||
    plan.windowIds.some(
      (id) =>
        typeof id !== "string" || !catalog.some((entry) => entry.id === id),
    ) ||
    !Array.isArray(plan.unresolved) ||
    plan.unresolved.length > 8 ||
    plan.unresolved.some(
      (item) => typeof item !== "string" || item.length > 400,
    )
  )
    throw new Error(
      "That workspace included unavailable windows. Try again or choose Custom.",
    );
  if (plan.unresolved.length) throw new Error(plan.unresolved.join(" "));
  if (!plan.windowIds.length)
    throw new Error(
      "No matching windows found. Try describing your workspace differently.",
    );
  return {
    name: plan.name.trim(),
    layout: plan.layout,
    windowIds: plan.windowIds,
  };
}
/** Use the same native, bounded model runner as Home summaries. */
export async function planWorkspace(
  input: ReturnType<typeof workspacePlanInput>,
  signal: AbortSignal,
) {
  // E2E intercepts transport only; catalog building and validation remain production code.
  if (import.meta.env.MODE === "e2e") {
    const response = await fetch("/__pulse/workspace", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
      signal,
    });
    if (!response.ok)
      throw new Error(
        "Couldn’t build your workspace. Try again or choose Custom.",
      );
    return response.json();
  }
  if (!isTauri())
    throw new Error(
      "Open the desktop app to build a workspace with AI, or choose Custom.",
    );
  return invoke<unknown>("plan_workspace", { input: JSON.stringify(input) });
}
