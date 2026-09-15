import type { ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import { allowNavigation } from "@/app/navigation/navigationGuard";
import { parseProjectDetailSearch } from "@/features/projects/lib/projectDetailSearch";
import type { PulseApp } from "./PulseAppNavigation";
import { PulseWorkspaceFrame } from "./PulseWorkspaceFrame";

/** Settings keeps the app dock and returns to the last selected conversation. */
export function PulseSettingsWorkspace({
  children,
  lastPulseSearch,
}: {
  children: ReactNode;
  lastPulseSearch: Record<string, unknown>;
}) {
  const navigate = useNavigate();
  const selectApp = (app: PulseApp) => {
    const feed = app === "messages" ? "conversation" : app;
    if (!allowNavigation({ kind: "route", href: `/pulse?feed=${feed}` }))
      return;
    void navigate({
      to: "/pulse",
      search: {
        ...parseProjectDetailSearch({}),
        conversation:
          typeof lastPulseSearch.conversation === "string"
            ? lastPulseSearch.conversation
            : undefined,
        feed,
      },
    });
  };
  return (
    <PulseWorkspaceFrame
      active="settings"
      onSelect={selectApp}
      testId="pulse-settings-workspace"
    >
      <div className="flex min-h-0 flex-1">{children}</div>
    </PulseWorkspaceFrame>
  );
}
