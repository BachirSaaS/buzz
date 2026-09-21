import type { WorkspaceController } from "../lib/usePulseWorkspaces";
import {
  addCanvasWindows,
  canvasContentIds,
  type CanvasLayout,
} from "../lib/canvasLayout";
import {
  defaultCanvasFrame,
  fitCanvasFrame,
  withoutCanvasWindow,
  type CanvasBounds,
} from "../lib/freeformCanvas";
import { parentWindowIds } from "../lib/parentWindows";
import { DRAFT_WINDOW, type CommandContext, type InterfacePlan } from "./plan";
import { arrangeCanvas } from "./canvasAreas";
import {
  manageWorkspace,
  workspaceManagementActions,
} from "./workspaceManagement";
import { transformWindows } from "./transformWindows";

/** Pure canvas transaction; all geometry and route metadata persist together. */
export function commandCanvas(
  plan: InterfacePlan,
  ctx: CommandContext,
  bounds: CanvasBounds,
  frames: NonNullable<CanvasLayout["freeform"]>["frames"],
  newId: string,
): CanvasLayout {
  const state = ctx.active.canvas;
  const ids = canvasContentIds(state);
  const requireTarget = () => {
    if (!plan.target || !ids.includes(plan.target))
      throw new Error("That window is no longer open.");
    return plan.target;
  };
  const append = (additions: string[], routes = state.routes) => {
    const windows = addCanvasWindows(
      { ...state, layout: plan.layout ?? state.layout },
      additions,
    );
    return { ...state, windows, routes };
  };
  switch (plan.action) {
    case "open_windows": {
      if (
        !plan.windowIds?.length ||
        plan.windowIds.some((id) => !ctx.catalog.some((v) => v.id === id))
      )
        throw new Error("A requested window is no longer available.");
      const routes = Object.fromEntries(
        Object.entries(state.routes ?? {}).filter(
          ([id]) => !plan.windowIds?.includes(id),
        ),
      );
      return arrangeCanvas(
        {
          ...append(plan.windowIds, routes),
          layout: plan.layout ?? state.layout,
        },
        plan.arrangement,
        plan.areas,
        bounds,
        frames,
        ctx.active.id === "home",
      );
    }
    case "new_dm": {
      const people = plan.recipients ?? [];
      if (
        people.length > 8 ||
        people.some(
          (id) =>
            !/^[a-f0-9]{64}$/i.test(id) ||
            !ctx.people.some((p) => p.pubkey === id),
        )
      )
        throw new Error("A recipient is no longer available.");
      return append([newId], {
        ...state.routes,
        [newId]: {
          feed: "conversation",
          compose: "message",
          voiceRecipients: people.join(","),
        },
      });
    }
    case "search_messages":
      if (!plan.text) throw new Error("Include something to search for.");
      return append([newId], {
        ...state.routes,
        [newId]: { feed: "search", windowSearch: plan.text },
      });
    case "close_window": {
      const target = requireTarget();
      if (target === "main")
        throw new Error(
          "The main window stays in this workspace. Close its workspace instead.",
        );
      return withoutCanvasWindow(state, target);
    }
    case "arrange_windows":
      return arrangeCanvas(
        state,
        plan.arrangement ?? plan.layout,
        plan.areas,
        bounds,
        frames,
        ctx.active.id === "home",
      );
    case "move_window":
    case "resize_window":
      return transformWindows(plan, ctx, bounds, frames);
    case "focus_window": {
      const target = requireTarget();
      const selectTab = (layouts: CanvasLayout["panels"]) =>
        Object.fromEntries(
          Object.entries(layouts ?? {}).map(([key, layout]) => [
            key,
            {
              ...layout,
              groups: layout.groups.map((g) =>
                g.tabs.includes(target) ? { ...g, selected: target } : g,
              ),
            },
          ]),
        );
      const focusedState =
        plan.action === "focus_window"
          ? {
              ...state,
              panels: selectTab(state.panels),
              interiors: selectTab(state.interiors),
            }
          : state;
      const parent =
        Object.entries(state.interiors ?? {}).find(([, layout]) =>
          layout.groups.some((g) => g.tabs.includes(target)),
        )?.[0] ?? target;
      if (plan.action === "focus_window" && state.layout !== "freeform")
        return focusedState;
      if (
        plan.action === "focus_window" &&
        parent === "main" &&
        ctx.active.id === "home"
      )
        return focusedState;
      if (parent === "main" && ctx.active.id === "home")
        throw new Error(
          "Home's summary stays anchored. Choose one of its added windows.",
        );
      const parents = parentWindowIds(state);
      const original =
        frames[parent] ??
        state.freeform?.frames[parent] ??
        defaultCanvasFrame(parents.indexOf(parent), bounds, 960);
      const frame = { ...original };

      const order = [
        ...(state.freeform?.order ?? parents).filter(
          (id) => parents.includes(id) && id !== parent,
        ),
        parent,
      ];
      return {
        ...focusedState,
        layout: "freeform",
        freeform: {
          frames: {
            ...state.freeform?.frames,
            ...frames,
            [parent]: fitCanvasFrame(frame, bounds),
          },
          order,
        },
      };
    }
    default:
      throw new Error("This command doesn't change the canvas.");
  }
}
/** Execute through the same controller as pointer/keyboard UI; never create or send a relay message. */
export function executeInterfacePlan(
  plan: InterfacePlan,
  ctx: CommandContext,
  workspaces: WorkspaceController,
  bounds: CanvasBounds,
  frames: NonNullable<CanvasLayout["freeform"]>["frames"],
): string {
  if ((workspaceManagementActions as readonly string[]).includes(plan.action)) {
    const next = manageWorkspace(
      plan,
      workspaces.checkpoint(),
      ctx,
      crypto.randomUUID(),
    );
    if (!workspaces.restore(next))
      throw new Error(
        "The workspace change couldn’t be saved or navigation was cancelled.",
      );
    return (
      {
        set_workspace_icon: "Workspace icon changed.",
        duplicate_workspace: "Workspace duplicated.",
        reorder_workspace: "Workspace moved in the dock.",
        clear_workspace: "Workspace cleared.",
        close_other_workspaces: "Other workspaces closed.",
      } as Record<string, string>
    )[plan.action];
  }
  let ok: boolean;
  switch (plan.action) {
    case "create_workspace": {
      if (!workspaces.canCreate)
        throw new Error("Close a workspace before creating another one.");
      const ids = plan.windowIds ?? [];
      if (
        ids.some(
          (id) => id !== DRAFT_WINDOW && !ctx.catalog.some((v) => v.id === id),
        ) ||
        ids.length > 4
      )
        throw new Error("Some windows are no longer available.");
      const draftId = `voice-${crypto.randomUUID()}`;
      const windowIds = ids.map((id) => (id === DRAFT_WINDOW ? draftId : id));
      let canvas: CanvasLayout = {
        main: false,
        layout: plan.layout ?? "columns",
        windows: windowIds,
      };
      if (ids.includes(DRAFT_WINDOW)) {
        const draft = commandCanvas(
          { action: "new_dm", recipients: plan.recipients },
          {
            ...ctx,
            active: {
              ...ctx.active,
              canvas: { main: false, layout: "columns", windows: [] },
            },
          },
          bounds,
          {},
          draftId,
        );
        canvas.routes = draft.routes;
      }
      const areas = Object.fromEntries(
        Object.entries(plan.areas ?? {}).map(([id, area]) => [
          id === DRAFT_WINDOW ? draftId : id,
          area,
        ]),
      );
      canvas = arrangeCanvas(
        canvas,
        plan.arrangement,
        areas,
        bounds,
        {},
        false,
      );
      const name =
        plan.text ??
        (ids
          .map((id) =>
            id === DRAFT_WINDOW
              ? "Messages"
              : ctx.catalog.find((v) => v.id === id)?.title,
          )
          .join(" + ")
          .slice(0, 48) ||
          "New workspace");
      ok = workspaces.create({
        name,
        layout: canvas.layout,
        windowIds,
        canvas,
      });
      break;
    }
    case "switch_workspace":
      ok = workspaces.select(plan.workspace ?? "");
      break;
    case "rename_workspace":
      ok = workspaces.rename(plan.workspace ?? "", plan.text ?? "");
      break;
    case "close_workspace":
      if (!ctx.workspaces.some((w) => w.id === plan.workspace))
        throw new Error("That workspace is no longer available.");
      ok = workspaces.close(plan.workspace ?? "");
      break;
    default:
      ok = workspaces.saveCanvas(
        commandCanvas(
          plan,
          ctx,
          bounds,
          frames,
          `voice-${crypto.randomUUID()}`,
        ),
      );
  }
  if (!ok)
    throw new Error(
      "The change couldn't be saved or navigation was cancelled. Your command is still here.",
    );
  return (
    (
      {
        new_dm: "DM draft opened. Recipients are ready.",
        create_workspace: "Workspace created.",
        switch_workspace: "Workspace opened.",
        rename_workspace: "Workspace renamed.",
        close_workspace: "Workspace closed.",
        search_messages: "Buzz search opened.",
        close_window: "Window closed.",
        open_windows: "Windows opened.",
      } as Partial<Record<InterfacePlan["action"], string>>
    )[plan.action] ?? "Windows updated."
  );
}
