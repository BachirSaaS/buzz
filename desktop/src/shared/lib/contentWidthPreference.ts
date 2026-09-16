import { createContext, useContext, useSyncExternalStore } from "react";

/** Device-level size of the app's workspaces. */
export type ContentWidth = "standard" | "full" | "custom";
/** The active workspace can preview a resize before persisting it. */
export const ContentWidthContext = createContext<ContentWidth | null>(null);
export type ContentSize = { width: number; height: number };
type Preference = ContentSize & { mode: ContentWidth };
const STORAGE_KEY = "buzz.appearance.contentWidth";
const listeners = new Set<() => void>();
const defaultPreference: Preference = {
  mode: "standard",
  width: 640,
  height: 600,
};

function read(): Preference {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (raw === "full" || raw === "standard")
      return { ...defaultPreference, mode: raw };
    if (!raw) return defaultPreference;
    const value = JSON.parse(raw) as Preference;
    if (
      ["standard", "full", "custom"].includes(value.mode) &&
      Number.isFinite(value.width) &&
      Number.isFinite(value.height) &&
      value.width >= 1 &&
      value.height >= 1
    )
      return value;
  } catch {
    /* Malformed or unavailable storage falls back to the default. */
  }
  return defaultPreference;
}
let preference = read();
function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY || event.key === null) {
      preference = read();
      listener();
    }
  };
  globalThis.window?.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    globalThis.window?.removeEventListener("storage", onStorage);
  };
}
function persist(value: Preference) {
  preference = value;
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {
    /* Keep the live preference when persistence is unavailable. */
  }
  for (const listener of listeners) listener();
}
/** Apply a preset, retaining the last custom dimensions. */
export function setContentWidth(mode: ContentWidth): void {
  persist({ ...preference, mode });
}
/** Commit a completed resize as one preference write. */
export function setContentSize(size: ContentSize): void {
  if (!Number.isFinite(size.width) || !Number.isFinite(size.height)) return;
  persist({
    mode: "custom",
    width: Math.max(1, Math.round(size.width)),
    height: Math.max(1, Math.round(size.height)),
  });
}
/** Subscribe to this device's size preference. */
export function useContentSize() {
  return useSyncExternalStore(
    subscribe,
    () => preference,
    () => defaultPreference,
  );
}
/** Subscribe to this device's workspace width mode. */
export function useContentWidth(): ContentWidth {
  const preview = useContext(ContentWidthContext);
  const saved = useContentSize().mode;
  return preview ?? saved;
}
