import * as React from "react";

type PanelSearch = Partial<Record<string, string | null>>;

export const LocalHistorySearchContext = React.createContext<{
  values: PanelSearch;
  applyPatch: (patch: PanelSearch) => void;
} | null>(null);

/** Scope embedded panel navigation to its own lifetime instead of the app URL. */
export function LocalHistorySearchProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [values, setValues] = React.useState<PanelSearch>({});
  const applyPatch = React.useCallback((patch: PanelSearch) => {
    setValues((previous) => {
      const next = { ...previous };
      for (const [key, value] of Object.entries(patch)) {
        if (value === null) delete next[key];
        else if (value !== undefined) next[key] = value;
      }
      return Object.keys(patch).every(
        (key) => (next[key] ?? null) === (previous[key] ?? null),
      )
        ? previous
        : next;
    });
  }, []);
  const state = React.useMemo(
    () => ({ values, applyPatch }),
    [values, applyPatch],
  );
  return (
    <LocalHistorySearchContext.Provider value={state}>
      {children}
    </LocalHistorySearchContext.Provider>
  );
}
