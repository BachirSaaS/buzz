import { useCallback, type ReactNode } from "react";
import {
  NavigationTargetContext,
  type AppNavigationTarget,
} from "@/app/navigation/NavigationTargetContext";
import { useHistorySearchState } from "@/shared/hooks/useHistorySearchState";
import { WORKSPACE_ROUTE_KEYS, workspaceRoute } from "../lib/pulseWorkspaces";
import { workspaceNavigationTarget } from "../lib/workspaceNavigation";
const keys = ["workspace", ...WORKSPACE_ROUTE_KEYS] as const;
/** Feature links keep their canonical behavior while retaining workspace ownership. */
export function PulseWorkspaceNavigation({
  children,
}: {
  children: ReactNode;
}) {
  const { values } = useHistorySearchState(keys);
  const routeKey = JSON.stringify(workspaceRoute(values));
  const resolve = useCallback(
    (target: AppNavigationTarget): AppNavigationTarget => {
      if (target.to === "/pulse")
        return {
          ...target,
          search: {
            ...JSON.parse(routeKey),
            ...target.search,
            workspace: values.workspace ?? undefined,
          },
        };
      return workspaceNavigationTarget(
        target,
        values.conversation,
        values.workspace,
      );
    },
    [routeKey, values.workspace, values.conversation],
  );
  return (
    <NavigationTargetContext.Provider value={resolve}>
      {children}
    </NavigationTargetContext.Provider>
  );
}
