import { useState } from "react";
import {
  Bot,
  Folder,
  Hash,
  MessageCircle,
  Search,
  Plus,
  LayoutGrid,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/shared/ui/dialog";
import { Input } from "@/shared/ui/input";
import { Button } from "@/shared/ui/button";
import { Action } from "@/shared/ui/action";
import type { CanvasView, CanvasViewKind } from "../lib/canvasLayout";

export const canvasViewIcons = {
  channel: Hash,
  dm: MessageCircle,
  project: Folder,
  agents: Bot,
  widget: LayoutGrid,
};
const categories = [
  { id: "all", label: "All views" },
  { id: "channel", label: "Channels" },
  { id: "dm", label: "Direct messages" },
  { id: "project", label: "Projects" },
  { id: "agents", label: "Agents" },
  { id: "widget", label: "Widgets" },
] as const;

/** Search the current community's available views and place one on the canvas. */
export function CanvasViewPicker({
  views,
  selected,
  onAdd,
  onClose,
}: {
  views: CanvasView[];
  selected: string[];
  onAdd: (view: CanvasView) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<CanvasViewKind | "all">("all");
  const visible = views.filter(
    (view) =>
      (category === "all" || category === view.kind) &&
      `${view.title} ${view.kind}`
        .toLocaleLowerCase()
        .includes(query.trim().replace(/^#/, "").toLocaleLowerCase()),
  );
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        className="max-w-lg gap-4"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          const trigger = document.querySelector<HTMLButtonElement>(
            '[data-testid="canvas-add-view"]',
          );
          if (trigger && !trigger.disabled) trigger.focus();
          else
            Array.from(
              document.querySelectorAll<HTMLElement>(
                '[data-testid="canvas-window"]',
              ),
            )
              .at(-1)
              ?.focus();
        }}
      >
        <div>
          <DialogTitle>Add a view</DialogTitle>
          <DialogDescription className="mt-2">
            Keep a conversation or a little context alongside your work.
          </DialogDescription>
        </div>
        <div className="relative">
          <Search
            aria-hidden
            className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            aria-label="Search views"
            placeholder="Search channels, people, projects, widgets…"
            className="pl-9"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <fieldset className="flex flex-wrap gap-1" aria-label="View types">
          {categories.map(({ id, label }) => (
            <Button
              key={id}
              size="sm"
              variant={id === category ? "secondary" : "ghost"}
              aria-pressed={id === category}
              onClick={() => setCategory(id)}
            >
              {label}
            </Button>
          ))}
        </fieldset>
        <section
          className="max-h-80 overflow-y-auto"
          aria-label="Available views"
        >
          {visible.map((view) => {
            const Icon = canvasViewIcons[view.kind];
            const added = selected.includes(view.id);
            return (
              <Action
                type="button"
                key={view.id}
                disabled={added}
                onClick={() => onAdd(view)}
                className="flex w-full items-center gap-3 rounded-xl p-3 text-left hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-40"
              >
                <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-muted">
                  <Icon aria-hidden className="size-5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">
                    {view.title}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {categories.find((item) => item.id === view.kind)?.label}
                  </span>
                </span>
                {added ? (
                  <span className="text-xs text-muted-foreground">Added</span>
                ) : (
                  <Plus aria-hidden className="size-4 text-muted-foreground" />
                )}
              </Action>
            );
          })}
          {!visible.length && (
            <p className="py-10 text-center text-sm text-muted-foreground">
              No views found. Try a different name or category.
            </p>
          )}
        </section>
        <p className="text-xs text-muted-foreground">
          Views stay on this canvas as you move between apps.
        </p>
      </DialogContent>
    </Dialog>
  );
}
