// Adapted from Block UI. See ../SOURCE.json.
"use client";

import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { cva, type VariantProps } from "class-variance-authority";
import {
  cloneElement,
  type ReactElement,
  type HTMLAttributes,
  type KeyboardEvent,
  type SyntheticEvent,
} from "react";

import { cn } from "@/shared/lib/cn";

const buttonVariants = cva(
  [
    "group/button inline-flex shrink-0 items-center justify-center",

    "rounded-full",

    "border-0 whitespace-nowrap",

    "font-medium",

    "cursor-pointer transition-[color,background-color,border-color,outline-color] motion-reduce:transition-none select-none",
    "outline-[length:var(--blockui-button-focus-ring-width)] outline-solid outline-transparent",
    "focus-visible:outline-blockui-button-focus-ring",
    "outline-offset-[var(--blockui-button-focus-ring-width)]",

    "disabled-any:pointer-events-none disabled-any:cursor-default",
    "disabled-any:loading:pointer-events-auto",

    "[&_svg]:pointer-events-none [&_svg]:shrink-0",
  ],
  {
    compoundVariants: [
      {
        size: "sm",
        variant: "outline",
        class:
          "[--button-outline-rest-stroke:var(--blockui-button-outline-border-width-active)]",
      },
    ],
    defaultVariants: {
      size: "md",
      variant: "prominent",
    },
    variants: {
      size: {
        sm: "h-8 gap-2 px-4 py-1.5 text-blockui-label-small [&_svg:not([class*='size-']):not([class*='h-']):not([class*='w-'])]:size-4",

        md: "h-10 gap-2 px-6 py-2 text-blockui-label-medium [&_svg:not([class*='size-']):not([class*='h-']):not([class*='w-'])]:size-4",

        lg: "h-13 min-w-13 gap-2 px-6 py-3.5 text-blockui-label-medium [&_svg:not([class*='size-']):not([class*='h-']):not([class*='w-'])]:size-5",
      },

      variant: {
        prominent: [
          "bg-blockui-button-prominent-fill text-blockui-button-prominent-label disabled-any:loading:bg-blockui-button-prominent-fill disabled-any:loading:text-blockui-button-prominent-label",
          "hover:bg-blockui-button-prominent-fill-hover",
          "active:bg-blockui-button-prominent-fill-pressed",
          "disabled-any:bg-blockui-button-prominent-fill-disabled",
          "disabled-any:text-blockui-button-prominent-label-disabled",
        ],
        destructive: [
          "bg-blockui-button-destructive-fill text-blockui-button-destructive-label disabled-any:loading:bg-blockui-button-destructive-fill disabled-any:loading:text-blockui-button-destructive-label",
          "hover:bg-blockui-button-destructive-fill-hover",
          "active:bg-blockui-button-destructive-fill-pressed",
          "disabled-any:bg-blockui-button-destructive-fill-disabled",
          "disabled-any:text-blockui-button-destructive-label-disabled",
        ],
        ghost: [
          "bg-blockui-button-ghost-fill text-blockui-button-ghost-label disabled-any:loading:bg-blockui-button-ghost-fill disabled-any:loading:text-blockui-button-ghost-label",
          "hover:bg-blockui-button-ghost-fill-hover",
          "active:bg-blockui-button-ghost-fill-pressed",
          "aria-expanded:bg-blockui-button-ghost-fill-hover",
          "disabled-any:bg-blockui-button-ghost-fill-disabled",
          "disabled-any:text-blockui-button-ghost-label-disabled",
        ],
        inverted: [
          "bg-blockui-button-inverted-fill text-blockui-button-inverted-label disabled-any:loading:bg-blockui-button-inverted-fill disabled-any:loading:text-blockui-button-inverted-label",
          "hover:bg-blockui-button-inverted-fill-hover",
          "active:bg-blockui-button-inverted-fill-pressed",
          "disabled-any:bg-blockui-button-inverted-fill-disabled",
          "disabled-any:text-blockui-button-inverted-label-disabled",
        ],
        link: "disabled-any:loading:text-primary text-primary underline-offset-4 hover:underline active:text-blockui-button-link-label-pressed disabled-any:text-blockui-button-ghost-label-disabled disabled-any:no-underline",

        outline: [
          "bg-blockui-button-outline-fill text-blockui-button-outline-label",
          "[--button-outline-rest-stroke:var(--blockui-button-outline-border-width)] [--button-outline-stroke:var(--button-outline-rest-stroke)]",
          "inset-shadow-[0_0_0_var(--button-outline-stroke)_var(--blockui-button-outline-border)]",
          "hover:bg-blockui-button-outline-fill-hover hover:[--button-outline-stroke:var(--blockui-button-outline-border-width-active)]",
          "active:bg-blockui-button-outline-fill-pressed active:[--button-outline-stroke:var(--blockui-button-outline-border-width-active)]",
          "aria-expanded:bg-blockui-button-outline-fill-hover aria-expanded:[--button-outline-stroke:var(--blockui-button-outline-border-width-active)]",
          "disabled-any:bg-blockui-button-outline-fill-disabled disabled-any:text-blockui-button-outline-label-disabled disabled-any:[--button-outline-stroke:var(--blockui-button-outline-border-width)]",
          "disabled-any:loading:bg-blockui-button-outline-fill disabled-any:loading:text-blockui-button-outline-label disabled-any:loading:[--button-outline-stroke:var(--button-outline-rest-stroke)]",
        ],
        subtle: [
          "bg-blockui-button-subtle-fill text-blockui-button-subtle-label disabled-any:loading:bg-blockui-button-subtle-fill disabled-any:loading:text-blockui-button-subtle-label",
          "hover:bg-blockui-button-subtle-fill-hover",
          "active:bg-blockui-button-subtle-fill-pressed",
          "aria-expanded:bg-blockui-button-subtle-fill-hover",
          "disabled-any:bg-blockui-button-subtle-fill-disabled",
          "disabled-any:text-blockui-button-subtle-label-disabled",
        ],
      },
    },
  },
);

const ICON_ONLY_WIDTH = {
  lg: "w-13 px-0",
  md: "w-10 px-0",
  sm: "w-8 px-0",
} as const;

function Button({
  className,
  children,
  disabled,
  loading = false,
  iconOnly = false,
  size = "md",
  variant = "prominent",
  render,
  ...props
}: ButtonPrimitive.Props &
  VariantProps<typeof buttonVariants> & {
    iconOnly?: boolean;
    loading?: boolean;
  }) {
  const inactive = Boolean(disabled || loading);
  const content = (label: React.ReactNode) =>
    loading ? (
      <>
        <span className="inline-flex items-center justify-center gap-[inherit] opacity-0">
          {label}
        </span>
        <span
          aria-hidden="true"
          className="absolute motion-safe:animate-spin"
          data-slot="button-spinner"
        />
      </>
    ) : (
      label
    );
  const prepareRender = (element: ReactElement, fallback: React.ReactNode) => {
    const rendered = element as ReactElement<{ children?: React.ReactNode }>;
    const prepared = loading
      ? cloneElement(
          rendered,
          {},
          content(
            rendered.props.children === undefined
              ? fallback
              : rendered.props.children,
          ),
        )
      : rendered;
    return inactive ? guardActivation(prepared) : prepared;
  };
  const guardedRender =
    render && inactive
      ? typeof render === "function"
        ? (((renderProps, state) =>
            prepareRender(
              render(renderProps, state),
              renderProps.children,
            )) satisfies Exclude<
            ButtonPrimitive.Props["render"],
            ReactElement | undefined
          >)
        : prepareRender(render, children)
      : render;
  return (
    <ButtonPrimitive
      className={cn(
        buttonVariants({ size, variant }),
        loading && "relative",
        iconOnly && ICON_ONLY_WIDTH[size ?? "md"],
        className,
      )}
      data-slot="button"
      {...props}
      render={guardedRender}
      onClickCapture={inactive ? stopActivation : props.onClickCapture}
      onPointerDownCapture={
        inactive ? stopActivation : props.onPointerDownCapture
      }
      onPointerUpCapture={inactive ? stopActivation : props.onPointerUpCapture}
      onMouseDownCapture={inactive ? stopActivation : props.onMouseDownCapture}
      onMouseUpCapture={inactive ? stopActivation : props.onMouseUpCapture}
      onKeyDownCapture={
        inactive ? guardKey(props.onKeyDownCapture) : props.onKeyDownCapture
      }
      onKeyUpCapture={
        inactive ? guardKey(props.onKeyUpCapture) : props.onKeyUpCapture
      }
      disabled={inactive}
      focusableWhenDisabled={loading || props.focusableWhenDisabled}
      aria-busy={loading || props["aria-busy"]}
      data-loading={loading ? "" : undefined}
    >
      {render ? children : content(children)}
    </ButtonPrimitive>
  );
}

function stopActivation(event: SyntheticEvent) {
  event.preventDefault();
  event.stopPropagation();
}

function guardKey<Event extends KeyboardEvent>(
  handler?: (event: Event) => void,
) {
  return (event: Event) => {
    if (event.key === "Enter" || event.key === " ") {
      stopActivation(event);
    } else {
      handler?.(event);
    }
  };
}

function guardActivation(element: ReactElement) {
  const rendered = element as ReactElement<
    HTMLAttributes<HTMLElement> & { href?: string }
  >;
  return cloneElement(rendered, {
    href: undefined,
    onClick: stopActivation,
    onClickCapture: stopActivation,
    onPointerDown: stopActivation,
    onPointerUp: stopActivation,
    onPointerDownCapture: stopActivation,
    onPointerUpCapture: stopActivation,
    onMouseDown: stopActivation,
    onMouseUp: stopActivation,
    onMouseDownCapture: stopActivation,
    onMouseUpCapture: stopActivation,
    onKeyDownCapture: guardKey(rendered.props.onKeyDownCapture),
    onKeyUpCapture: guardKey(rendered.props.onKeyUpCapture),
  });
}

export { Button, buttonVariants };
