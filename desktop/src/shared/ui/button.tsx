import * as React from "react";
import {
  Button as BlockButton,
  buttonVariants as blockButtonVariants,
} from "@/shared/blockui/components/button";
import { cn } from "@/shared/lib/cn";

type Variant =
  | "default"
  | "prominent"
  | "secondary"
  | "subtle"
  | "inverted"
  | "destructive"
  | "outline"
  | "ghost"
  | "link";
type Size = "default" | "md" | "sm" | "xs" | "lg" | "icon" | "icon-xs";
const variants = { default: "prominent", secondary: "subtle" } as const;
const sizes = {
  default: "md",
  md: "md",
  sm: "sm",
  xs: "sm",
  lg: "lg",
  icon: "sm",
  "icon-xs": "sm",
} as const;

/** Block UI actions with Buzz's call-site names mapped to its size ladder. */
export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  asChild?: boolean;
  variant?: Variant | null;
  size?: Size | null;
  loading?: boolean;
  iconOnly?: boolean;
}

export function buttonVariants({
  variant = "default",
  size = "default",
  className,
}: {
  variant?: Variant | null;
  size?: Size | null;
  className?: string;
} = {}) {
  return cn(
    blockButtonVariants({
      variant:
        variant === "default" || variant === "secondary"
          ? variants[variant]
          : (variant ?? "prominent"),
      size: sizes[size ?? "default"],
    }),
    size?.startsWith("icon") && "w-8 px-0",
    className,
  );
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      asChild,
      children,
      variant = "default",
      size = "default",
      iconOnly,
      ...props
    },
    ref,
  ) => {
    const child = asChild
      ? (React.Children.only(children) as React.ReactElement)
      : undefined;
    return (
      <BlockButton
        {...props}
        ref={ref}
        variant={
          variant === "default" || variant === "secondary"
            ? variants[variant]
            : (variant ?? "prominent")
        }
        size={sizes[size ?? "default"]}
        iconOnly={iconOnly || Boolean(size?.startsWith("icon"))}
        nativeButton={!child || child.type === "button"}
        render={child}
      >
        {asChild ? undefined : children}
      </BlockButton>
    );
  },
);
Button.displayName = "Button";
