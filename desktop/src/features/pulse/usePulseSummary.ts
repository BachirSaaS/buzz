import { summaryReferences } from "./lib/summaryReferences";
import { invoke, isTauri } from "@tauri-apps/api/core";
import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { parsePulseSummary, type buildSummaryInput } from "./lib/pulseSummary";

export function usePulseSummary(
  input: ReturnType<typeof buildSummaryInput>,
  enabled: boolean,
) {
  const native = isTauri() && import.meta.env.MODE !== "e2e";
  enabled = enabled && (native || __BUZZ_PULSE_SUMMARY_AVAILABLE__);
  // Time passing alone must not trigger another model request.
  const serialized = React.useMemo(
    () => JSON.stringify({ ...input, asOf: undefined }),
    [input],
  );
  const [snapshot, setSnapshot] = React.useState("");
  const lastAccepted = React.useRef(0);
  const lastGood = React.useRef<{
    scope: string;
    data: ReturnType<typeof parsePulseSummary>;
  } | null>(null);
  const snapshotInput = React.useMemo(
    () => (snapshot ? (JSON.parse(snapshot) as typeof input) : null),
    [snapshot],
  );
  const query = useQuery({
    queryKey: ["pulse-summary", input.scope, snapshot],
    enabled:
      enabled &&
      Boolean(snapshotInput?.conversations.length) &&
      snapshotInput?.scope === input.scope,
    queryFn: async ({ signal }) => {
      if (!snapshotInput) throw new Error("No activity to summarize.");
      const references = summaryReferences(snapshotInput);
      const request = JSON.stringify(references.payload);
      const allowed = new Set(
        snapshotInput?.conversations.flatMap((item) => [
          item.id,
          ...item.messages.map((m) => m.conversationId),
        ]),
      );
      const sources = new Map(
        snapshotInput?.conversations.flatMap((item) =>
          item.messages.map((m) => [m.id, m.conversationId] as const),
        ),
      );
      const channels = new Map(
        snapshotInput?.conversations.flatMap((item) =>
          [
            item.id,
            ...item.messages.map((message) => message.conversationId),
          ].map((id) => [id, item.channelId ?? ""] as const),
        ),
      );
      if (native)
        return parsePulseSummary(
          references.decode(
            await invoke("summarize_pulse_activity", { input: request }),
          ),
          allowed,
          sources,
          channels,
        );
      const controller = new AbortController();
      const abort = () => controller.abort();
      if (signal.aborted) abort();
      signal.addEventListener("abort", abort, { once: true });
      const timeout = setTimeout(abort, 95_000);
      try {
        const response = await fetch("/__pulse/briefing", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: request,
          signal: controller.signal,
        });
        if (!response.ok)
          throw new Error("Couldn’t summarize your activity. Try again.");
        return parsePulseSummary(
          references.decode(await response.json()),
          allowed,
          sources,
          channels,
        );
      } finally {
        clearTimeout(timeout);
        signal.removeEventListener("abort", abort);
      }
    },
    staleTime: 300_000,
    placeholderData: (previous, previousQuery) =>
      previousQuery?.queryKey[1] === input.scope ? previous : undefined,
    gcTime: 60_000,
    retry: false,
    refetchOnWindowFocus: false,
  });
  React.useEffect(() => {
    if (!enabled || query.isFetching || serialized === snapshot) return;
    const timer = setTimeout(
      () => {
        setSnapshot(serialized);
        lastAccepted.current = Date.now();
      },
      Math.max(1200, 60_000 - (Date.now() - lastAccepted.current)),
    );
    return () => clearTimeout(timer);
  }, [serialized, snapshot, enabled, query.isFetching]);
  if (query.data && snapshotInput?.scope === input.scope)
    lastGood.current = { scope: input.scope, data: query.data };
  return {
    ...query,
    data:
      query.data ??
      (lastGood.current?.scope === input.scope
        ? lastGood.current.data
        : undefined),
  };
}
