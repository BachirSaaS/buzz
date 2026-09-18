import { useCallback, type ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useIdentityQuery } from "@/shared/api/hooks";
import { useRelayOrigin } from "@/shared/lib/useRelayOrigin";
import { WORKSPACE_ROUTE_KEYS } from "../lib/pulseWorkspaces";
import { usePulseWorkspaces } from "../lib/usePulseWorkspaces";
import { PulseWorkspaceFrame } from "./PulseWorkspaceFrame";

/** Settings returns to the workspace and destination that opened it. */
export function PulseSettingsWorkspace({
  children,
  lastPulseSearch,
}: {
  children: ReactNode;
  lastPulseSearch: Record<string, unknown>;
}) {
  const navigate = useNavigate();
  const identity = useIdentityQuery();
  const relay = useRelayOrigin();
  const keys = ["workspace", ...WORKSPACE_ROUTE_KEYS] as const;
  type Values = Record<(typeof keys)[number], string | null>;
  const values = Object.fromEntries(
    keys.map((key) => [
      key,
      typeof lastPulseSearch[key] === "string" ? lastPulseSearch[key] : null,
    ]),
  ) as Values;
  const applyPatch = useCallback(
    (patch: Partial<Values>) => {
      const search = Object.fromEntries(
        Object.entries(patch).filter(([, value]) => value !== null),
      );
      void navigate({ to: "/pulse", search } as never);
    },
    [navigate],
  );
  const workspaces = usePulseWorkspaces(
    relay && identity.data?.pubkey ? `${relay}:${identity.data.pubkey}` : null,
    values,
    applyPatch,
    false,
  );
  return (
    <PulseWorkspaceFrame
      active="settings"
      workspaces={workspaces}
      testId="pulse-settings-workspace"
    >
      <div className="flex min-h-0 flex-1">{children}</div>
    </PulseWorkspaceFrame>
  );
}
