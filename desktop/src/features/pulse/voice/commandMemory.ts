import { canvasContentIds } from "../lib/canvasLayout";
import type { PulseWorkspace } from "../lib/pulseWorkspaces";
import type { InterfacePlan } from "./plan";

/** One successful reference, owned by the current workspace and session only. */
export type CommandMemory = {
  workspace: string;
  request: string;
  action: InterfacePlan["action"];
  targets: string[];
  placement?: string;
  size?: string;
};

/** A missing member invalidates the whole reference; never silently act on half a group. */
export function currentCommandMemory(
  memory: CommandMemory | null | undefined,
  workspace: PulseWorkspace,
) {
  const ids = canvasContentIds(workspace.canvas);
  return memory?.workspace === workspace.id &&
    memory.targets.length > 0 &&
    memory.targets.every((id) => ids.includes(id))
    ? memory
    : undefined;
}

/** Remember only a successfully applied selection, including freshly created draft/search IDs. */
export function rememberCommand(
  plan: InterfacePlan,
  request: string,
  before: PulseWorkspace,
  after: PulseWorkspace,
): CommandMemory | undefined {
  const oldIds = canvasContentIds(before.canvas);
  const targets =
    plan.targets ??
    (plan.target
      ? [plan.target]
      : (plan.windowIds ??
        canvasContentIds(after.canvas).filter((id) => !oldIds.includes(id))));
  return currentCommandMemory(
    {
      workspace: after.id,
      request: request.slice(0, 1000),
      action: plan.action,
      targets: [...new Set(targets)],
      placement:
        plan.placement ??
        (targets.length === 1 ? plan.areas?.[targets[0]] : undefined),
      size: plan.size,
    },
    after,
  );
}

export const nudgeChoices = {
  nudge_left:
    "Move farther left by a small step, preserving size and group spacing",
  nudge_right:
    "Move farther right by a small step, preserving size and group spacing",
  nudge_top:
    "Move farther up by a small step, preserving size and group spacing",
  nudge_bottom:
    "Move farther down by a small step, preserving size and group spacing",
};
