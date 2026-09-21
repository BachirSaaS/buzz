import { NewWorkspacePopover } from "./NewWorkspacePopover";
import { useEffect, useRef, useState } from "react";
import { WorkspaceIcon } from "./WorkspaceIcon";
import { useWorkspaceIcons } from "../lib/useWorkspaceIcons";
import { useInterfaceSession } from "../voice/InterfaceCommandsProvider";
import { DockTooltip } from "./DockTooltip";
import { Popover, PopoverAnchor, PopoverContent } from "@/shared/ui/popover";
import { Action } from "@/shared/ui/action";
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
} from "@/shared/ui/context-menu";
import type { WorkspaceController } from "../lib/usePulseWorkspaces";
import "./WorkspaceTabs.css";
import type { PulseNavigationLayout } from "../lib/navigationLayout";

/** Workspace icons retain their names and menus independently of window content. */
export function WorkspaceTabs({
  workspaces,
  settingsActive = false,
  layout = "dock",
}: {
  workspaces: WorkspaceController;
  settingsActive?: boolean;
  layout?: PulseNavigationLayout;
}) {
  const { commands } = useInterfaceSession();
  const workspaceIcons = useWorkspaceIcons(
    workspaces,
    commands.busy || commands.clarifying,
  );
  const [editing, setEditing] = useState<string | null>(null);
  const [name, setName] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (editing) {
      input.current?.focus();
      input.current?.select();
    }
  }, [editing]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: Reveal the selected tab after every workspace switch.
  useEffect(() => {
    root.current
      ?.querySelector('[aria-selected="true"]')
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [workspaces.active.id]);
  const focus = () =>
    requestAnimationFrame(() =>
      root.current
        ?.querySelector<HTMLButtonElement>('[aria-selected="true"]')
        ?.focus(),
    );
  const rename = (id: string, value: string) => {
    setName(value);
    setEditing(id);
  };
  const finish = () => {
    if (editing && workspaces.rename(editing, name)) {
      setEditing(null);
      focus();
    }
  };
  return (
    <div ref={root} className="workspace-tabs" data-layout={layout}>
      <div
        role="tablist"
        aria-label="Workspaces"
        aria-orientation={layout === "dock" ? "vertical" : "horizontal"}
        className="workspace-tab-list"
      >
        {workspaces.items.map((item) => {
          const selected = !settingsActive && workspaces.active.id === item.id;
          return (
            <Popover
              key={item.id}
              open={editing === item.id}
              onOpenChange={(open) => {
                if (!open) setEditing(null);
              }}
            >
              <ContextMenu>
                <PopoverAnchor asChild>
                  <ContextMenuTrigger asChild>
                    <div
                      className="workspace-tab"
                      data-active={selected || undefined}
                    >
                      <DockTooltip
                        label={item.name}
                        side={layout === "dock" ? "right" : "bottom"}
                      >
                        <Action
                          role="tab"
                          aria-label={item.name}
                          aria-selected={selected}
                          aria-controls="pulse-workspace-content"
                          tabIndex={workspaces.active.id === item.id ? 0 : -1}
                          className={
                            layout === "dock"
                              ? "workspace-tab-select pulse-dock-icon"
                              : "workspace-tab-select pulse-control-surface text-sm"
                          }
                          onClick={() => workspaces.select(item.id)}
                          onDoubleClick={() => rename(item.id, item.name)}
                          onKeyDown={(event) => {
                            if (
                              event.altKey ||
                              event.metaKey ||
                              event.ctrlKey ||
                              event.shiftKey
                            )
                              return;
                            if (event.key === "F2") {
                              event.preventDefault();
                              rename(item.id, item.name);
                              return;
                            }
                            if (
                              ![
                                ...(layout === "dock"
                                  ? ["ArrowUp", "ArrowDown"]
                                  : ["ArrowLeft", "ArrowRight"]),
                                "Home",
                                "End",
                              ].includes(event.key)
                            )
                              return;
                            event.preventDefault();
                            const buttons = [
                              ...(root.current?.querySelectorAll<HTMLButtonElement>(
                                '[role="tab"]',
                              ) ?? []),
                            ];
                            const index = buttons.indexOf(event.currentTarget);
                            buttons[
                              event.key === "Home"
                                ? 0
                                : event.key === "End"
                                  ? buttons.length - 1
                                  : (index +
                                      (event.key ===
                                      (layout === "dock"
                                        ? "ArrowDown"
                                        : "ArrowRight")
                                        ? 1
                                        : -1) +
                                      buttons.length) %
                                    buttons.length
                            ]?.focus();
                          }}
                        >
                          <WorkspaceIcon name={workspaceIcons.icons[item.id]} />
                          <span
                            className={
                              layout === "dock" ? "sr-only" : "truncate"
                            }
                          >
                            {item.name}
                          </span>
                        </Action>
                      </DockTooltip>
                    </div>
                  </ContextMenuTrigger>
                </PopoverAnchor>
                <ContextMenuContent
                  aria-label={`${item.name} workspace options`}
                  onCloseAutoFocus={(event) => {
                    if (editing) {
                      event.preventDefault();
                      input.current?.focus();
                    }
                  }}
                >
                  {workspaceIcons.error && (
                    <ContextMenuItem onSelect={workspaceIcons.retry}>
                      Retry workspace icons
                    </ContextMenuItem>
                  )}
                  <ContextMenuItem onSelect={() => rename(item.id, item.name)}>
                    Rename workspace
                  </ContextMenuItem>
                  <ContextMenuItem
                    disabled={workspaces.items.length === 1}
                    onSelect={() => {
                      if (workspaces.close(item.id)) focus();
                    }}
                  >
                    Close workspace
                  </ContextMenuItem>
                </ContextMenuContent>
              </ContextMenu>
              <PopoverContent
                side={layout === "dock" ? "right" : "bottom"}
                align="start"
                sideOffset={16}
                aria-label="Rename workspace"
                className="w-64"
                onOpenAutoFocus={(event) => {
                  event.preventDefault();
                  input.current?.focus();
                  input.current?.select();
                }}
                onCloseAutoFocus={(event) => {
                  event.preventDefault();
                  focus();
                }}
              >
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    finish();
                  }}
                >
                  <label
                    className="mb-2 block text-sm"
                    htmlFor={`rename-${item.id}`}
                  >
                    Workspace name
                  </label>
                  <input
                    id={`rename-${item.id}`}
                    ref={editing === item.id ? input : undefined}
                    aria-label="Workspace name"
                    className="workspace-name-input text-sm"
                    maxLength={48}
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                  />
                  <Action
                    type="submit"
                    className="mt-3 rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground"
                  >
                    Save
                  </Action>
                </form>
              </PopoverContent>
            </Popover>
          );
        })}
      </div>
      <NewWorkspacePopover
        key={workspaces.scope}
        workspaces={workspaces}
        onCreated={focus}
        layout={layout}
      />
    </div>
  );
}
