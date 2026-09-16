import { Label as BlockLabel } from "@/shared/blockui/components/label";
import { cn } from "@/shared/lib/cn";
import { Input } from "@/shared/ui/input";
import {
  PERSONA_FIELD_CONTROL_CLASS,
  PERSONA_FIELD_SHELL_CLASS,
} from "./agentConfigOptions";

/** Agent identity name field with the shared form styling. */
export function EditAgentNameField({
  disabled,
  value,
  onChange,
}: {
  disabled: boolean;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="space-y-1.5">
      <BlockLabel
        className="text-sm font-medium text-foreground"
        htmlFor="edit-agent-name"
      >
        Agent name
      </BlockLabel>
      <div
        className={cn(
          "flex min-h-11 items-center px-3",
          PERSONA_FIELD_SHELL_CLASS,
        )}
      >
        <Input
          autoCorrect="off"
          className={cn("h-8 px-0 py-0 leading-6", PERSONA_FIELD_CONTROL_CLASS)}
          disabled={disabled}
          id="edit-agent-name"
          onChange={(event) => onChange(event.target.value)}
          placeholder="Agent name"
          value={value}
        />
      </div>
    </div>
  );
}
