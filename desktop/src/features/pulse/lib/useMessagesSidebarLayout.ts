import { useCallback, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { normalizeRelayUrl } from "@/shared/lib/normalizeRelayUrl";

const CHANGE_EVENT = "buzz-messages-sidebar-layout-changed";
export type MessagesSidebarLayout = "recents" | "classic";

function subscribe(callback: () => void) {
  window.addEventListener("storage", callback);
  window.addEventListener(CHANGE_EVENT, callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener(CHANGE_EVENT, callback);
  };
}

/** Community- and identity-scoped presentation preference; section data stays canonical. */
export function useMessagesSidebarLayout(pubkey?: string, relayUrl?: string) {
  const key =
    pubkey && relayUrl
      ? `buzz-messages-sidebar-layout.v1:${pubkey}:${encodeURIComponent(normalizeRelayUrl(relayUrl))}`
      : null;
  const getSnapshot = useCallback((): MessagesSidebarLayout => {
    try {
      return key && localStorage.getItem(key) === "classic"
        ? "classic"
        : "recents";
    } catch {
      return "recents";
    }
  }, [key]);
  const layout = useSyncExternalStore(
    subscribe,
    getSnapshot,
    () => "recents" as const,
  );
  const setLayout = useCallback(
    (value: MessagesSidebarLayout) => {
      if (!key) return;
      try {
        localStorage.setItem(key, value);
        window.dispatchEvent(new Event(CHANGE_EVENT));
      } catch {
        toast.error("Could not save the sidebar layout. Please try again.");
      }
    },
    [key],
  );
  return [layout, setLayout] as const;
}
