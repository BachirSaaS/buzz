import {
  House,
  Bot,
  Folders,
  MessageCircle,
  Settings2,
  Zap,
} from "lucide-react";
import { useAppShell } from "@/app/AppShellContext";
import { cn } from "@/shared/lib/cn";
import { Action } from "@/shared/ui/action";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/shared/ui/tooltip";
import type { PulseWorkspacePage } from "../lib/workspaceNavigation";

export type PulseApp = "home" | "messages" | PulseWorkspacePage;

const apps = {
  home: { label: "Home", icon: House },
  messages: { label: "Messages", icon: MessageCircle },
  projects: { label: "Projects", icon: Folders },
  agents: { label: "Agents", icon: Bot },
  workflows: { label: "Workflows", icon: Zap },
} as const;

/** Compact app dock; labels remain available to keyboard and screen-reader users. */
export function PulseAppNavigation({
  active,
  onSelect,
}: {
  active: PulseApp | "settings";
  onSelect: (app: PulseApp) => void;
}) {
  const { onOpenSettings } = useAppShell();
  return (
    <div
      className="pulse-dock-rail flex w-24 shrink-0 justify-center overflow-y-auto pb-2"
      data-testid="pulse-dock-rail"
      data-tauri-drag-region
    >
      <nav
        aria-label="Apps"
        data-testid="pulse-app-navigation"
        className="pulse-app-dock flex h-fit flex-col items-center gap-2 rounded-[calc(var(--blockui-radius-12)+var(--spacing)*2)] border border-border bg-card p-2 shadow-sm"
      >
        {(Object.keys(apps) as PulseApp[]).map((app) => {
          const Icon = apps[app].icon;
          return (
            <div
              key={app}
              className={cn(
                app === "projects" && "border-t border-border pt-2",
              )}
            >
              <Tooltip>
                <TooltipTrigger asChild>
                  <Action
                    type="button"
                    aria-label={apps[app].label}
                    aria-current={active === app ? "page" : undefined}
                    onClick={() => onSelect(app)}
                    className={cn(
                      "pulse-dock-icon relative flex size-10 items-center justify-center rounded-blockui-12 transition-colors",
                      active === app
                        ? "bg-primary text-primary-foreground hover:bg-primary/90 active:bg-primary/80"
                        : "bg-secondary text-secondary-foreground hover:bg-secondary/80",
                    )}
                  >
                    <Icon aria-hidden="true" className="size-5" />
                  </Action>
                </TooltipTrigger>
                <TooltipContent side="right">{apps[app].label}</TooltipContent>
              </Tooltip>
            </div>
          );
        })}
        <div className="border-t border-border pt-2">
          <Tooltip>
            <TooltipTrigger asChild>
              <Action
                aria-label="Settings"
                aria-current={active === "settings" ? "page" : undefined}
                onClick={() => {
                  if (active !== "settings") onOpenSettings?.("appearance");
                }}
                className={cn(
                  "pulse-dock-icon flex size-10 items-center justify-center rounded-blockui-12 transition-colors",
                  active === "settings"
                    ? "bg-primary text-primary-foreground hover:bg-primary/90"
                    : "bg-secondary text-secondary-foreground hover:bg-secondary/80",
                )}
              >
                <Settings2 aria-hidden="true" className="size-5" />
              </Action>
            </TooltipTrigger>
            <TooltipContent side="right">Settings</TooltipContent>
          </Tooltip>
        </div>
      </nav>
    </div>
  );
}
