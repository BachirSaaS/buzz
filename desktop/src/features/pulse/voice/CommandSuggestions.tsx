import { Action } from "@/shared/ui/action";
import { ArrowUpRight, Search } from "lucide-react";
import type { CommandEntry } from "./commandCatalog";

/** Mouse, keyboard and screen readers select the same concrete destination. */
export function CommandSuggestions({
  entries,
  selected,
  listId,
  choose,
}: {
  entries: CommandEntry[];
  selected: number;
  listId: string;
  choose: (entry: CommandEntry) => void;
}) {
  return (
    <div
      role="listbox"
      aria-label="Buzz destinations"
      id={listId}
      className="max-h-64 w-full overflow-y-auto border-b border-border p-2"
    >
      {entries.map((entry, index) => (
        <Action
          key={entry.id}
          id={`${listId}-${index}`}
          type="button"
          role="option"
          aria-selected={index === selected}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => choose(entry)}
          className={`flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm hover:bg-muted focus-visible:outline focus-visible:outline-2 ${index === selected ? "bg-muted" : ""}`}
        >
          {entry.id === "search-query" ? (
            <Search aria-hidden className="size-4 shrink-0" />
          ) : (
            <ArrowUpRight aria-hidden className="size-4 shrink-0" />
          )}
          <span className="min-w-0 flex-1 truncate">{entry.title}</span>
          <span className="shrink-0 text-xs text-muted-foreground">
            {entry.detail}
          </span>
        </Action>
      ))}
    </div>
  );
}
