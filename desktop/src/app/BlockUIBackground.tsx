/** Flat Block UI app surface, shared by startup and dedicated huddle windows. */
export function BlockUIBackground() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 -z-10 bg-sidebar"
    />
  );
}
