import { useEffect, useRef, useState } from "react";
import { ArrowUp, Loader2, Plus } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/shared/ui/popover";
import { Action } from "@/shared/ui/action";
import { Button } from "@/shared/ui/button";
import type { WorkspaceController } from "../lib/usePulseWorkspaces";
import { useInterfaceSession } from "../voice/InterfaceCommandsProvider";
import { DockTooltip } from "./DockTooltip";
import { RecipientChoices } from "../voice/RecipientChoices";
import type { PulseNavigationLayout } from "../lib/navigationLayout";

/** The shared command engine with create-workspace intent already selected. */
export function NewWorkspacePopover({
  workspaces,
  onCreated,
  layout = "dock",
}: {
  workspaces: WorkspaceController;
  onCreated: () => void;
  layout?: PulseNavigationLayout;
}) {
  const { commands, surface, show } = useInterfaceSession();
  const open = surface === "workspace";
  const input = useRef<HTMLTextAreaElement>(null);
  const [request, setRequest] = useState("");
  const [storageError, setStorageError] = useState<string | null>(null);
  const previous = useRef(workspaces.active.id);
  useEffect(() => {
    if (previous.current !== workspaces.active.id && open) {
      show(null);
      onCreated();
    }
    previous.current = workspaces.active.id;
  }, [workspaces.active.id, open, show, onCreated]);
  useEffect(() => {
    if (
      commands.clarifying &&
      open &&
      commands.feedback.startsWith("Who do you mean")
    )
      setRequest("");
  }, [commands.clarifying, commands.feedback, open]);
  const submit = () => {
    if (
      !open ||
      !request.trim() ||
      commands.busy ||
      !commands.ready ||
      !workspaces.canCreate
    )
      return;
    setStorageError(null);
    void commands.run(request, undefined, { action: "create_workspace" });
  };
  return (
    <Popover
      open={open}
      onOpenChange={(value) => {
        if (value) {
          setRequest("");
          setStorageError(null);
        }
        show(value ? "workspace" : null);
      }}
    >
      <DockTooltip
        label="New workspace"
        side={layout === "dock" ? "right" : "bottom"}
      >
        <PopoverTrigger asChild>
          <Action
            aria-label="New workspace"
            disabled={!workspaces.canCreate}
            className={`workspace-add-trigger ${layout === "dock" ? "pulse-dock-icon" : "pulse-top-icon pulse-control-surface"} disabled:opacity-40`}
          >
            <Plus aria-hidden className="size-6" />
          </Action>
        </PopoverTrigger>
      </DockTooltip>
      <PopoverContent
        aria-label="New workspace"
        side={layout === "dock" ? "right" : "bottom"}
        align="start"
        sideOffset={10}
        className="new-workspace-popover w-[380px] p-0"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          input.current?.focus();
        }}
      >
        <form
          className="space-y-3 p-4"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <label
            htmlFor="workspace-description"
            className="block text-sm font-medium"
          >
            New workspace
          </label>
          <div className="relative">
            <textarea
              id="workspace-description"
              ref={input}
              aria-label="Describe your workspace"
              aria-description="Enter creates the workspace. Shift+Enter adds a new line."
              maxLength={1000}
              placeholder={
                commands.clarifying
                  ? "Say a full name, username, or “the first one”"
                  : "Describe your workspace"
              }
              value={request}
              readOnly={commands.busy}
              onChange={(event) => setRequest(event.target.value)}
              onKeyDown={(event) => {
                if (
                  event.key !== "Enter" ||
                  event.shiftKey ||
                  event.altKey ||
                  event.nativeEvent.isComposing ||
                  event.nativeEvent.keyCode === 229
                )
                  return;
                event.preventDefault();
                if (!event.repeat) event.currentTarget.form?.requestSubmit();
              }}
              className="min-h-[132px] w-full resize-none rounded-xl border border-input bg-transparent p-3 pb-12 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
            />
            <Button
              type="submit"
              size="icon"
              aria-label="Create workspace"
              disabled={
                commands.busy ||
                !request.trim() ||
                !commands.ready ||
                !workspaces.canCreate
              }
              className="absolute bottom-3 right-3 size-7 rounded-full"
            >
              {commands.busy ? (
                <Loader2
                  aria-hidden
                  className="size-4 animate-spin motion-reduce:animate-none"
                />
              ) : (
                <ArrowUp aria-hidden className="size-4" />
              )}
            </Button>
          </div>
          {(commands.busy || commands.clarifying) && (
            <p role="status" className="text-xs text-muted-foreground">
              {commands.feedback}
            </p>
          )}
          {!commands.ready && !commands.catalogError && (
            <p role="status" className="text-xs text-muted-foreground">
              Loading available windows…
            </p>
          )}
          {commands.catalogError && (
            <p role="alert" className="text-xs">
              Couldn’t load your windows.{" "}
              <Button
                type="button"
                variant="link"
                size="sm"
                onClick={() => void commands.retryCatalog()}
              >
                Retry
              </Button>
            </p>
          )}
          <RecipientChoices commands={commands} />
          {(storageError || commands.error) && (
            <p role="alert" className="text-xs text-destructive">
              {storageError || commands.error}
            </p>
          )}
        </form>
        <div className="border-t border-border p-2">
          <Action
            className="flex min-h-10 w-full items-center justify-between rounded-lg px-3 text-sm hover:bg-muted"
            onClick={() => {
              commands.cancel();
              if (workspaces.create()) {
                show(null);
                onCreated();
              } else setStorageError("Couldn’t create a workspace. Try again.");
            }}
          >
            <span>Custom</span>
          </Action>
        </div>
      </PopoverContent>
    </Popover>
  );
}
