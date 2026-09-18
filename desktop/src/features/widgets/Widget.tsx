import { Action } from "@/shared/ui/action";
import { X } from "lucide-react";
import { useWidgetSize } from "./WidgetSizing";
import "./widget-sizes.css";
import {
  type ButtonHTMLAttributes,
  type ReactNode,
  useEffect,
  useId,
  useRef,
} from "react";

/** The shared widget shell: intrinsic height, 24px inset and radius. */
export function Widget({
  title,
  children,
  className = "",
  bleed = false,
  hideHeading = false,
  scale = "14 / 16 / 32",
}: {
  title: string;
  children: ReactNode;
  className?: string;
  bleed?: boolean;
  hideHeading?: boolean;
  scale?: string;
}) {
  const id = useId();
  const size = useWidgetSize();
  return (
    <section
      className={`widget ${bleed ? "widget--bleed" : ""} ${className}`}
      aria-labelledby={id}
      data-widget={title}
      data-size={size}
    >
      <h2
        className={bleed || hideHeading ? "visually-hidden" : "widget-heading"}
        id={id}
      >
        {title}
      </h2>
      {children}
      <div className="widget-anatomy" aria-hidden="true">
        <span>24 inset</span>
        <span>Cash Sans · {scale} · 400 / 500</span>
      </div>
    </section>
  );
}

/** One neutral button, with a labeled icon-only variant. */
export function Control({
  children,
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <Action type="button" className={`widget-control ${className}`} {...props}>
      {children}
    </Action>
  );
}

/** Native modal supplies focus containment, Escape dismissal and focus return. */
export function DetailDialog({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  useEffect(() => {
    const dialog = ref.current;
    const trigger =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    dialog?.showModal();
    return () => {
      dialog?.close();
      trigger?.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className="widget-dialog"
      aria-labelledby={id}
      onCancel={onClose}
    >
      <div className="dialog-heading">
        <h2 id={id}>{title}</h2>
        <Control
          aria-label="Close details"
          className="icon-control"
          onClick={onClose}
        >
          <X aria-hidden="true" />
        </Control>
      </div>
      {children}
    </dialog>
  );
}
