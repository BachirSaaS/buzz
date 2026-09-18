import { NewWorkspacePopover } from "./NewWorkspacePopover";
import { useEffect, useRef, useState } from "react";
import { PanelsTopLeft } from "lucide-react";
import { Action } from "@/shared/ui/action";
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
} from "@/shared/ui/context-menu";
import type { WorkspaceController } from "../lib/usePulseWorkspaces";
import { tabs } from "./PulseNavigationDestinations";
import { workspaceForFeed } from "../lib/pulseWorkspaces";
import "./WorkspaceTabs.css";

/** Browser-like workspace tabs; changing a window's content never renames its workspace. */
export function WorkspaceTabs({
  workspaces,
}: {
  workspaces: WorkspaceController;
}) {
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
    <div ref={root} className="workspace-tabs">
      <div
        role="tablist"
        aria-label="Workspaces"
        className="workspace-tab-list"
      >
        {workspaces.items.map((item) => {
          const selected = workspaces.active.id === item.id;
          const Icon =
            item.canvas.main === false
              ? PanelsTopLeft
              : tabs[workspaceForFeed(item.route.feed ?? null)].icon;
          return (
            <ContextMenu key={item.id}>
              <ContextMenuTrigger asChild>
                <div
                  className="workspace-tab"
                  data-active={selected || undefined}
                >
                  {editing === item.id ? (
                    <input
                      ref={input}
                      aria-label="Workspace name"
                      className="workspace-name-input text-sm"
                      maxLength={48}
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      onBlur={finish}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          finish();
                        }
                        if (event.key === "Escape") {
                          event.preventDefault();
                          setEditing(null);
                          focus();
                        }
                      }}
                    />
                  ) : (
                    <Action
                      role="tab"
                      aria-label={item.name}
                      aria-selected={selected}
                      aria-controls="pulse-workspace-content"
                      tabIndex={selected ? 0 : -1}
                      className="workspace-tab-select text-sm"
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
                          !["ArrowLeft", "ArrowRight", "Home", "End"].includes(
                            event.key,
                          )
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
                                  (event.key === "ArrowRight" ? 1 : -1) +
                                  buttons.length) %
                                buttons.length
                        ]?.focus();
                      }}
                    >
                      <Icon aria-hidden className="size-3.5 shrink-0" />
                      <span className="truncate">{item.name}</span>
                    </Action>
                  )}
                </div>
              </ContextMenuTrigger>
              <ContextMenuContent
                aria-label={`${item.name} workspace options`}
                onCloseAutoFocus={(event) => {
                  if (editing) {
                    event.preventDefault();
                    input.current?.focus();
                  }
                }}
              >
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
          );
        })}
      </div>
      <NewWorkspacePopover
        key={workspaces.scope}
        workspaces={workspaces}
        onCreated={focus}
      />
    </div>
  );
}
