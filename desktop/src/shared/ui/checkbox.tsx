import type { ComponentProps } from "react";
import { Checkbox as BlockCheckbox } from "@/shared/blockui/components/checkbox";
type CheckboxProps = Omit<
  ComponentProps<typeof BlockCheckbox>,
  "checked" | "defaultChecked"
> & {
  checked?: boolean | "indeterminate";
  defaultChecked?: boolean | "indeterminate";
};
/** Preserve mixed-selection semantics when adapting Buzz bulk actions. */
export function Checkbox({ checked, defaultChecked, ...props }: CheckboxProps) {
  return (
    <BlockCheckbox
      {...props}
      checked={checked === "indeterminate" ? false : checked}
      indeterminate={
        checked === "indeterminate" ||
        (checked === undefined && defaultChecked === "indeterminate")
      }
      defaultChecked={
        defaultChecked === "indeterminate" ? false : defaultChecked
      }
    />
  );
}
