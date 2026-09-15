import { createFileRoute } from "@tanstack/react-router";

import {
  type SettingsSection,
  isSettingsSection,
} from "@/features/settings/ui/SettingsPanels";

type SettingsRouteSearch = {
  section?: SettingsSection;
};

function validateSettingsSearch(
  search: Record<string, unknown>,
): SettingsRouteSearch {
  if (search.section === "doctor") {
    return { section: "agents" };
  }

  return {
    section: isSettingsSection(search.section) ? search.section : undefined,
  };
}

export const Route = createFileRoute("/settings")({
  validateSearch: validateSettingsSearch,
  component: SettingsRouteComponent,
});

// AppShell renders Settings inside the shared dock workspace.
function SettingsRouteComponent() {
  return null;
}
