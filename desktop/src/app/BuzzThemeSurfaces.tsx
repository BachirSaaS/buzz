import type { ReactNode } from "react";

/** Block UI navigation uses its subtle surface rather than decorative artwork. */
export function NavigationSurface() {
  return (
    <div
      aria-hidden="true"
      className="blockui-navigation pointer-events-none absolute inset-0 -z-10"
    />
  );
}

export function ContentSurface({
  children,
  unframed = false,
  terminal,
  transparent = false,
}: {
  children: ReactNode;
  terminal?: ReactNode;
  /** Used by dedicated huddle windows, which should not resemble app cards. */
  unframed?: boolean;
  /** Let a surface with its own content card reveal the shared theme canvas. */
  transparent?: boolean;
}) {
  return (
    <div
      className={
        transparent
          ? "relative z-10 flex min-h-0 flex-1 flex-col overflow-hidden"
          : unframed
            ? "relative z-10 flex min-h-0 flex-1 flex-col overflow-hidden bg-background"
            : "relative z-10 mb-2 ml-px mr-2 mt-px flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl bg-background border border-border"
      }
      data-buzz-content-surface={transparent ? undefined : ""}
      data-buzz-content-unframed={unframed ? true : undefined}
    >
      <div className="buzz-content-primary flex min-h-0 flex-1 flex-col overflow-hidden">
        {children}
      </div>
      <div className="buzz-terminal-dock-host" data-terminal-dock>
        {terminal}
      </div>
    </div>
  );
}
