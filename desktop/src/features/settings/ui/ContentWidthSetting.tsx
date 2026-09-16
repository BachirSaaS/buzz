import {
  setContentWidth,
  useContentWidth,
} from "@/shared/lib/contentWidthPreference";
import { SegmentedControl } from "@/shared/ui/segmented-control";
import { SettingsOptionRow } from "./SettingsOptionGroup";

/** Device-wide workspace width control in Appearance. */
export function ContentWidthSetting() {
  const width = useContentWidth();
  return (
    <SettingsOptionRow>
      <div className="min-w-0">
        <p className="text-sm font-medium">Content width</p>
        <p className="text-sm text-muted-foreground" data-settings-subcopy>
          Drag the bottom-right corner to set a custom size, or choose a preset.
        </p>
      </div>
      <SegmentedControl
        legend="Content width"
        value={width}
        onValueChange={setContentWidth}
        testId="content-width-control"
        optionTestIdPrefix="content-width"
        options={[
          { value: "standard", label: "Standard" },
          { value: "full", label: "Full width" },
          { value: "custom", label: "Custom" },
        ]}
      />
    </SettingsOptionRow>
  );
}
