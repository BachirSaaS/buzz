import { forwardRef, type InputHTMLAttributes } from "react";
import { cn } from "@/shared/lib/cn";
/** Native form contracts with Block UI checkbox/radio presentation. Keeps browser
 * grouping, form serialization and modifier-bearing change events intact. */
export const ChoiceInput = forwardRef<
  HTMLInputElement,
  InputHTMLAttributes<HTMLInputElement>
>(({ className, ...props }, ref) => (
  <input
    ref={ref}
    data-slot={props.type === "radio" ? "radio-group-item" : "checkbox"}
    className={cn("blockui-choice", className)}
    {...props}
  />
));
ChoiceInput.displayName = "ChoiceInput";
/** Media and continuous-value sliders retain their browser keyboard behavior. */
export const RangeInput = forwardRef<
  HTMLInputElement,
  InputHTMLAttributes<HTMLInputElement>
>(({ className, ...props }, ref) => (
  <input
    ref={ref}
    data-slot="slider"
    className={cn("blockui-range", className)}
    {...props}
  />
));
RangeInput.displayName = "RangeInput";
