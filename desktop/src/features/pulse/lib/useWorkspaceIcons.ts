import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { useQuery } from "@tanstack/react-query";
import type { WorkspaceController } from "./usePulseWorkspaces";
import { useWindowCatalog } from "./useWindowCatalog";
import { resolveIntent } from "../voice/intent";
import {
  decodeWorkspaceIcons,
  parseWorkspaceIcons,
  workspaceIconQuestions,
  workspaceIconSubject,
  type WorkspaceIconSubject,
} from "./workspaceIcons";

const CHANGE = "buzz-workspace-icons-changed";
function subscribe(update: () => void) {
  window.addEventListener(CHANGE, update);
  window.addEventListener("storage", update);
  return () => {
    window.removeEventListener(CHANGE, update);
    window.removeEventListener("storage", update);
  };
}
/** Choose each workspace icon once, independently of navigation, layout and undo history. */
export function useWorkspaceIcons(
  workspaces: WorkspaceController,
  paused: boolean,
) {
  const catalog = useWindowCatalog();
  const key = workspaces.scope
    ? `buzz-workspace-icons.v1:${workspaces.scope}`
    : null;
  const snapshot = useCallback(() => {
    try {
      return key ? localStorage.getItem(key) : null;
    } catch {
      return null;
    }
  }, [key]);
  const raw = useSyncExternalStore(subscribe, snapshot, () => null);
  const cache = useMemo(() => parseWorkspaceIcons(raw), [raw]);
  const subjects = workspaces.items.map((item) =>
    workspaceIconSubject(item, catalog.views),
  );
  const pending = subjects.filter(
    (subject) =>
      !cache[subject.id] &&
      !workspaces.items.find((item) => item.id === subject.id)?.icon,
  );
  const removed = Object.keys(cache).filter(
    (id) => !subjects.some((subject) => subject.id === id),
  );
  const signature = JSON.stringify({ pending, removed });
  const [settled, setSettled] = useState("");
  useEffect(() => {
    const timer = window.setTimeout(() => setSettled(signature), 650);
    return () => window.clearTimeout(timer);
  }, [signature]);
  const latest = useRef({ key, subjects });
  latest.current = { key, subjects };
  const query = useQuery({
    queryKey: ["pulse-workspace-icons", key, signature],
    enabled: Boolean(
      key &&
        (pending.length || removed.length) &&
        catalog.ready &&
        !paused &&
        settled === signature,
    ),
    staleTime: 0,
    gcTime: 60_000,
    retry: 1,
    retryDelay: 2000,
    refetchOnWindowFocus: false,
    queryFn: async ({ signal }) => {
      const requested: WorkspaceIconSubject[] = JSON.parse(signature).pending;
      const answers = requested.length
        ? await resolveIntent(
            {
              request:
                "Choose a dock icon for each described workspace based on its contents.",
              context:
                "Cosmetic workspace icons only. Do not execute any actions.",
              questions: workspaceIconQuestions(requested),
            },
            signal,
          )
        : {};
      const icons = decodeWorkspaceIcons(requested, answers);
      if (signal.aborted || !key || latest.current.key !== key) return null;
      const saved = parseWorkspaceIcons(localStorage.getItem(key));
      // Keep the first saved choice, even if another request finishes later.
      // Only fill missing icons with current results and prune removed workspaces.
      const next = Object.fromEntries(
        latest.current.subjects.flatMap((subject) => {
          const incoming = icons[subject.id];
          const record =
            saved[subject.id] ??
            (incoming?.fingerprint === subject.fingerprint
              ? incoming
              : undefined);
          return record ? [[subject.id, record]] : [];
        }),
      );
      localStorage.setItem(key, JSON.stringify(next));
      window.dispatchEvent(new Event(CHANGE));
      return next;
    },
  });
  return {
    icons: Object.fromEntries(
      subjects.map((subject) => [
        subject.id,
        workspaces.items.find((item) => item.id === subject.id)?.icon ??
          cache[subject.id]?.icon ??
          subject.fallback,
      ]),
    ),
    error: query.isError,
    retry: () => void query.refetch(),
  };
}
