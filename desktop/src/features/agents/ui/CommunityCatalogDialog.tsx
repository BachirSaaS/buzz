import * as React from "react";
import { ChevronDown, Plus, Upload } from "lucide-react";
import { isCatalogPersonaSelected } from "@/features/agents/lib/catalog";
import { effectiveAgentDescription } from "@/features/agents/lib/agentDescription";
import { isCatalogPersona } from "@/features/agents/lib/personaCatalogRelay";
import type { CatalogTeam } from "@/features/agents/lib/teamCatalogRelay";
import { useUsersBatchQuery } from "@/features/profile/hooks";
import { ProfileAvatar } from "@/features/profile/ui/ProfileAvatar";
import type { AgentPersona } from "@/shared/api/types";
import { cn } from "@/shared/lib/cn";
import { Action } from "@/shared/ui/action";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/shared/ui/alert-dialog";
import { Button } from "@/shared/ui/button";
import { Dialog } from "@/shared/ui/dialog";
import { ChooserDialogContent } from "@/shared/ui/chooser-dialog-content";
import { AgentDefinitionMetadata } from "./AgentDefinitionMetadata";
import { PersonaAddedBy } from "./PersonaAddedBy";
import { resolveCatalogOwnerLabel } from "./catalogOwnerLabel";

export type CatalogSelection =
  | { kind: "persona"; id: string }
  | { kind: "team"; key: string };
/** Stable catalog coordinate for a publisher’s team. */
export function catalogTeamKey(team: CatalogTeam): string {
  return `${team.ownerPubkey}:${team.teamDTag}`;
}

type CommunityCatalogDialogProps = {
  createContent: (controls: {
    onDirtyChange: (dirty: boolean) => void;
    onRequestClose: () => void;
  }) => React.ReactNode;
  onImportFile: (fileBytes: number[], fileName: string) => void;
  personas: AgentPersona[];
  personasPending: boolean;
  onClearFeedback: () => void;
  onSelectPersona: (persona: AgentPersona, active: boolean) => void;
  teams: CatalogTeam[];
  teamsAdding: boolean;
  onAddTeam: (team: CatalogTeam) => void;
  selection?: CatalogSelection;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/** Creation/import and explicit catalog review; discovery lives in the Agents workspace. */
export function CommunityCatalogDialog({
  createContent,
  onImportFile,
  personas,
  personasPending,
  onClearFeedback,
  onSelectPersona,
  teams,
  teamsAdding,
  onAddTeam,
  selection,
  open,
  onOpenChange,
}: CommunityCatalogDialogProps) {
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const createDirtyRef = React.useRef(false);
  const dragDepthRef = React.useRef(0);
  const [pane, setPane] = React.useState<"create" | "import">("create");
  const [pendingNavigation, setPendingNavigation] = React.useState<
    "close" | "import" | null
  >(null);
  const [isDragOver, setIsDragOver] = React.useState(false);
  const [importError, setImportError] = React.useState<string | null>(null);
  const [readingFile, setReadingFile] = React.useState(false);
  const importGeneration = React.useRef(0);
  React.useEffect(() => {
    if (open) {
      createDirtyRef.current = false;
      setPane("create");
      setPendingNavigation(null);
      setImportError(null);
      setIsDragOver(false);
      setReadingFile(false);
      dragDepthRef.current = 0;
    }
    return () => {
      importGeneration.current += 1;
    };
  }, [open]);
  const persona =
    selection?.kind === "persona"
      ? personas.find((item) => item.id === selection.id)
      : undefined;
  const team =
    selection?.kind === "team"
      ? teams.find((item) => catalogTeamKey(item) === selection.key)
      : undefined;
  const added = persona
    ? isCatalogPersonaSelected(persona)
    : team?.localTeam != null;
  const busy = personasPending || teamsAdding || readingFile;
  const isImport = !selection && pane === "import";
  const missing = Boolean(selection && !persona && !team);
  const title = selection
    ? `Review ${selection.kind === "team" ? "team" : "agent"}`
    : "Add agent";
  const requestClose = () => {
    if (busy) return;
    if (!selection && pane === "create" && createDirtyRef.current)
      setPendingNavigation("close");
    else onOpenChange(false);
  };
  const selectPane = (next: "create" | "import") => {
    if (busy || pane === next) return;
    if (pane === "create" && createDirtyRef.current)
      setPendingNavigation("import");
    else setPane(next);
  };
  const importFile = async (file: File) => {
    const current = ++importGeneration.current;
    if (!/\.agent\.(json|png)$/i.test(file.name)) {
      setImportError("Choose an .agent.json or .agent.png file.");
      return;
    }
    setReadingFile(true);
    setImportError(null);
    try {
      const buffer = await file.arrayBuffer();
      if (current !== importGeneration.current) return;
      onImportFile(Array.from(new Uint8Array(buffer)), file.name);
      onOpenChange(false);
    } catch (error) {
      if (current === importGeneration.current)
        setImportError(
          error instanceof Error
            ? error.message
            : "Couldn't read this file. Choose it again to retry.",
        );
    } finally {
      if (current === importGeneration.current) setReadingFile(false);
    }
  };
  const hasFiles = (event: React.DragEvent) =>
    event.dataTransfer.types.includes("Files");
  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!next) requestClose();
          else onOpenChange(true);
        }}
      >
        <ChooserDialogContent
          className="h-[44rem] max-w-4xl rounded-blockui-lg border border-border bg-card"
          contentClassName="flex min-h-0 min-w-0 flex-1 flex-col p-0"
          headerClassName="p-6 pr-16 [&_h2]:text-base [&_h2]:font-semibold"
          headerTestId="community-catalog-dialog-header"
          scrollAreaClassName="flex min-h-0 overflow-hidden px-0"
          scrollAreaTestId="community-catalog-dialog-body"
          data-testid="community-catalog-dialog"
          title={title}
          onDragEnter={(event) => {
            if (!isImport || !hasFiles(event)) return;
            event.preventDefault();
            dragDepthRef.current += 1;
            setIsDragOver(true);
          }}
          onDragLeave={(event) => {
            if (!isImport) return;
            event.preventDefault();
            dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
            if (!dragDepthRef.current) setIsDragOver(false);
          }}
          onDragOver={(event) => {
            if (!isImport || !hasFiles(event)) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = "copy";
          }}
          onDrop={(event) => {
            if (!isImport || !hasFiles(event)) return;
            event.preventDefault();
            dragDepthRef.current = 0;
            setIsDragOver(false);
            const file = event.dataTransfer.files[0];
            if (file && !busy) void importFile(file);
          }}
        >
          {!selection ? (
            <nav
              aria-label="Add agent options"
              className="flex shrink-0 gap-2 border-b border-border px-6 pb-4"
            >
              {(["create", "import"] as const).map((value) => {
                const Icon = value === "create" ? Plus : Upload;
                return (
                  <Button
                    key={value}
                    aria-current={pane === value ? "page" : undefined}
                    variant={pane === value ? "default" : "ghost"}
                    size="sm"
                    disabled={busy}
                    data-testid={`agent-catalog-${value}`}
                    onClick={() => selectPane(value)}
                  >
                    <Icon aria-hidden="true" className="size-4" />
                    {value === "create" ? "Create agent" : "Import"}
                  </Button>
                );
              })}
            </nav>
          ) : null}
          <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
            {!selection && pane === "create"
              ? createContent({
                  onDirtyChange: (dirty) => {
                    createDirtyRef.current = dirty;
                  },
                  onRequestClose: requestClose,
                })
              : null}
            {isImport ? (
              <div className="flex min-h-0 flex-1 flex-col gap-4 p-6">
                <Action
                  disabled={busy}
                  className={cn(
                    "flex min-h-48 flex-1 flex-col items-center justify-center gap-4 rounded-blockui-lg border border-dashed border-border bg-muted/40 p-6 text-center hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring",
                    isDragOver && "border-primary bg-muted",
                  )}
                  data-testid="agent-catalog-import-dropzone"
                  onClick={() => fileInputRef.current?.click()}
                  type="button"
                >
                  <Upload
                    aria-hidden="true"
                    className="size-8 text-muted-foreground"
                  />
                  <span className="text-base font-semibold">
                    {readingFile
                      ? "Reading file…"
                      : isDragOver
                        ? "Drop to import"
                        : "Import an agent"}
                  </span>
                  <span className="max-w-sm text-sm text-muted-foreground">
                    Drop an .agent.json or .agent.png file here, or choose a
                    file.
                  </span>
                  <span className="rounded-blockui-pill bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">
                    Choose file
                  </span>
                </Action>
                {importError ? (
                  <p role="alert" className="text-sm text-destructive">
                    {importError}
                  </p>
                ) : null}
              </div>
            ) : null}
            {selection ? (
              <>
                <div
                  className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto p-6"
                  data-testid="community-catalog-detail-pane"
                >
                  {persona ? (
                    <PersonaCatalogDetail persona={persona} />
                  ) : team ? (
                    <TeamCatalogDetail team={team} />
                  ) : (
                    <p role="status" className="text-sm text-muted-foreground">
                      This item is no longer available in Browse.
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 justify-end gap-2 border-t border-border p-6">
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={requestClose}
                  >
                    Cancel
                  </Button>
                  <Button
                    disabled={busy || added || missing}
                    data-testid={
                      persona
                        ? `community-catalog-use-agent-${persona.id}`
                        : "community-catalog-add-team"
                    }
                    onClick={() => {
                      if (persona) {
                        onClearFeedback();
                        onSelectPersona(persona, true);
                      } else if (team) onAddTeam(team);
                    }}
                  >
                    {added
                      ? "Added"
                      : busy
                        ? "Adding…"
                        : team
                          ? "Add team"
                          : "Add agent"}
                  </Button>
                </div>
              </>
            ) : null}
          </div>
          <input
            accept=".agent.json,.agent.png"
            className="hidden"
            data-testid="agent-catalog-import-input"
            ref={fileInputRef}
            type="file"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void importFile(file);
              event.target.value = "";
            }}
          />
        </ChooserDialogContent>
      </Dialog>
      <AlertDialog
        open={pendingNavigation !== null}
        onOpenChange={(next) => {
          if (!next) setPendingNavigation(null);
        }}
      >
        <AlertDialogContent data-testid="discard-create-agent-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>Discard agent changes?</AlertDialogTitle>
            <AlertDialogDescription>
              Your changes to this agent will be lost.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep editing</AlertDialogCancel>
            <AlertDialogAction asChild>
              <Button
                variant="destructive"
                onClick={() => {
                  const next = pendingNavigation;
                  createDirtyRef.current = false;
                  setPendingNavigation(null);
                  if (next === "import") setPane("import");
                  else onOpenChange(false);
                }}
              >
                Discard changes
              </Button>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/**
 * Security review surface for instructions that will execute verbatim.
 *
 * Do not replace this with the chat Markdown renderer: Markdown intentionally
 * hides spoiler bodies, link destinations, and image sources, so the reviewed
 * text would differ from the system prompt sent to the agent.
 */
export function AgentInstructionReview({
  instructions,
}: {
  instructions: string;
}) {
  return (
    <pre
      className="mt-4 w-full min-w-0 max-w-full whitespace-pre-wrap break-words font-sans text-sm leading-6 text-muted-foreground"
      data-testid="persona-catalog-exact-instructions"
    >
      {instructions || "No instructions included."}
    </pre>
  );
}

function PersonaCatalogDetail({ persona }: { persona: AgentPersona }) {
  const description = effectiveAgentDescription(persona);
  const isCommunityEntry =
    isCatalogPersona(persona) && !persona.catalogSource.isOwn;
  const ownerPubkey = isCommunityEntry
    ? persona.catalogSource.ownerPubkey
    : undefined;
  const ownerBatchQuery = useUsersBatchQuery(ownerPubkey ? [ownerPubkey] : [], {
    enabled: !!ownerPubkey,
  });

  let addedByLabel: string;
  if (!isCommunityEntry) {
    addedByLabel = "You";
  } else {
    const summary = ownerPubkey
      ? ownerBatchQuery.data?.profiles[ownerPubkey.toLowerCase()]
      : undefined;
    addedByLabel = resolveCatalogOwnerLabel(summary);
  }

  return (
    <div className="w-full min-w-0 max-w-full space-y-6 overflow-x-hidden">
      <div className="flex items-center gap-4">
        <ProfileAvatar
          avatarUrl={persona.avatarUrl}
          className="h-12 w-12 text-sm"
          label={persona.displayName}
          untrusted
        />
        <div className="min-w-0">
          <h3 className="truncate text-base font-semibold leading-snug">
            {persona.displayName}
          </h3>
          {persona.isBuiltIn ? null : (
            <PersonaAddedBy className="mt-2" label={addedByLabel} />
          )}
        </div>
      </div>

      {description ? (
        <p
          className="min-w-0 max-w-prose break-all text-sm leading-6 text-muted-foreground"
          data-testid="persona-catalog-description"
        >
          {description}
        </p>
      ) : null}

      <AgentDefinitionMetadata
        isBuiltIn={persona.isBuiltIn}
        model={persona.model}
        provider={persona.provider}
        runtime={persona.runtime}
      />

      <div className="min-w-0 max-w-full pt-4">
        <p className="text-base font-semibold text-foreground">
          Agent instructions
        </p>
        <AgentInstructionReview instructions={persona.systemPrompt} />
      </div>
    </div>
  );
}

// ── Team detail ───────────────────────────────────────────────────────────────

function TeamCatalogDetail({ team }: { team: CatalogTeam }) {
  const ownerPubkey = team.isOwn ? undefined : team.ownerPubkey;
  const ownerBatchQuery = useUsersBatchQuery(ownerPubkey ? [ownerPubkey] : [], {
    enabled: !!ownerPubkey,
  });

  let addedByLabel: string;
  if (team.isOwn) {
    addedByLabel = "You";
  } else {
    const summary = ownerPubkey
      ? ownerBatchQuery.data?.profiles[ownerPubkey.toLowerCase()]
      : undefined;
    addedByLabel = resolveCatalogOwnerLabel(summary);
  }

  const hasInstructions =
    team.instructions !== null && team.instructions.trim().length > 0;

  return (
    <div className="w-full min-w-0 max-w-full space-y-6 overflow-x-hidden">
      <div className="min-w-0">
        <h3 className="truncate text-base font-semibold leading-snug">
          {team.name}
        </h3>
        <PersonaAddedBy className="mt-2" label={addedByLabel} />
        {team.description ? (
          <p className="mt-4 text-sm text-muted-foreground">
            {team.description}
          </p>
        ) : null}
      </div>

      {hasInstructions ? (
        <div className="min-w-0 max-w-full pt-4">
          <p className="text-base font-semibold text-foreground">
            Team instructions
          </p>
          <AgentInstructionReview instructions={team.instructions ?? ""} />
        </div>
      ) : null}

      <div className="min-w-0">
        <p className="text-base font-semibold text-foreground">
          {team.members.length}{" "}
          {team.members.length === 1 ? "member" : "members"}
        </p>
        <ul className="mt-4 space-y-2">
          {team.members.map((member) => (
            <TeamCatalogMemberRow key={member.memberKey} member={member} />
          ))}
        </ul>
      </div>
    </div>
  );
}

type TeamCatalogMemberRowProps = {
  member: CatalogTeam["members"][number];
};

function TeamCatalogMemberRow({ member }: TeamCatalogMemberRowProps) {
  const [expanded, setExpanded] = React.useState(false);

  return (
    <li
      className="overflow-hidden rounded-blockui-md border border-border/70 bg-card/70"
      data-testid={`community-catalog-member-${member.memberKey}`}
    >
      <Action
        aria-expanded={expanded}
        className="flex w-full items-center gap-4 px-4 py-2 text-left transition-colors hover:bg-muted/30 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset"
        data-testid={`community-catalog-member-expand-${member.memberKey}`}
        onClick={() => setExpanded((v) => !v)}
        type="button"
      >
        <ProfileAvatar
          avatarUrl={member.avatarUrl}
          className="h-8 w-8 shrink-0 text-xs"
          label={member.displayName}
          untrusted
        />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{member.displayName}</p>
          <p className="truncate text-xs text-muted-foreground">
            {member.model ?? "Use app default"}
          </p>
        </div>
        <ChevronDown
          className={cn(
            "size-4 shrink-0 text-muted-foreground transition-transform",
            expanded && "rotate-180",
          )}
        />
      </Action>

      {expanded ? (
        <div className="space-y-4 border-t border-border/60 px-4 pb-4 pt-4">
          <AgentDefinitionMetadata
            isBuiltIn={false}
            model={member.model}
            provider={member.provider}
            runtime={member.runtime}
          />
          <div className="min-w-0 max-w-full">
            <p className="text-sm font-semibold text-foreground">
              Agent instructions
            </p>
            {member.systemPrompt.trim().length > 0 ? (
              <AgentInstructionReview instructions={member.systemPrompt} />
            ) : (
              <p className="mt-4 text-sm italic text-muted-foreground">
                No instructions
              </p>
            )}
          </div>
        </div>
      ) : null}
    </li>
  );
}
