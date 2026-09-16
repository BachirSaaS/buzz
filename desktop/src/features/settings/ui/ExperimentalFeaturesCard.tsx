import { setAgentManagedProfiles } from "@/shared/api/tauriWorkspace";
import {
  useSaveSecurityDefaultsMutation,
  useSecurityDefaultsQuery,
} from "@/features/agents/securityDefaults";
import { desktopFeatures, useFeatureToggle } from "@/shared/features";
import type { FeatureDefinition } from "@/shared/features";
import { Switch } from "@/shared/ui/switch";
import { Button } from "@/shared/ui/button";
import { SettingsOptionGroup, SettingsOptionRow } from "./SettingsOptionGroup";
import { SettingsSectionHeader } from "./SettingsSectionHeader";

function AgentSecurityFeatureRow({ feature }: { feature: FeatureDefinition }) {
  const defaults = useSecurityDefaultsQuery();
  const save = useSaveSecurityDefaultsMutation();
  const switchId = `feature-toggle-${feature.id}`;
  const ready = defaults.isSuccess && !defaults.isFetching;

  return (
    <SettingsOptionRow>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium" id={`${switchId}-label`}>
          {feature.name}
        </p>
        <p className="text-xs text-muted-foreground/70" data-settings-subcopy>
          {feature.description} Enables security setup for new agents. Saved
          agent protections remain when this is off.
        </p>
        {defaults.isPending && (
          <p className="mt-1 text-xs text-muted-foreground" role="status">
            Loading security settings…
          </p>
        )}
        {defaults.isError && (
          <div className="mt-1 text-xs text-destructive" role="alert">
            Couldn’t load security settings. {String(defaults.error)}
            <Button
              className="ml-2"
              disabled={defaults.isFetching}
              onClick={() => void defaults.refetch()}
              size="xs"
              variant="link"
            >
              Retry
            </Button>
          </div>
        )}
        {save.isError && (
          <p className="mt-1 text-xs text-destructive" role="alert">
            Couldn’t save this setting. Try again. {String(save.error)}
          </p>
        )}
      </div>
      <Switch
        aria-labelledby={`${switchId}-label`}
        checked={defaults.data?.experimental_enabled ?? false}
        data-testid={switchId}
        disabled={!ready || save.isPending}
        onCheckedChange={async (enabled) => {
          if (!ready || !defaults.data) return;
          try {
            await save.mutateAsync({
              ...defaults.data,
              experimental_enabled: enabled,
            });
          } catch {
            // The mutation retains the failure for the retryable inline error.
          }
        }}
      />
    </SettingsOptionRow>
  );
}

function FeatureRow({ feature }: { feature: FeatureDefinition }) {
  const [enabled, toggle] = useFeatureToggle(feature.id);
  const switchId = `feature-toggle-${feature.id}`;

  return (
    <SettingsOptionRow>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium" id={`${switchId}-label`}>
          {feature.name}
        </p>
        <p className="text-xs text-muted-foreground/70" data-settings-subcopy>
          {feature.description}
        </p>
      </div>
      <Switch
        aria-labelledby={`${switchId}-label`}
        checked={enabled}
        data-testid={switchId}
        onCheckedChange={(value) => {
          toggle(value);
          if (feature.id === "agentManagedProfiles") {
            void setAgentManagedProfiles(value).catch((error) => {
              console.error(
                "Failed to apply agent-managed profiles setting:",
                error,
              );
            });
          }
        }}
      />
    </SettingsOptionRow>
  );
}

export function ExperimentalFeaturesCard() {
  // Manifest is preview-only by definition; every desktop entry is a preview
  // feature.
  const previewFeatures = desktopFeatures;

  return (
    <section className="min-w-0" data-testid="settings-experimental">
      <SettingsSectionHeader
        title="Experiments"
        description={
          <>
            These features are functional but still being refined. Enable them
            to try new capabilities early.
          </>
        }
      />

      <SettingsOptionGroup title="Features">
        {previewFeatures.map((f) =>
          f.id === "agentSecurity" ? (
            <AgentSecurityFeatureRow feature={f} key={f.id} />
          ) : (
            <FeatureRow feature={f} key={f.id} />
          ),
        )}
      </SettingsOptionGroup>
    </section>
  );
}
