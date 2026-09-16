import { Shield } from "lucide-react";
import { useSecurityDefaultsQuery } from "../securityDefaults";
import { securityPolicySummary } from "./AgentSecurityField";

/** Preview only: native creation applies the current default atomically. */
export function NewAgentSecurityNotice({ local }: { local: boolean }) {
  const defaults = useSecurityDefaultsQuery();
  if (!local || !defaults.data?.experimental_enabled) return null;
  return (
    <section
      className="rounded-xl border bg-muted/20 p-4 text-sm"
      aria-label="Default security for new agents"
    >
      <p className="flex items-center gap-2 font-medium">
        <Shield className="h-4 w-4" aria-hidden="true" /> Default security
      </p>
      <p className="mt-2 text-muted-foreground">
        {securityPolicySummary(defaults.data.policy)}
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        Applied to supported local agents. After adding an agent, open its
        Runtime tab to customize security. Change the default in Settings →
        Agents.
      </p>
    </section>
  );
}
