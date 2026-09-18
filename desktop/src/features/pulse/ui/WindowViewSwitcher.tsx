import {
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactElement,
} from "react";
import { ArrowLeft } from "lucide-react";
import { useFeatureEnabled } from "@/shared/features";
import { Action } from "@/shared/ui/action";
import { Popover, PopoverContent, PopoverTrigger } from "@/shared/ui/popover";
import type { PulseAppSelection } from "./PulseAppNavigation";
import {
  PulseNavigationDestinations,
  tabs,
  type NavTab,
} from "./PulseNavigationDestinations";
import "./WindowViewSwitcher.css";

/** Swap a window in place; an active dock tab can also serve as its trigger. */
export function WindowViewSwitcher({
  title,
  onSelect,
  includeHome = true,
  trigger,
  active = true,
}: {
  title: string;
  onSelect: PulseAppSelection;
  includeHome?: boolean;
  trigger?: ReactElement;
  active?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [section, setSection] = useState<NavTab | null>(null);
  const content = useRef<HTMLDivElement>(null);
  const restore = useRef<NavTab | null>(null);
  const canOpen = useRef(active);
  useLayoutEffect(() => {
    if (!active) setOpen(false);
  }, [active]);
  const projectsEnabled = useFeatureEnabled("projects");
  const close = () => setOpen(false);
  const select: PulseAppSelection = (app, destination) => {
    const result = onSelect(app, destination);
    if (result !== false) close();
    return result;
  };
  const back = () => {
    restore.current = section;
    setSection(null);
  };
  useLayoutEffect(() => {
    if (!open) return;
    const target = section
      ? content.current?.querySelector<HTMLButtonElement>("[data-open-area]")
      : restore.current
        ? content.current?.querySelector<HTMLButtonElement>(
            `[data-area="${restore.current}"]`,
          )
        : null;
    (
      target ?? content.current?.querySelector<HTMLButtonElement>("button")
    )?.focus();
    restore.current = null;
  }, [open, section]);
  const keyboard = (event: KeyboardEvent<HTMLDivElement>) => {
    event.stopPropagation();
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey)
      return;
    if (event.key === "ArrowLeft" && section) {
      event.preventDefault();
      back();
      return;
    }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    const buttons = [
      ...(content.current?.querySelectorAll<HTMLButtonElement>(
        "button:not(:disabled)",
      ) ?? []),
    ];
    if (!buttons.length) return;
    event.preventDefault();
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? buttons.length - 1
          : (index + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) %
            buttons.length;
    buttons[next]?.focus();
  };
  const area = section ? tabs[section] : null;
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (next && !canOpen.current) return;
        if (next) {
          setSection(null);
          restore.current = null;
        }
        setOpen(next);
      }}
    >
      <PopoverTrigger
        asChild
        onPointerDownCapture={() => {
          canOpen.current = active;
        }}
        onKeyDownCapture={() => {
          canOpen.current = active;
        }}
      >
        {trigger ?? (
          <Action
            className="panel-window-title window-view-switch-trigger text-sm font-medium"
            aria-label={`Switch view, ${title}`}
            onPointerDown={(event) => event.stopPropagation()}
          >
            {title}
          </Action>
        )}
      </PopoverTrigger>
      <PopoverContent
        ref={content}
        aria-label="Switch window view"
        align="start"
        sideOffset={8}
        className="window-view-switcher w-72 p-2"
        onKeyDown={keyboard}
        onPointerDown={(event) => event.stopPropagation()}
      >
        {section && area ? (
          <>
            <Action
              className="mb-1 flex w-full items-center gap-2 rounded-lg px-2 py-2 text-xs text-muted-foreground hover:bg-muted"
              onClick={back}
              aria-label="Back to all views"
            >
              <ArrowLeft aria-hidden className="size-3.5" /> All views
            </Action>
            {section !== "apps" && (
              <Action
                data-open-area
                className="flex min-h-11 w-full items-center gap-3 rounded-xl px-2 py-2 text-left text-sm font-medium hover:bg-muted"
                onClick={() => select(section)}
              >
                <area.icon aria-hidden className="size-4" /> Open {area.label}
              </Action>
            )}
            <PulseNavigationDestinations
              tab={section}
              onSelect={select}
              onClose={close}
            />
          </>
        ) : (
          (Object.keys(tabs) as NavTab[])
            .filter(
              (id) =>
                (id !== "home" || includeHome) &&
                (id !== "projects" || projectsEnabled),
            )
            .map((id) => {
              const { label, icon: Icon } = tabs[id];
              return (
                <Action
                  key={id}
                  data-area={id}
                  className="flex min-h-11 w-full items-center gap-3 rounded-xl px-2 py-2 text-left text-sm hover:bg-muted focus-visible:bg-muted"
                  onClick={() => setSection(id)}
                >
                  <Icon aria-hidden className="size-4 text-muted-foreground" />
                  {label}
                </Action>
              );
            })
        )}
      </PopoverContent>
    </Popover>
  );
}
