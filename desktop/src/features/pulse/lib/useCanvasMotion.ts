import { useLayoutEffect, useRef, type RefObject } from "react";
import type { CanvasLayout } from "./canvasLayout";
const ease = "cubic-bezier(0.23, 1, 0.32, 1)";
/** Animate explicit add/remove actions without changing persistence or gesture geometry. */
export function useCanvasMotion(
  root: RefObject<HTMLDivElement | null>,
  state: CanvasLayout,
  persist: (next: CanvasLayout) => boolean,
) {
  const keyboard = useRef(false);
  const pending = useRef<string[]>([]);
  const animations = useRef(new Set<Animation>());
  const mode = () =>
    keyboard.current
      ? "instant"
      : window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "fade"
        : "full";
  function animate(element: HTMLElement, exit = false, ghost = false) {
    const variant = mode();
    if (variant === "instant") {
      if (ghost) element.remove();
      return;
    }
    const base = getComputedStyle(element).transform.replace("none", "");
    const rest = { opacity: 1, transform: `${base} translateY(0px) scale(1)` };
    const edge =
      variant === "fade"
        ? { opacity: exit ? 0 : 1, transform: rest.transform }
        : {
            opacity: exit ? 0 : 1,
            transform: `${base} translateY(${exit ? 4 : 3}px) scale(${exit ? 0.985 : 0.995})`,
          };
    const animation = element.animate(exit ? [rest, edge] : [edge, rest], {
      duration: variant === "fade" ? 90 : 120,
      easing: ease,
    });
    animations.current.add(animation);
    const clean = () => {
      animations.current.delete(animation);
      if (ghost) element.remove();
    };
    animation.onfinish = clean;
    animation.oncancel = clean;
  }
  useLayoutEffect(() => {
    const stop = () => {
      for (const animation of animations.current) animation.cancel();
    };
    const pointer = () => {
      keyboard.current = false;
      stop();
    };
    const key = () => {
      keyboard.current = true;
      stop();
    };
    document.addEventListener("pointerdown", pointer, true);
    document.addEventListener("keydown", key, true);
    return () => {
      stop();
      document.removeEventListener("pointerdown", pointer, true);
      document.removeEventListener("keydown", key, true);
    };
  }, []);
  useLayoutEffect(() => {
    const ids = pending.current;
    if (!ids.length) return;
    pending.current = [];
    for (const element of root.current?.querySelectorAll<HTMLElement>(
      "[data-content-id]",
    ) ?? [])
      if (ids.includes(element.dataset.contentId ?? "")) animate(element);
  });
  function save(next: CanvasLayout) {
    const added = next.windows.filter((id) => !state.windows.includes(id));
    const removed =
      next.windows.length < state.windows.length
        ? state.windows.filter((id) => !next.windows.includes(id))
        : [];
    const ghosts: HTMLElement[] = [];
    if (removed.length && mode() !== "instant")
      for (const element of root.current?.querySelectorAll<HTMLElement>(
        "[data-content-id]",
      ) ?? []) {
        if (!removed.includes(element.dataset.contentId ?? "")) continue;
        const box = element.getBoundingClientRect();
        if (!box.width || !box.height) continue;
        const clone = element.cloneNode(true) as HTMLElement;
        for (const node of [
          clone,
          ...clone.querySelectorAll<HTMLElement>("*"),
        ]) {
          node.removeAttribute("id");
          for (const attr of [...node.attributes])
            if (attr.name.startsWith("data-")) node.removeAttribute(attr.name);
        }
        clone.inert = true;
        clone.setAttribute("aria-hidden", "true");
        clone.dataset.canvasMotionGhost = "";
        Object.assign(clone.style, {
          position: "fixed",
          left: `${box.x}px`,
          top: `${box.y}px`,
          width: `${box.width}px`,
          height: `${box.height}px`,
          margin: "0",
          transform: "none",
          pointerEvents: "none",
          zIndex: "60",
          borderRadius: "16px",
          overflow: "hidden",
          background: "var(--blockui-surface-card)",
        });
        ghosts.push(clone);
      }
    pending.current = mode() === "instant" ? [] : added;
    const saved = persist(next);
    if (!saved) {
      pending.current = [];
      return false;
    }
    for (const ghost of ghosts) {
      document.body.append(ghost);
      animate(ghost, true, true);
    }
    return true;
  }
  return { save, mode };
}
