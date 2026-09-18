import { useEffect, useRef, useState } from "react";
import { ArrowUp, Loader2, Plus } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/shared/ui/popover";
import { Action } from "@/shared/ui/action";
import { Button } from "@/shared/ui/button";
import type { WorkspaceController } from "../lib/usePulseWorkspaces";
import { useWindowCatalog } from "../lib/useWindowCatalog";
import {
  parseWorkspacePlan,
  planWorkspace,
  workspacePlanInput,
} from "../lib/workspacePlanner";

/** Describe a workspace, or step directly into a blank custom canvas. */
export function NewWorkspacePopover({
  workspaces,
  onCreated,
}: {
  workspaces: WorkspaceController;
  onCreated: () => void;
}) {
  const [open, setOpen] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);
  const flight = useRef<AbortController | null>(null);
  const created = () => {
    setOpen(false);
    onCreated();
  };
  const active = workspaces.active.id;
  // biome-ignore lint/correctness/useExhaustiveDependencies: Switching workspaces dismisses this creator.
  useEffect(() => {
    setOpen(false);
  }, [active]);
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          flight.current?.abort();
          flight.current = null;
        }
        setOpen(next);
      }}
    >
      <PopoverTrigger asChild>
        <Action
          aria-label="New workspace"
          title="New workspace"
          disabled={!workspaces.canCreate}
          className="workspace-add-trigger flex size-[24px] shrink-0 items-center justify-center rounded-lg bg-background/50 text-muted-foreground hover:bg-background/80 disabled:opacity-40"
        >
          <Plus aria-hidden className="size-4" />
        </Action>
      </PopoverTrigger>
      <PopoverContent
        aria-label="New workspace"
        align="start"
        sideOffset={10}
        className="new-workspace-popover w-[380px] p-0"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          input.current?.focus();
        }}
      >
        <WorkspacePrompt
          active={open}
          flight={flight}
          workspaces={workspaces}
          input={input}
          onCreated={created}
        />
      </PopoverContent>
    </Popover>
  );
}
function WorkspacePrompt({
  active,
  flight,
  workspaces,
  input,
  onCreated,
}: {
  active: boolean;
  flight: React.RefObject<AbortController | null>;
  workspaces: WorkspaceController;
  input: React.RefObject<HTMLTextAreaElement | null>;
  onCreated: () => void;
}) {
  const catalog = useWindowCatalog();
  const [request, setRequest] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const latest = useRef({ workspaces, catalog, onCreated });
  latest.current = { workspaces, catalog, onCreated };
  useEffect(
    () => () => {
      flight.current?.abort();
      flight.current = null;
    },
    [flight],
  );
  useEffect(() => {
    if (!active) {
      setBusy(false);
      flight.current?.abort();
      flight.current = null;
    }
  }, [active, flight]);
  const submit = async () => {
    if (
      !active ||
      !request.trim() ||
      !catalog.ready ||
      flight.current ||
      !workspaces.canCreate
    )
      return;
    const controller = new AbortController();
    flight.current = controller;
    setBusy(true);
    setError(null);
    const source = workspacePlanInput(request, catalog.views);
    try {
      const value = await planWorkspace(source, controller.signal);
      if (
        flight.current !== controller ||
        controller.signal.aborted ||
        latest.current.workspaces.active.id !== workspaces.active.id ||
        latest.current.workspaces.scope !== workspaces.scope
      )
        return;
      const blueprint = parseWorkspacePlan(value, source.catalog);
      // Revalidate against current membership; an in-flight result never owns stale app state.
      parseWorkspacePlan(
        { ...blueprint, unresolved: [] },
        latest.current.catalog.views,
      );
      if (latest.current.workspaces.create(blueprint))
        latest.current.onCreated();
      else
        setError("Couldn’t save your workspace. Try again or choose Custom.");
    } catch (reason) {
      if (flight.current === controller && !controller.signal.aborted)
        setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      if (flight.current === controller) {
        flight.current = null;
        setBusy(false);
      }
    }
  };
  return (
    <>
      <form
        className="space-y-3 p-4"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <label
          htmlFor="workspace-description"
          className="block text-sm font-medium"
        >
          What’s this workspace for?
        </label>
        <div className="relative">
          <textarea
            id="workspace-description"
            ref={input}
            aria-label="Describe your workspace"
            maxLength={1000}
            placeholder="Message jmarr and mattkursmark, check the weather, and see my projects…"
            value={request}
            readOnly={busy}
            onChange={(event) => {
              setRequest(event.target.value);
              setError(null);
            }}
            onKeyDown={(event) => {
              if (
                event.key === "Enter" &&
                !event.shiftKey &&
                !event.nativeEvent.isComposing
              ) {
                event.preventDefault();
                void submit();
              }
            }}
            className="min-h-[132px] w-full resize-none rounded-xl border border-input bg-transparent p-3 pb-12 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
          />
          <Button
            type="submit"
            size="icon"
            aria-label="Create workspace"
            disabled={
              busy || !request.trim() || !catalog.ready || !workspaces.canCreate
            }
            className="absolute bottom-3 right-3 size-7 rounded-full"
          >
            {busy ? (
              <Loader2
                aria-hidden
                className="size-4 animate-spin motion-reduce:animate-none"
              />
            ) : (
              <ArrowUp aria-hidden className="size-4" />
            )}
          </Button>
        </div>
        {busy && (
          <p role="status" className="text-xs text-muted-foreground">
            Finding your windows…
          </p>
        )}
        {!busy && !catalog.ready && !catalog.error && (
          <p role="status" className="text-xs text-muted-foreground">
            Loading available windows…
          </p>
        )}
        {catalog.error && (
          <p role="alert" className="text-xs">
            Couldn’t load your windows.{" "}
            <Button
              type="button"
              variant="link"
              size="sm"
              onClick={() => void catalog.retry()}
            >
              Retry
            </Button>
          </p>
        )}
        {error && (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        )}
      </form>
      <div className="border-t border-border p-2">
        <Action
          className="flex min-h-10 w-full items-center justify-between rounded-lg px-3 text-sm hover:bg-muted"
          onClick={() => {
            flight.current?.abort();
            flight.current = null;
            setBusy(false);
            if (workspaces.create()) onCreated();
            else setError("Couldn’t create a workspace. Try again.");
          }}
        >
          <span>Custom</span>
          <span className="text-xs text-muted-foreground">Start empty</span>
        </Action>
      </div>
    </>
  );
}
