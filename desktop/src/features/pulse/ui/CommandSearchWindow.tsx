import { Action } from "@/shared/ui/action";
import { useEffect } from "react";
import { useAppNavigation } from "@/app/navigation/useAppNavigation";
import { useSearchResults } from "@/features/search/useSearchResults";
import {
  ChannelResultBody,
  MessageResultBody,
  resultKey,
} from "@/features/search/ui/SearchResultItem";
import type { Channel } from "@/shared/api/types";
import { Input } from "@/shared/ui/input";
import { Button } from "@/shared/ui/button";
import { useWindowCatalog } from "../lib/useWindowCatalog";
import { searchCommandEntries, commandEntries } from "../voice/commandCatalog";
import type { CanvasView } from "../lib/canvasLayout";

/** Full Buzz search uses the same authorized history and people search as Cmd+K. */
export function CommandSearchWindow({
  query,
  onQuery,
  channels,
  currentPubkey,
  openView,
  openPerson,
}: {
  query: string;
  onQuery: (query: string) => void;
  channels: Channel[];
  currentPubkey?: string;
  openView: (view: CanvasView) => void;
  openPerson: (pubkey: string) => void;
}) {
  const search = useSearchResults({ channels, enabled: true, limit: 40 });
  const catalog = useWindowCatalog();
  const navigation = useAppNavigation();
  useEffect(() => {
    search.setQuery(query);
  }, [query, search.setQuery]);
  const destinations = searchCommandEntries(
    commandEntries({
      catalog: catalog.views.filter(
        (view) => view.kind === "project" || view.kind === "app",
      ),
      workspaces: [],
    }).filter((entry) => entry.plan.action === "open_windows"),
    query,
  );
  const waiting = query.trim() !== search.debouncedQuery || search.loading;
  return (
    <section aria-label="Search Buzz" className="flex min-h-0 flex-1 flex-col">
      <div className="p-4">
        <Input
          aria-label="Search Buzz"
          placeholder="Search messages, people, channels and projects…"
          value={query}
          onChange={(event) => onQuery(event.target.value)}
        />
        <p className="mt-2 text-xs text-muted-foreground">
          Search message history. Use in:channel or from:person to narrow
          results.
        </p>
      </div>
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-4 pb-4">
        {search.error && (
          <div role="alert" className="text-sm text-destructive">
            Some results couldn’t be loaded.{" "}
            <Button variant="link" onClick={search.retry}>
              Retry search
            </Button>
          </div>
        )}
        {search.unresolvedOperator && !search.isWaitingOnFromResolution && (
          <p role="status" className="text-sm">
            Couldn’t match the person or channel in that search filter.
          </p>
        )}
        {waiting && query.trim().length >= 2 && (
          <p role="status" className="text-sm text-muted-foreground">
            Searching Buzz…
          </p>
        )}
        {destinations.map((entry) => (
          <Action
            key={entry.id}
            type="button"
            className="w-full rounded-xl p-3 text-left text-sm hover:bg-muted focus-visible:outline focus-visible:outline-2"
            onClick={() => {
              const view = catalog.views.find((view) => view.id === entry.id);
              if (view) openView(view);
            }}
          >
            <span className="font-medium">{entry.title}</span>
            <span className="ml-2 text-xs text-muted-foreground">
              {entry.detail}
            </span>
          </Action>
        ))}
        {(query.trim() === search.debouncedQuery ? search.results : []).map(
          (result) =>
            result.kind === "action" ? null : (
              <Action
                key={resultKey(result)}
                type="button"
                className="w-full rounded-xl border border-border p-3 text-left hover:bg-muted focus-visible:outline focus-visible:outline-2"
                onClick={() => {
                  if (result.kind === "message")
                    void navigation.openSearchHit(result.hit, {
                      query: search.debouncedQuery,
                    });
                  else if (result.kind === "channel")
                    void navigation.goChannel(result.channel.id);
                  else openPerson(result.user.pubkey);
                }}
              >
                {result.kind === "message" ? (
                  <MessageResultBody
                    hit={result.hit}
                    resultProfiles={search.resultProfiles}
                    currentPubkey={currentPubkey}
                  />
                ) : result.kind === "channel" ? (
                  <ChannelResultBody channel={result.channel} />
                ) : (
                  <>
                    <span className="text-sm font-medium">
                      {result.user.displayName ||
                        result.user.nip05Handle ||
                        "Buzz member"}
                    </span>
                    <span className="ml-2 text-xs text-muted-foreground">
                      {result.user.isAgent ? "Agent" : "Person"} · Open message
                      draft
                    </span>
                  </>
                )}
              </Action>
            ),
        )}
        {!waiting &&
          !search.error &&
          !search.unresolvedOperator &&
          !search.results.length &&
          !destinations.length && (
            <p className="p-3 text-sm text-muted-foreground">
              {query.trim().length >= 2
                ? "No matches. Try another name or phrase."
                : "Type at least two characters to search Buzz."}
            </p>
          )}
      </div>
    </section>
  );
}
