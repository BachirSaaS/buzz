import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { invokeTauri } from "@/shared/api/tauri";
import { Shield } from "lucide-react";
import type { AgentSecurityPolicy } from "@/shared/api/types";
import { Button } from "@/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/shared/ui/dialog";
import {
  AgentSecurityField,
  normalizeSecurityDraft,
  securityDraftError,
} from "./AgentSecurityField";

/** One draft and one Save for either the local default or one agent. */
export function AgentSecurityDialog({
  title,
  description,
  initialPolicy,
  defaultPolicy,
  availability,
  running,
  agent,
  onClose,
  onSave,
}: {
  title: string;
  description: string;
  initialPolicy: AgentSecurityPolicy | null;
  defaultPolicy?: AgentSecurityPolicy | null;
  availability: "available" | "unsupported" | "unknown";
  running?: boolean;
  agent?: { pubkey: string; relayUrl: string };
  onClose: () => void;
  onSave: (policy: AgentSecurityPolicy | null) => Promise<void>;
}) {
  const connections = useQuery({
    queryKey: ["agent-security-connections", agent?.pubkey, agent?.relayUrl],
    queryFn: () =>
      invokeTauri<string[]>("get_agent_security_connections", {
        pubkey: agent?.pubkey ?? null,
      }),
    retry: false,
  });
  const [draft, setDraft] = React.useState(() =>
    structuredClone(initialPolicy),
  );
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const effectiveDraft =
    draft?.network.mode === "allowlist"
      ? {
          ...draft,
          network: {
            mode: "allowlist" as const,
            destinations: [
              ...new Set([
                ...draft.network.destinations,
                ...(connections.data ?? []),
              ]),
            ],
          },
        }
      : draft;
  const validation = securityDraftError(effectiveDraft);
  const connectionsUnavailable =
    draft?.network.mode === "allowlist" && !connections.isSuccess;
  async function save() {
    if (saving || validation || connectionsUnavailable) return;
    setSaving(true);
    setError(null);
    try {
      await onSave(normalizeSecurityDraft(effectiveDraft));
      onClose();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
      setSaving(false);
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !saving) onClose();
      }}
    >
      <DialogContent
        className="flex max-h-[85dvh] max-w-xl flex-col gap-0 overflow-hidden p-0"
        data-testid="agent-security-dialog"
        showCloseButton={!saving}
      >
        <header className="shrink-0 border-b px-6 py-5">
          <div className="mb-2 flex items-center gap-2 text-xs font-medium text-muted-foreground">
            <Shield className="h-4 w-4" aria-hidden="true" /> ON THIS MAC{" "}
            <span className="rounded-full bg-muted px-2 py-0.5">
              Experimental
            </span>
          </div>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription className="mt-2 pr-4">
            {description}
          </DialogDescription>
        </header>
        <div className="min-h-0 min-w-0 flex-1 overflow-y-auto px-6 py-5">
          <AgentSecurityField
            value={effectiveDraft}
            onChange={setDraft}
            disabled={saving}
            availability={availability}
            suggestedDomains={connections.data ?? []}
            connectionsLoading={connections.isPending}
            connectionsError={connections.isError}
          />
        </div>
        <footer className="shrink-0 space-y-3 border-t bg-muted/20 px-6 py-4">
          {error && (
            <p role="alert" className="break-words text-sm text-destructive">
              {error}
            </p>
          )}
          {validation && (
            <p role="status" className="text-xs text-muted-foreground">
              {validation}
            </p>
          )}
          {running && (
            <p className="text-xs text-muted-foreground">
              Saving restarts this agent to apply its settings.
            </p>
          )}
          <div className="flex flex-wrap items-center justify-end gap-2">
            {defaultPolicy !== undefined && (
              <Button
                className="mr-auto"
                variant="ghost"
                disabled={
                  saving ||
                  availability !== "available" ||
                  !connections.isSuccess
                }
                onClick={() => setDraft(structuredClone(defaultPolicy))}
              >
                Use current default
              </Button>
            )}
            <Button variant="outline" disabled={saving} onClick={onClose}>
              Cancel
            </Button>
            <Button
              disabled={
                saving ||
                Boolean(validation) ||
                availability === "unknown" ||
                connectionsUnavailable
              }
              onClick={() => void save()}
            >
              {saving ? "Saving…" : "Save changes"}
            </Button>
          </div>
        </footer>
      </DialogContent>
    </Dialog>
  );
}
