import { useState, useRef, useEffect, type KeyboardEvent } from "react";
import {
  Bot,
  Folder,
  Hash,
  MessageCircle,
  Search,
  Plus,
  LayoutGrid,
  X,
  PanelsTopLeft,
} from "lucide-react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { AnimatePresence, motion } from "motion/react";
import { CanvasViewPreview } from "./CanvasViewPreview";
import "./CanvasViewPicker.css";
import { Input } from "@/shared/ui/input";
import { Button } from "@/shared/ui/button";
import { Action } from "@/shared/ui/action";
import type { CanvasView, CanvasViewKind } from "../lib/canvasLayout";

export const canvasViewIcons = {
  app: PanelsTopLeft,
  channel: Hash,
  dm: MessageCircle,
  project: Folder,
  agents: Bot,
  widget: LayoutGrid,
};
const categories = [
  { id: "all", label: "All windows", icon: PanelsTopLeft },
  { id: "messages", label: "Messages", icon: MessageCircle },
  { id: "projects", label: "Projects", icon: Folder },
  { id: "agents", label: "Agents", icon: Bot },
  { id: "apps", label: "Apps", icon: LayoutGrid },
  { id: "widgets", label: "Widgets", icon: LayoutGrid },
] as const;
type Category = (typeof categories)[number]["id"];
const sections: { id: CanvasViewKind; label: string }[] = [
  { id: "app", label: "Full apps" },
  { id: "widget", label: "Widgets" },
  { id: "dm", label: "Direct messages" },
  { id: "channel", label: "Channels" },
  { id: "project", label: "Projects" },
  { id: "agents", label: "Activity" },
];
function belongsTo(view: CanvasView, category: Category) {
  if (category === "all") return true;
  if (category === "widgets") return view.kind === "widget";
  if (category === "messages")
    return (
      view.kind === "dm" ||
      view.kind === "channel" ||
      view.id === "app:messages" ||
      ["mentions", "conversations", "channels", "huddle", "inbox"].includes(
        view.target ?? "",
      )
    );
  if (category === "projects")
    return view.kind === "project" || view.id === "app:projects";
  if (category === "agents")
    return (
      view.kind === "agents" ||
      view.id === "app:agents" ||
      view.target === "agent-activity"
    );
  return view.id === "app:workflows";
}

/** Search the current community's available views and place one on the canvas. */
export function CanvasViewPicker({
  open,
  motionMode,
  views,
  selected,
  onAdd,
  onClose,
}: {
  open: boolean;
  motionMode: "full" | "fade" | "instant";
  views: CanvasView[];
  selected: string[];
  onAdd: (view: CanvasView) => void;
  onClose: () => void;
}) {
  const hidden =
    motionMode === "full"
      ? { opacity: 1, transform: "translateY(3px) scale(.995)" }
      : { opacity: 1, transform: "none" };
  const duration =
    motionMode === "instant" ? 0 : motionMode === "fade" ? 0.09 : 0.12;
  return (
    <DialogPrimitive.Root
      open={open}
      onOpenChange={(value) => {
        if (!value) onClose();
      }}
    >
      <AnimatePresence custom={motionMode}>
        {open && (
          <DialogPrimitive.Portal forceMount>
            <DialogPrimitive.Overlay forceMount asChild>
              <motion.div
                className="fixed inset-0 z-50 bg-black/20 backdrop-blur-[5px]"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit="closed"
                variants={{
                  closed: (mode: string) => ({
                    opacity: 0,
                    transition: { duration: mode === "instant" ? 0 : 0.1 },
                  }),
                }}
                transition={{ duration: duration * 0.7 }}
              />
            </DialogPrimitive.Overlay>
            <div className="pointer-events-none fixed inset-0 z-50 grid place-items-center p-4">
              <DialogPrimitive.Content
                forceMount
                asChild
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
                <motion.div
                  className="canvas-view-picker pointer-events-auto relative flex max-h-[min(760px,calc(100dvh-32px))] h-[min(680px,calc(100dvh-32px))] w-full max-w-4xl flex-col gap-4 rounded-blockui-lg bg-card p-6 text-card-foreground shadow-xl ring-1 ring-border outline-hidden"
                  initial={motionMode === "instant" ? false : hidden}
                  animate={{
                    opacity: 1,
                    transform: "translateY(0px) scale(1)",
                  }}
                  exit="closed"
                  variants={{
                    closed: (mode: string) => ({
                      opacity: 0,
                      transform:
                        mode === "full" ? "translateY(6px) scale(.98)" : "none",
                      transition: {
                        duration:
                          mode === "instant"
                            ? 0
                            : mode === "fade"
                              ? 0.09
                              : 0.12,
                        ease: [0.23, 1, 0.32, 1],
                      },
                    }),
                  }}
                  transition={{ duration, ease: [0.23, 1, 0.32, 1] }}
                >
                  <div className="pr-8">
                    <DialogPrimitive.Title className="text-lg font-semibold">
                      Add a window
                    </DialogPrimitive.Title>
                    <DialogPrimitive.Description className="mt-2 text-sm text-muted-foreground">
                      Choose an app, a conversation, or a widget for your
                      workspace.
                    </DialogPrimitive.Description>
                  </div>
                  <CanvasViewSearch
                    views={views}
                    selected={selected}
                    onAdd={onAdd}
                  />
                  <DialogPrimitive.Close asChild>
                    <Action
                      aria-label="Close"
                      className="absolute right-4 top-4 flex size-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted"
                    >
                      <X aria-hidden className="size-4" />
                    </Action>
                  </DialogPrimitive.Close>
                </motion.div>
              </DialogPrimitive.Content>
            </div>
          </DialogPrimitive.Portal>
        )}
      </AnimatePresence>
    </DialogPrimitive.Root>
  );
}

/** The same searchable catalog in the top-nav dialog and an empty connected pane. */
export function CanvasViewSearch({
  views,
  selected,
  onAdd,
  focusOnMount = false,
}: {
  views: CanvasView[];
  selected: string[];
  onAdd: (view: CanvasView) => void;
  focusOnMount?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<Category>("all");
  const visible = views.filter(
    (view) =>
      belongsTo(view, category) &&
      `${view.title} ${view.kind} ${(view.aliases ?? []).join(" ")}`
        .toLocaleLowerCase()
        .includes(query.trim().replace(/^#/, "").toLocaleLowerCase()),
  );
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (focusOnMount)
      root.current?.querySelector<HTMLInputElement>("input")?.focus();
  }, [focusOnMount]);
  const navigate = (event: KeyboardEvent<HTMLElement>) => {
    if (
      !["ArrowDown", "ArrowUp"].includes(event.key) ||
      event.altKey ||
      event.metaKey ||
      event.ctrlKey
    )
      return;
    const items = [
      ...(root.current?.querySelectorAll<HTMLButtonElement>(
        ".canvas-view-results .canvas-view-select:not(:disabled)",
      ) ?? []),
    ];
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    if (document.activeElement?.tagName !== "INPUT" && index < 0) return;
    if (!items.length) return;
    event.preventDefault();
    items[
      (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) %
        items.length
    ]?.focus();
  };
  return (
    <div ref={root} className="canvas-view-browser">
      <nav className="canvas-view-sidebar" aria-label="Window categories">
        {categories.map(({ id, label, icon: Icon }) => (
          <Button
            key={id}
            size="sm"
            variant={id === category ? "secondary" : "ghost"}
            aria-pressed={id === category}
            onClick={() => setCategory(id)}
          >
            <Icon aria-hidden className="size-4 shrink-0" />
            {label}
          </Button>
        ))}
      </nav>
      <div className="canvas-view-detail">
        <div className="relative">
          <Search
            aria-hidden
            className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            onKeyDown={navigate}
            aria-label="Search views"
            placeholder="Search channels, people, projects, widgets…"
            className="pl-9"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <section className="canvas-view-results" aria-label="Available views">
          {sections.map((section) => {
            const items = visible.filter((view) => view.kind === section.id);
            if (!items.length) return null;
            return (
              <div className="canvas-view-section" key={section.id}>
                <h3 className="mb-3 text-xs font-medium text-muted-foreground">
                  {section.label}
                </h3>
                <div className="canvas-view-grid">
                  {items.map((view) => {
                    const added = selected.includes(view.id);
                    return (
                      <div
                        key={view.id}
                        className="canvas-view-card"
                        data-added={added || undefined}
                      >
                        <CanvasViewPreview view={view} />
                        <Action
                          type="button"
                          disabled={added}
                          aria-label={`${view.title} ${section.label}${added ? " Added" : ""}`}
                          onKeyDown={navigate}
                          onClick={() => onAdd(view)}
                          className="canvas-view-select flex w-full items-center text-left"
                        >
                          <span className="flex w-full min-w-0 items-center gap-2 px-1 pb-1">
                            <span className="min-w-0 flex-1 truncate text-sm font-medium">
                              {view.title}
                            </span>
                            {added ? (
                              <span className="text-2xs text-muted-foreground">
                                Added
                              </span>
                            ) : (
                              <Plus
                                aria-hidden
                                className="size-3.5 shrink-0 text-muted-foreground"
                              />
                            )}
                          </span>
                        </Action>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
          {!visible.length && (
            <p className="py-10 text-center text-sm text-muted-foreground">
              No views found. Try a different name or category.
            </p>
          )}
        </section>
      </div>
    </div>
  );
}
