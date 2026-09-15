import { Action } from "@/shared/ui/action";
import { WorkspaceSidebarButton } from "@/shared/ui/workspace-sidebar-button";
import * as React from "react";
import { getVersion } from "@tauri-apps/api/app";
import { AlertCircle, LoaderCircle, RefreshCw } from "lucide-react";

import { useMyRelayMembershipLookupQuery } from "@/features/community-members/hooks";
import {
  canManageCommunityMembers,
  shouldWarnMissingMembershipSnapshot,
} from "@/shared/api/relayMembers";
import {
  getFeature,
  resolveEnabled,
  useFeatureSnapshot,
} from "@/shared/features";
import { cn } from "@/shared/lib/cn";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarInset,
  SidebarMenu,
  SidebarMenuItem,
} from "@/shared/ui/sidebar";
import {
  renderSettingsSection,
  settingsSections,
  type SettingsPanelProps,
  type SettingsSection,
  type SettingsSectionDescriptor,
} from "./SettingsPanels";

export {
  DEFAULT_SETTINGS_SECTION,
  type SettingsSection,
} from "./SettingsPanels";

type SettingsViewProps = SettingsPanelProps & {
  onClose: () => void;
  onSectionChange: (section: SettingsSection) => void;
  section: SettingsSection;
};

const settingsNavGroups: Array<{
  label: string;
  sections: SettingsSection[];
}> = [
  {
    label: "Personal",
    sections: [
      "profile",
      "appearance",
      "notifications",
      "voice",
      "shortcuts",
      "custom-emoji",
      "local-archive",
      "channel-templates",
    ],
  },
  {
    label: "Communities",
    sections: ["hosted-communities", "community-members"],
  },
  {
    label: "App",
    sections: ["agents", "compute", "experimental", "mobile", "updates"],
  },
];

function SettingsSectionButton({
  active,
  onSelect,
  section,
}: {
  active: boolean;
  onSelect: (section: SettingsSection) => void;
  section: (typeof settingsSections)[number];
}) {
  const Icon = section.icon;

  return (
    <SidebarMenuItem>
      <WorkspaceSidebarButton
        active={active}
        aria-pressed={active}
        data-testid={`settings-nav-${section.value}`}
        onClick={() => onSelect(section.value)}
      >
        <Icon aria-hidden="true" className="size-4" />
        <span className="min-w-0 truncate">{section.label}</span>
      </WorkspaceSidebarButton>
    </SidebarMenuItem>
  );
}

export function SettingsView({
  currentPubkey,
  fallbackDisplayName,
  isUpdatingDesktopNotifications,
  notificationErrorMessage,
  notificationPermission,
  notificationSettings,
  onClose,
  onSectionChange,
  onSetDesktopNotificationsEnabled,
  onSetHomeBadgeEnabled,
  onSetSlotAlertsEnabled,
  onSetNotifyWhileViewing,
  onSetAllSlotAlertsEnabled,
  onSetSoundForSlot,
  section,
}: SettingsViewProps) {
  const myMembershipQuery = useMyRelayMembershipLookupQuery();
  const featureState = useFeatureSnapshot();
  const visibleSections = React.useMemo(() => {
    return settingsSections.filter((s) => {
      // Feature gate check. Manifest is preview-only — if the gate id is in
      // the manifest, it's preview and needs an opt-in; if it's not, it's
      // stable and renders unconditionally (fail-open).
      if (s.featureGate) {
        const feature = getFeature(s.featureGate);
        if (
          feature &&
          !resolveEnabled(s.featureGate, featureState, feature.defaultEnabled)
        ) {
          return false;
        }
      }
      // Invites and member management require a discovered owner/admin role.
      // Open relays have no membership snapshot or invite controls.
      if (s.value === "community-members") {
        return canManageCommunityMembers(myMembershipQuery.data);
      }
      return true;
    });
  }, [myMembershipQuery.data, featureState]);

  const [isLoaded, setIsLoaded] = React.useState(false);
  const [appVersion, setAppVersion] = React.useState<string | null>(null);

  React.useEffect(() => {
    const frameId = window.requestAnimationFrame(() => setIsLoaded(true));
    return () => window.cancelAnimationFrame(frameId);
  }, []);

  React.useEffect(() => {
    void getVersion().then(setAppVersion);
  }, []);

  React.useEffect(() => {
    if (!visibleSections.some((entry) => entry.value === section)) {
      onSectionChange(visibleSections[0]?.value ?? "appearance");
    }
  }, [onSectionChange, section, visibleSections]);

  React.useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !event.defaultPrevented) {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const visibleSectionByValue = React.useMemo(
    () => new Map(visibleSections.map((entry) => [entry.value, entry])),
    [visibleSections],
  );
  const visibleNavGroups = React.useMemo(
    () =>
      settingsNavGroups
        .map((group) => ({
          ...group,
          sections: group.sections
            .map((value) => visibleSectionByValue.get(value))
            .filter(
              (entry): entry is SettingsSectionDescriptor => entry != null,
            ),
        }))
        .filter((group) => group.sections.length > 0),
    [visibleSectionByValue],
  );

  return (
    <>
      <Sidebar
        className="w-[220px] shrink-0 border-r border-border bg-muted/30"
        collapsible="none"
        data-testid="settings-sidebar"
        variant="sidebar"
      >
        <h1 className="px-8 pb-3 pt-5 text-base font-semibold">Settings</h1>
        <SidebarContent className="gap-0">
          {myMembershipQuery.isPending ? (
            <div
              className="mx-3 flex items-center gap-2 rounded-md border border-sidebar-border px-3 py-2 text-xs text-sidebar-foreground/70"
              data-testid="community-access-loading"
            >
              <LoaderCircle className="size-3.5 animate-spin" />
              Checking invite permissions…
            </div>
          ) : null}
          {myMembershipQuery.isError ? (
            <div
              className="mx-3 space-y-2 rounded-md border border-destructive/40 px-3 py-2 text-xs text-sidebar-foreground"
              data-testid="community-access-error"
            >
              <div className="flex items-center gap-2">
                <AlertCircle className="size-3.5 text-destructive" />
                Invite settings could not be checked.
              </div>
              <Action
                className="flex items-center gap-1.5 font-medium text-sidebar-foreground underline-offset-2 hover:underline"
                onClick={() => void myMembershipQuery.refetch()}
                type="button"
              >
                <RefreshCw className="size-3.5" />
                Try again
              </Action>
            </div>
          ) : null}
          {shouldWarnMissingMembershipSnapshot(myMembershipQuery.data) ? (
            <div
              className="mx-3 flex items-start gap-2 rounded-md border border-warning-foreground/30 px-3 py-2 text-xs text-sidebar-foreground"
              data-testid="community-access-snapshot-missing"
            >
              <AlertCircle className="mt-0.5 size-3.5 shrink-0 text-warning-foreground" />
              Invite settings are unavailable. Relay recovery may still be in
              progress.
            </div>
          ) : null}
          {visibleNavGroups.map((group, index) => (
            <React.Fragment key={group.label}>
              {index > 0 ? <hr className="mx-4 my-2 border-border" /> : null}
              <SidebarGroup className="px-4 py-2">
                <SidebarGroupLabel className="px-4">
                  {group.label}
                </SidebarGroupLabel>
                <SidebarGroupContent>
                  <SidebarMenu
                    className="gap-2"
                    aria-label={`${group.label} settings sections`}
                  >
                    {group.sections.map((entry) => (
                      <SettingsSectionButton
                        active={entry.value === section}
                        key={entry.value}
                        onSelect={onSectionChange}
                        section={entry}
                      />
                    ))}
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
            </React.Fragment>
          ))}
        </SidebarContent>

        <SidebarFooter>
          {appVersion ? (
            <p
              className="px-2 pb-1 text-xs text-sidebar-foreground/45"
              data-buzz-sidebar-secondary
              data-testid="settings-version"
            >
              v{appVersion}
            </p>
          ) : null}
        </SidebarFooter>
      </Sidebar>

      <SidebarInset
        className={cn(
          "isolate relative min-h-0 min-w-0 overflow-hidden bg-background motion-safe:transition-opacity motion-safe:duration-200",
          isLoaded ? "opacity-100" : "opacity-0",
        )}
        data-buzz-shadow-viewport
        data-testid="settings-view"
      >
        <div
          className="relative z-10 flex min-h-0 flex-1 flex-col overflow-hidden bg-background"
          data-buzz-content-surface
          data-testid="settings-content-surface"
        >
          <section
            className="min-h-0 flex-1 overflow-y-auto px-5 pb-12 pt-6 sm:px-6"
            data-testid="settings-content-scroll"
          >
            <div
              className="mx-auto flex min-h-full w-full max-w-4xl flex-col gap-4"
              data-testid={`settings-panel-${section}`}
            >
              {renderSettingsSection(section, {
                currentPubkey,
                fallbackDisplayName,
                isUpdatingDesktopNotifications,
                notificationErrorMessage,
                notificationPermission,
                notificationSettings,
                onSetDesktopNotificationsEnabled,
                onSetHomeBadgeEnabled,
                onSetSlotAlertsEnabled,
                onSetNotifyWhileViewing,
                onSetAllSlotAlertsEnabled,
                onSetSoundForSlot,
              })}
            </div>
          </section>
        </div>
      </SidebarInset>
    </>
  );
}
