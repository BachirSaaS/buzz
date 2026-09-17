import {
  useLayoutEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
} from "react";
import { motion, useReducedMotion } from "motion/react";
import { Action } from "@/shared/ui/action";

/** A continuous, apex-centered corner grip with pointer-only spring feedback. */
export function WorkspaceResizeHandle(
  props: ButtonHTMLAttributes<HTMLButtonElement>,
) {
  const svg = useRef<SVGSVGElement>(null);
  const [radius, setRadius] = useState(28);
  const [hovered, setHovered] = useState(false);
  const reduceMotion = useReducedMotion();
  useLayoutEffect(() => {
    const element = svg.current;
    if (!element) return;
    const measure = () =>
      setRadius(Number.parseFloat(getComputedStyle(element).width) - 40);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  // Keep 48px centered on the apex, even when larger text increases the radius.
  const extension = (48 - (Math.PI * radius) / 2) / 2;
  const edge = radius + 40;
  const end = 40 - extension;
  const startAngle = Math.PI / 4 - 24 / radius;
  const startX = 40 + radius * Math.cos(startAngle);
  const startY = 40 + radius * Math.sin(startAngle);
  const path =
    extension >= 0
      ? `M ${edge} ${end} V 40 A ${radius} ${radius} 0 0 1 40 ${edge} H ${end}`
      : `M ${startX} ${startY} A ${radius} ${radius} 0 0 1 ${startY} ${startX}`;
  const transition = reduceMotion
    ? { duration: 0 }
    : { type: "spring" as const, duration: 0.5, bounce: 0.2 };
  return (
    <Action
      {...props}
      aria-label={props["aria-label"] ?? "Resize content"}
      title={
        props.title ??
        "Drag to resize · Arrow keys to adjust · Double-click to reset"
      }
      data-testid="content-resize-handle"
      className="pulse-resize-handle absolute -bottom-2 -right-2 z-20 size-14 touch-none select-none cursor-nwse-resize rounded-full focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-white/50"
      onPointerEnter={(event) => {
        setHovered(
          event.pointerType === "mouse" &&
            window.matchMedia("(hover: hover) and (pointer: fine)").matches,
        );
      }}
      onPointerLeave={() => setHovered(false)}
    >
      <motion.svg
        ref={svg}
        aria-hidden="true"
        className="pulse-resize-stroke"
        initial={false}
        animate={{
          transform: `scale(${hovered ? 56 / 48 : 1})`,
          opacity: hovered ? 0.8 : 0.5,
        }}
        transition={transition}
      >
        <path
          d={path}
          fill="none"
          stroke="transparent"
          strokeWidth="16"
          vectorEffect="non-scaling-stroke"
          pointerEvents="stroke"
          data-resize-hit=""
        />
        <motion.path
          d={path}
          fill="none"
          stroke="white"
          strokeLinecap="round"
          pointerEvents="none"
          vectorEffect="non-scaling-stroke"
          initial={false}
          animate={{ strokeWidth: hovered ? 4 : 3 }}
          transition={transition}
        />
      </motion.svg>
    </Action>
  );
}
