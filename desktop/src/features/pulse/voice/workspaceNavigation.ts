import type { PulseWorkspace } from "../lib/pulseWorkspaces";
import type { InterfacePlan } from "./plan";

const normalize = (value: string) =>
  value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s_-]+/g, "");

/** Resolve explicit navigation to a unique existing name without a model confidence gate. */
export function workspaceNavigation(
  request: string,
  workspaces: Pick<PulseWorkspace, "id" | "name">[],
): InterfacePlan | null {
  const match = request
    .trim()
    .match(
      /^(?:(?:please|can you|could you)\s+)?(?:switch(?:\s+back)?\s+to|go(?:\s+back)?\s+to|take me to|open\s+(?:the\s+)?workspace)\s+(.+?)\s*[.!?]*$/i,
    );
  if (!match) return null;
  const target = match[1].replace(/^["“](.*)["”]$/, "$1");
  const names = new Set(
    [
      target,
      target.replace(/^(?:the\s+)?workspace\s+/i, ""),
      target.replace(/^(?:the\s+)?(.+?)\s+workspace$/i, "$1"),
    ].map(normalize),
  );
  const matches = workspaces.filter((workspace) =>
    names.has(normalize(workspace.name)),
  );
  if (matches.length !== 1) return null;
  return { action: "switch_workspace", workspace: matches[0].id };
}
