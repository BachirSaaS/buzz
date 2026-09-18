import { useCallback, useMemo, useSyncExternalStore } from "react";
import { toast } from "sonner";

/** Keep the title bar compact even when several conversations are pinned. */
export const MAX_PINNED_DMS = 4;
/** Local, identity-scoped quick-chat pins and feed source selection. */
export type PulsePreferences = {
  pinnedDms: string[];
  excludedSources: string[];
  includeNotes: boolean;
};
const CHANGE = "buzz-pulse-preferences-changed";
const defaults: PulsePreferences = {
  pinnedDms: [],
  excludedSources: [],
  includeNotes: true,
};
/** Read only bounded channel references and feed choices from local preferences. */
export function parsePulsePreferences(raw: string | null): PulsePreferences {
  try {
    const value = JSON.parse(raw ?? "null");
    if (!value || typeof value !== "object") return defaults;
    const ids = (input: unknown, limit: number): string[] =>
      Array.isArray(input)
        ? [
            ...new Set(
              input.filter(
                (id): id is string =>
                  typeof id === "string" && id.length > 0 && id.length <= 512,
              ),
            ),
          ].slice(0, limit)
        : [];
    return {
      pinnedDms: ids(value.pinnedDms, MAX_PINNED_DMS),
      excludedSources: ids(value.excludedSources, 5000),
      includeNotes: value.includeNotes !== false,
    };
  } catch {
    return defaults;
  }
}
function subscribe(callback: () => void) {
  window.addEventListener("storage", callback);
  window.addEventListener(CHANGE, callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener(CHANGE, callback);
  };
}
/** Pins and filters belong to this community and identity, never to a canvas layout. */
export function usePulsePreferences(scope: string | null) {
  const key = scope ? `buzz-pulse-preferences.v1:${scope}` : null;
  const snapshot = useCallback(() => {
    try {
      return key ? localStorage.getItem(key) : null;
    } catch {
      return null;
    }
  }, [key]);
  const raw = useSyncExternalStore(subscribe, snapshot, () => null);
  const values = useMemo(() => parsePulsePreferences(raw), [raw]);
  const update = (change: (current: PulsePreferences) => PulsePreferences) => {
    if (!key) return false;
    try {
      const next = change(parsePulsePreferences(localStorage.getItem(key)));
      localStorage.setItem(key, JSON.stringify(next));
      window.dispatchEvent(new Event(CHANGE));
      return true;
    } catch {
      toast.error("Could not save your pins and filters. Please try again.");
      return false;
    }
  };
  return { values, update, ready: Boolean(key) };
}
