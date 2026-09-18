import { useState } from "react";
import { Hash, MessageCircle, Settings2 } from "lucide-react";
import { useAppShell } from "@/app/AppShellContext";
import { Action } from "@/shared/ui/action";
import { Input } from "@/shared/ui/input";
import type { Channel } from "@/shared/api/types";
import type { usePulsePreferences } from "../lib/usePulsePreferences";
import { PULSE_SOURCE_LIMIT } from "../lib/unifiedFeed";

/** Feed source choices apply immediately; membership and pinned conversations stay independent. */
export function PulseFeedFilters({
  channels,
  preferences,
  onClose,
  loading,
  error,
  retry,
}: {
  channels: (Channel & { label: string })[];
  preferences: ReturnType<typeof usePulsePreferences>;
  onClose: () => void;
  loading: boolean;
  error: boolean;
  retry: () => void;
}) {
  const [search, setSearch] = useState("");
  const { onOpenSettings } = useAppShell();
  const { values, update } = preferences;
  const shown = channels.filter((channel) =>
    channel.label.toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <>
      <h2 className="text-sm font-semibold">Feed filters</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        Choose what contributes to your summaries and activity.
      </p>
      <label className="my-3 flex cursor-pointer items-center gap-3 text-sm">
        <input
          type="checkbox"
          checked={values.includeNotes}
          disabled={!preferences.ready}
          onChange={(e) =>
            update((current) => ({
              ...current,
              includeNotes: e.target.checked,
            }))
          }
          className="accent-primary"
        />
        Notes from people you follow
      </label>
      <Input
        aria-label="Find feed sources"
        placeholder="Find a channel or DM…"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        className="h-9 text-sm"
      />
      <section
        className="my-3 max-h-64 overflow-y-auto"
        aria-label="Feed sources"
      >
        {loading && (
          <p role="status" className="py-3 text-xs">
            Loading sources…
          </p>
        )}
        {error && (
          <p role="alert" className="py-3 text-xs">
            Couldn’t load sources.{" "}
            <Action onClick={retry} className="underline">
              Try again
            </Action>
          </p>
        )}
        {shown.map((channel) => {
          const Icon = channel.channelType === "dm" ? MessageCircle : Hash;
          return (
            <label
              key={channel.id}
              className="flex cursor-pointer items-center gap-3 rounded-lg px-1 py-2 text-sm hover:bg-muted/50"
            >
              <input
                type="checkbox"
                className="accent-primary"
                checked={!values.excludedSources.includes(channel.id)}
                disabled={!preferences.ready}
                onChange={() =>
                  update((current) => ({
                    ...current,
                    excludedSources: current.excludedSources.includes(
                      channel.id,
                    )
                      ? current.excludedSources.filter(
                          (id) => id !== channel.id,
                        )
                      : [...current.excludedSources, channel.id],
                  }))
                }
              />
              <Icon
                aria-hidden
                className="size-3.5 shrink-0 text-muted-foreground"
              />
              <span className="truncate">{channel.label}</span>
            </label>
          );
        })}
        {!loading && !error && !shown.length && (
          <p className="py-3 text-xs text-muted-foreground">
            No sources found.
          </p>
        )}
      </section>
      {channels.length > PULSE_SOURCE_LIMIT && (
        <p className="mb-3 text-xs text-muted-foreground">
          Includes the {PULSE_SOURCE_LIMIT} most recently active selected
          conversations.
        </p>
      )}
      <div className="flex items-center justify-between border-t border-border pt-3">
        <Action
          className="rounded-md px-2 py-1 text-xs hover:bg-muted"
          onClick={() =>
            update((current) => ({
              ...current,
              excludedSources: [],
              includeNotes: true,
            }))
          }
        >
          Reset filters
        </Action>
        <Action
          className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs hover:bg-muted"
          onClick={() => {
            onClose();
            onOpenSettings?.("appearance");
          }}
        >
          <Settings2 aria-hidden className="size-3.5" /> App settings
        </Action>
      </div>
    </>
  );
}
