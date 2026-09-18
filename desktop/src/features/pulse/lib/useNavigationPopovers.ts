import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
} from "react";

const OPEN_DELAY = 40;
const CLOSE_DELAY = 180;
const WARM_WINDOW = 350;
type OpenMethod = "hover" | "click" | "keyboard";
type MenuState<Key> = { id: Key | null; method: OpenMethod };

/** One coordinated hover/click/keyboard session for a navigation bar. */
export function useNavigationPopovers<Key extends string>(
  keys: readonly Key[],
) {
  const [state, setState] = useState<MenuState<Key>>({
    id: null,
    method: "hover",
  });
  const current = useRef(state);
  const triggers = useRef<Partial<Record<Key, HTMLButtonElement | null>>>({});
  const contents = useRef<Partial<Record<Key, HTMLDivElement | null>>>({});
  const opening = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closing = useRef<ReturnType<typeof setTimeout> | null>(null);
  const blocked = useRef<Key | null>(null);
  const warmUntil = useRef(0);
  const focusEdge = useRef<"first" | "last">("first");

  const clearTimers = useCallback(() => {
    if (opening.current !== null) clearTimeout(opening.current);
    if (closing.current !== null) clearTimeout(closing.current);
    opening.current = closing.current = null;
  }, []);
  const update = useCallback((next: MenuState<Key>) => {
    current.current = next;
    setState(next);
  }, []);
  const close = useCallback(
    (restoreFocus = false, hoverExit = false) => {
      clearTimers();
      const previous = current.current;
      blocked.current = hoverExit ? null : previous.id;
      warmUntil.current = hoverExit ? Date.now() + WARM_WINDOW : 0;
      update({ ...previous, id: null });
      if (restoreFocus && previous.id) triggers.current[previous.id]?.focus();
    },
    [clearTimers, update],
  );

  useEffect(() => {
    const blur = () => close();
    const visibility = () => {
      if (document.hidden) close();
    };
    window.addEventListener("blur", blur);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      clearTimers();
      window.removeEventListener("blur", blur);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [clearTimers, close]);

  function buttons(id: Key) {
    return Array.from(
      contents.current[id]?.querySelectorAll<HTMLButtonElement>(
        "button:not(:disabled)",
      ) ?? [],
    );
  }
  function focusItem(id: Key, edge: "first" | "last" = "first") {
    const items = buttons(id);
    (edge === "last" ? items.at(-1) : items[0])?.focus();
  }
  function show(id: Key, method: OpenMethod) {
    clearTimers();
    blocked.current = null;
    update({ id, method });
  }
  function hover(id: Key, event: PointerEvent) {
    if (
      event.pointerType !== "mouse" ||
      event.buttons !== 0 ||
      !window.matchMedia("(hover: hover) and (pointer: fine)").matches
    )
      return;
    clearTimers();
    if (blocked.current === id || current.current.id === id) return;
    if (current.current.id || Date.now() < warmUntil.current) show(id, "hover");
    else opening.current = setTimeout(() => show(id, "hover"), OPEN_DELAY);
  }
  function leave(id: Key, event: PointerEvent) {
    if (event.pointerType !== "mouse") return;
    if (blocked.current === id) blocked.current = null;
    clearTimers();
    if (current.current.id === id && current.current.method === "hover") {
      closing.current = setTimeout(() => {
        if (current.current.id === id && current.current.method === "hover")
          close(false, true);
      }, CLOSE_DELAY);
    }
  }
  function activate(id: Key, event: MouseEvent) {
    // Override Radix's toggle: the first click on a hover preview pins it.
    event.preventDefault();
    clearTimers();
    const method = event.detail === 0 ? "keyboard" : "click";
    if (current.current.id === id && current.current.method !== "hover")
      close(true);
    else {
      show(id, method);
      focusItem(id);
    }
  }
  function triggerKeys(id: Key, event: KeyboardEvent<HTMLElement>) {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey)
      return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      focusEdge.current = event.key === "ArrowUp" ? "last" : "first";
      show(id, "keyboard");
      focusItem(id, focusEdge.current);
    } else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      const next =
        keys[
          (keys.indexOf(id) +
            (event.key === "ArrowRight" ? 1 : keys.length - 1)) %
            keys.length
        ];
      if (current.current.id) show(next, "keyboard");
      triggers.current[next]?.focus();
    }
  }

  return {
    open: state.id,
    close,
    onOpenChange(id: Key, next: boolean) {
      if (next) show(id, "click");
      else if (current.current.id === id) close();
    },
    triggerProps(id: Key) {
      return {
        ref: (element: HTMLButtonElement | null) => {
          triggers.current[id] = element;
        },
        onPointerEnter: (event: PointerEvent<HTMLButtonElement>) =>
          hover(id, event),
        onPointerLeave: (event: PointerEvent<HTMLButtonElement>) =>
          leave(id, event),
        onClick: (event: MouseEvent<HTMLButtonElement>) => activate(id, event),
        onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) =>
          triggerKeys(id, event),
      };
    },
    contentProps(id: Key) {
      return {
        ref: (element: HTMLDivElement | null) => {
          contents.current[id] = element;
        },
        "data-open-method": state.method,
        onPointerEnter: clearTimers,
        onPointerLeave: (event: PointerEvent<HTMLDivElement>) =>
          leave(id, event),
        onPointerDown: () => {
          clearTimers();
          if (current.current.id === id) update({ id, method: "click" });
        },
        onFocusCapture: () => {
          if (current.current.id === id && current.current.method === "hover")
            update({ id, method: "keyboard" });
        },
        onOpenAutoFocus: (event: Event) => {
          event.preventDefault();
          if (current.current.method !== "hover")
            focusItem(id, focusEdge.current);
          focusEdge.current = "first";
        },
        onCloseAutoFocus: (event: Event) => event.preventDefault(),
        onEscapeKeyDown: (event: globalThis.KeyboardEvent) => {
          event.preventDefault();
          close(true);
        },
        onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => {
          if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey)
            return;
          if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
            triggerKeys(id, event);
            return;
          }
          if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key))
            return;
          event.preventDefault();
          clearTimers();
          update({ id, method: "keyboard" });
          const items = buttons(id);
          const index = items.indexOf(
            document.activeElement as HTMLButtonElement,
          );
          const next =
            event.key === "Home"
              ? 0
              : event.key === "End"
                ? items.length - 1
                : (index + (event.key === "ArrowDown" ? 1 : items.length - 1)) %
                  items.length;
          items[next]?.focus();
        },
      };
    },
  };
}
