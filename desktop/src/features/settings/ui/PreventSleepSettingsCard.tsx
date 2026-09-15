import { Label as BlockLabel } from "@/shared/blockui/components/label";
import { usePreventSleepContext } from "@/features/agents/usePreventSleep";
import { Switch } from "@/shared/ui/switch";
import { SettingsOptionGroup, SettingsOptionRow } from "./SettingsOptionGroup";

export function PreventSleepSettingsCard() {
  const { enabled, setEnabled, hasRunningAgents, expired, clearExpired } =
    usePreventSleepContext();

  return (
    <div className="min-w-0 space-y-3">
      <SettingsOptionGroup
        data-testid="agents-preferences-card"
        title="Preferences"
      >
        <SettingsOptionRow>
          <div className="min-w-0">
            <BlockLabel
              className="text-sm font-medium"
              htmlFor="prevent-sleep-switch"
            >
              Keep awake while agents are active
            </BlockLabel>
            <p
              className="text-sm font-normal text-muted-foreground"
              data-settings-subcopy
            >
              Prevents your computer from sleeping while local agents are
              running. Automatically releases when all agents stop or after 1
              hour without agent activity.
            </p>
          </div>
          <Switch
            checked={enabled}
            data-testid="prevent-sleep-toggle"
            id="prevent-sleep-switch"
            onCheckedChange={(checked) => {
              if (expired) {
                clearExpired();
              }
              setEnabled(checked);
            }}
          />
        </SettingsOptionRow>
      </SettingsOptionGroup>

      {enabled && !hasRunningAgents && (
        <p className="mt-3 text-sm text-muted-foreground">
          Waiting for agents to start
        </p>
      )}

      {expired && (
        <p className="mt-3 rounded-xl border border-warning-foreground/30 bg-warning px-3 py-2 text-sm text-warning-foreground dark:text-warning-foreground">
          Sleep prevention expired after 1 hour without agent activity. It will
          resume on the next agent activity, or toggle off and on to re-enable
          now.
        </p>
      )}
    </div>
  );
}
