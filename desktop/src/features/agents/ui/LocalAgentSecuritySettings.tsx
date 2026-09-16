import * as React from "react";
import { Shield } from "lucide-react";
import { toast } from "sonner";
import type { ManagedAgent } from "@/shared/api/types";
import { Button } from "@/shared/ui/button";
import { useAcpRuntimesQuery, useUpdateManagedAgentMutation } from "../hooks";
import { useSecurityDefaultsQuery } from "../securityDefaults";
import { sandpitAvailability } from "../lib/agentConfigCore";
import { isManagedAgentActive } from "../lib/managedAgentControlActions";
import { AgentSecurityDialog } from "./AgentSecurityDialog";
import { securityPolicySummary } from "./AgentSecurityField";

/** Local policies never become part of the shared agent definition. */
export function LocalAgentSecuritySettings({ agent }: { agent: ManagedAgent }) {
  const [open, setOpen] = React.useState(false);
  const defaults = useSecurityDefaultsQuery();
  const update = useUpdateManagedAgentMutation();
  const runtimes = useAcpRuntimesQuery({ enabled: open });
  const runtime = runtimes.data?.find((entry) => entry.id === agent.runtime);
  if (agent.backend.type !== "local" || !defaults.data?.experimental_enabled)
    return null;
  return (
    <section
      className="rounded-xl border bg-muted/20 p-4"
      aria-label="Agent security"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <Shield
            className="h-4 w-4 shrink-0 text-muted-foreground"
            aria-hidden="true"
          />
          <h3 className="text-sm font-medium">Security</h3>
        </div>
        <span className="text-xs text-muted-foreground">
          {agent.securityStatus ?? "Not running"}
        </span>
      </div>
      <p className="mt-2 text-sm text-muted-foreground">
        {securityPolicySummary(agent.securityPolicy ?? null)}
      </p>
      <Button
        className="mt-3"
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
      >
        Edit security
      </Button>
      {open && (
        <AgentSecurityDialog
          agent={agent}
          title="Agent security"
          description={`Choose what ${agent.name} can access. Changes apply only to this agent on this Mac.`}
          initialPolicy={agent.securityPolicy ?? null}
          defaultPolicy={defaults.data.policy}
          availability={sandpitAvailability(
            runtime,
            runtimes.isPending
              ? "loading"
              : runtimes.isError
                ? "error"
                : "ready",
          )}
          running={isManagedAgentActive(agent)}
          onClose={() => setOpen(false)}
          onSave={async (securityPolicy) => {
            const result = await update.mutateAsync({
              pubkey: agent.pubkey,
              relayUrl: agent.relayUrl,
              securityPolicy,
            });
            if (result.profileSyncError) toast.warning(result.profileSyncError);
          }}
        />
      )}
    </section>
  );
}
