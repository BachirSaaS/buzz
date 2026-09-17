import { useState, type ButtonHTMLAttributes } from "react";
import { motion, useReducedMotion } from "motion/react";
import { Action } from "@/shared/ui/action";

/** An unframed exterior grip with the same pointer feedback as the resize corner. */
export function WorkspaceMoveHandle(
  props: ButtonHTMLAttributes<HTMLButtonElement>,
) {
  const [hovered, setHovered] = useState(false);
  const reduceMotion = useReducedMotion();
  return (
    <Action
      {...props}
      aria-label={props["aria-label"] ?? "Move window"}
      title="Drag to move · Arrow keys to adjust"
      data-testid="content-move-handle"
      className="canvas-move-handle absolute -left-6 -top-6 z-20 flex size-6 touch-none select-none items-center justify-center focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-white/50"
      onPointerEnter={(event) =>
        setHovered(
          event.pointerType === "mouse" &&
            window.matchMedia("(hover: hover) and (pointer: fine)").matches,
        )
      }
      onPointerLeave={() => setHovered(false)}
    >
      <motion.svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        className="size-5"
        fill="white"
        initial={false}
        animate={{
          transform: `scale(${hovered ? 56 / 48 : 1})`,
          opacity: hovered ? 0.8 : 0.5,
        }}
        transition={
          reduceMotion
            ? { duration: 0 }
            : { type: "spring", duration: 0.5, bounce: 0.2 }
        }
      >
        {[6, 12, 18].flatMap((y) =>
          [9, 15].map((x) => (
            <circle key={`${x}:${y}`} cx={x} cy={y} r={1.5} />
          )),
        )}
      </motion.svg>
    </Action>
  );
}
