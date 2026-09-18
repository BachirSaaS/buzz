import { createContext } from "react";

/** A canonical app destination before it is committed to router history. */
export type AppNavigationTarget = {
  to: string;
  params?: Record<string, string>;
  search?: Record<string, string | undefined>;
  state?:
    | Record<string, unknown>
    | ((previousState: Record<string, unknown>) => Record<string, unknown>);
};

/** Embedded workspaces can keep canonical feature navigation in their own panel. */
export const NavigationTargetContext = createContext<
  ((target: AppNavigationTarget) => AppNavigationTarget) | null
>(null);

/** An embedded window may consume a destination without changing app history.
 * Return undefined to leave destinations outside the window to the app router.
 */
export const NavigationHandlerContext = createContext<
  ((target: AppNavigationTarget) => boolean | undefined) | null
>(null);
