import * as React from "react";
import { Shield } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { useAcpRuntimesQuery } from "@/features/agents/hooks";
import {
  useSecurityDefaultsQuery,
  useSaveSecurityDefaultsMutation,
} from "@/features/agents/securityDefaults";
import { AgentSecurityDialog } from "@/features/agents/ui/AgentSecurityDialog";
import { securityPolicySummary } from "@/features/agents/ui/AgentSecurityField";
import { SettingsOptionGroup, SettingsOptionRow } from "./SettingsOptionGroup";

export function AgentSecurityDefaultsCard() {
  const [open, setOpen] = React.useState(false);
  const defaults = useSecurityDefaultsQuery();
  const save = useSaveSecurityDefaultsMutation();
  const runtimes = useAcpRuntimesQuery({ enabled: open });
  if (!defaults.data?.experimental_enabled) return null;
  const settings = defaults.data;
  return (
    <SettingsOptionGroup
      title="Default security"
      data-testid="security-defaults-card"
    >
      <SettingsOptionRow>
        <div className="min-w-0 space-y-1">
          <p className="flex items-center gap-2 text-sm font-medium">
            <Shield className="h-4 w-4" aria-hidden="true" />
            {securityPolicySummary(settings.policy)}
          </p>
          <p className="text-xs text-muted-foreground">
            New supported local agents start with these settings. Existing
            agents keep their own settings.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
          Edit default
        </Button>
      </SettingsOptionRow>
      {open && (
        <AgentSecurityDialog
          title="Default security"
          description="Set a starting point for new local agents on this Mac. You can customize each agent later."
          initialPolicy={settings.policy}
          availability={
            runtimes.isPending || runtimes.isError
              ? "unknown"
              : runtimes.data?.some((entry) => entry.supportsSandpit)
                ? "available"
                : "unsupported"
          }
          onClose={() => setOpen(false)}
          onSave={async (policy) => {
            await save.mutateAsync({ ...settings, policy });
          }}
        />
      )}
    </SettingsOptionGroup>
  );
}
