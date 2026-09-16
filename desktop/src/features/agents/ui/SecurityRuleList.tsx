import { useId, useRef } from "react";
import { Plus, X } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";

/** Editable rule rows. Enter adds a row; every action stays in the parent draft. */
export function SecurityRuleList({
  label,
  description,
  values,
  onChange,
  disabled,
  placeholder,
  addLabel,
}: {
  label: string;
  description: string;
  values: string[];
  onChange: (values: string[]) => void;
  disabled: boolean;
  placeholder: string;
  addLabel: string;
}) {
  const id = useId();
  const inputs = useRef<Array<HTMLInputElement | null>>([]);
  const add = () => {
    onChange([...values, ""]);
    requestAnimationFrame(() => inputs.current[values.length]?.focus());
  };
  return (
    <fieldset className="min-w-0 space-y-2" disabled={disabled}>
      <legend className="text-sm font-medium">{label}</legend>
      <p
        id={`${id}-help`}
        className="text-xs leading-relaxed text-muted-foreground"
      >
        {description}
      </p>
      <div className="space-y-2">
        {values.map((value, index) => (
          <div
            className="flex min-w-0 items-center gap-2"
            // biome-ignore lint/suspicious/noArrayIndexKey: Rows are fully controlled positional slots; typing must not remount the focused input.
            key={`${id}-${index}`}
          >
            <Input
              ref={(element) => {
                inputs.current[index] = element;
              }}
              aria-label={`${label} ${index + 1}`}
              aria-describedby={`${id}-help`}
              className="min-w-0 flex-1 font-mono text-xs"
              value={value}
              placeholder={placeholder}
              onChange={(event) =>
                onChange(
                  values.map((item, i) =>
                    i === index ? event.target.value : item,
                  ),
                )
              }
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  if (index === values.length - 1 && value.trim()) add();
                  else inputs.current[index + 1]?.focus();
                }
              }}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={`Remove ${label.toLowerCase()} ${index + 1}`}
              onClick={() => {
                onChange(values.filter((_, i) => i !== index));
                requestAnimationFrame(() =>
                  inputs.current[Math.max(0, index - 1)]?.focus(),
                );
              }}
            >
              <X className="size-4" aria-hidden="true" />
            </Button>
          </div>
        ))}
      </div>
      <Button type="button" variant="outline" size="sm" onClick={add}>
        <Plus className="size-3.5" aria-hidden="true" />
        {addLabel}
      </Button>
    </fieldset>
  );
}
