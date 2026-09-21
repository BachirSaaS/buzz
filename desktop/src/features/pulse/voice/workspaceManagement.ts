import {
  homeCanvas,
  MAX_WORKSPACES,
  type PulseWorkspaces,
} from "../lib/pulseWorkspaces";
import { isWorkspaceIcon } from "../lib/workspaceIcons";
import type { CommandContext, InterfacePlan } from "./plan";

/** All these operations commit one workspace snapshot and share command undo. */
export const workspaceManagementActions = [
  "set_workspace_icon",
  "duplicate_workspace",
  "reorder_workspace",
  "clear_workspace",
  "close_other_workspaces",
] as const;
export const workspacePositionChoices = {
  first: "First/top of the dock",
  last: "Last/bottom of the dock",
  previous: "One slot earlier/up/left in dock order",
  next: "One slot later/down/right in dock order",
  before: "Immediately before/above a named workspace",
  after: "Immediately after/below a named workspace",
} as const;

/** Pure workspace transaction, preserving content and route references unless explicitly cleared. */
export function manageWorkspace(
  plan: InterfacePlan,
  saved: PulseWorkspaces,
  ctx: CommandContext,
  newId: string,
): PulseWorkspaces {
  const target = saved.items.find((item) => item.id === plan.workspace);
  if (!target) throw new Error("That workspace is no longer available.");
  const replace = (item: typeof target): PulseWorkspaces => ({
    ...saved,
    items: saved.items.map((current) =>
      current.id === item.id ? item : current,
    ),
  });
  switch (plan.action) {
    case "set_workspace_icon":
      if (!isWorkspaceIcon(plan.icon))
        throw new Error("Choose an available workspace icon.");
      return replace({ ...target, icon: plan.icon });
    case "duplicate_workspace": {
      if (saved.items.length >= MAX_WORKSPACES)
        throw new Error("Close a workspace before making another copy.");
      if (saved.items.some((item) => item.id === newId))
        throw new Error("That workspace identifier already exists.");
      let name = plan.text?.trim() || `${target.name.slice(0, 43)} copy`;
      if (!plan.text?.trim()) {
        let number = 2;
        while (saved.items.some((item) => item.name === name))
          name = `${target.name.slice(0, 39)} copy ${number++}`;
      }
      if (name.length > 48)
        throw new Error("Workspace names can have up to 48 characters.");
      const icon = target.icon ?? ctx.workspaceIcons?.[target.id];
      const duplicate = structuredClone({
        ...target,
        id: newId,
        name,
        ...(icon ? { icon } : {}),
      });
      // A copy of Home cannot acquire its special anchored-summary identity.
      if (target.id === "home") {
        duplicate.route = {};
        duplicate.canvas = { ...duplicate.canvas, main: false };
      }
      const index = saved.items.indexOf(target);
      return {
        active: newId,
        items: [
          ...saved.items.slice(0, index + 1),
          duplicate,
          ...saved.items.slice(index + 1),
        ],
      };
    }
    case "reorder_workspace": {
      const index = saved.items.indexOf(target);
      const items = saved.items.filter((item) => item.id !== target.id);
      let position: number;
      switch (plan.workspacePosition) {
        case "first":
          position = 0;
          break;
        case "last":
          position = items.length;
          break;
        case "previous":
          position = Math.max(0, index - 1);
          break;
        case "next":
          position = Math.min(items.length, index + 1);
          break;
        case "before":
        case "after": {
          const reference = items.findIndex(
            (item) => item.id === plan.referenceWorkspace,
          );
          if (reference < 0)
            throw new Error(
              "That neighboring workspace is no longer available.",
            );
          position = reference + (plan.workspacePosition === "after" ? 1 : 0);
          break;
        }
        default:
          throw new Error("Choose where this workspace belongs in the dock.");
      }
      items.splice(position, 0, target);
      return { ...saved, items };
    }
    case "clear_workspace":
      return replace({
        ...target,
        canvas:
          target.id === "home"
            ? homeCanvas({ layout: "columns", windows: [] })
            : { main: false, layout: "columns", windows: [] },
      });
    case "close_other_workspaces":
      return { active: target.id, items: [target] };
    default:
      throw new Error("That is not a workspace management operation.");
  }
}
