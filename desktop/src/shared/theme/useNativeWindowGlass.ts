import { invoke, isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect } from "react";
import { toast } from "sonner";
import { isMacPlatform } from "@/shared/lib/platform";

/** Reveal macOS's native blur only after the material is installed successfully. */
export function useNativeWindowGlass() {
  useEffect(() => {
    if (!isTauri() || !isMacPlatform() || getCurrentWindow().label !== "main")
      return;
    const transparency = window.matchMedia(
      "(prefers-reduced-transparency: reduce)",
    );
    const contrast = window.matchMedia("(prefers-contrast: more)");
    let generation = 0;
    let disposed = false;
    const apply = async () => {
      const current = ++generation;
      const enabled = !transparency.matches && !contrast.matches;
      const root = document.documentElement;
      if (!enabled) delete root.dataset.windowGlass;
      try {
        await invoke("set_window_vibrancy", {
          enabled,
          material: "under-window-background",
        });
        if (disposed || current !== generation) return;
        if (enabled) {
          // The pre-bundle boot script may pin an opaque inline root color.
          // Hand painting over to the loaded theme once native blur is ready.
          root.style.removeProperty("background-color");
          root.dataset.windowGlass = "true";
        }
      } catch {
        if (disposed || current !== generation) return;
        delete root.dataset.windowGlass;
        toast.error("Couldn't apply the window appearance.", {
          action: { label: "Retry", onClick: () => void apply() },
        });
      }
    };
    const update = () => {
      void apply();
    };
    update();
    transparency.addEventListener("change", update);
    contrast.addEventListener("change", update);
    return () => {
      disposed = true;
      transparency.removeEventListener("change", update);
      contrast.removeEventListener("change", update);
      delete document.documentElement.dataset.windowGlass;
    };
  }, []);
}
