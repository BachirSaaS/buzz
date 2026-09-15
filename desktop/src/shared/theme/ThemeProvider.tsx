import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useState,
} from "react";
import { toast } from "sonner";
import { getStorageItem, setStorageItem } from "@/shared/lib/safeStorage";
import { extractTerminalPalette } from "./terminal-palette";

import { useNativeWindowGlass } from "./useNativeWindowGlass";

export type AppearanceMode = "system" | "light" | "dark";
export const THEME_STORAGE_KEY = "buzz-blockui-appearance.v1";

type ThemeContextValue = {
  mode: AppearanceMode;
  setMode: (mode: AppearanceMode) => void;
  isDark: boolean;
  themeName: "buzz" | "buzz-dark";
  terminalPalette: ReturnType<typeof extractTerminalPalette>;
};
const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

/** Block UI owns the entire UI palette; syntax colors never recolor the app. */
export function ThemeProvider({
  children,
}: {
  children: ReactNode;
  defaultTheme?: string;
}) {
  useNativeWindowGlass();
  const [mode, setModeState] = useState<AppearanceMode>(() => {
    const saved = getStorageItem(THEME_STORAGE_KEY);
    return saved === "light" || saved === "dark" ? saved : "system";
  });
  const [systemIsDark, setSystemIsDark] = useState(
    () => window.matchMedia("(prefers-color-scheme: dark)").matches,
  );
  const isDark = mode === "system" ? systemIsDark : mode === "dark";
  useLayoutEffect(() => {
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const update = () => setSystemIsDark(query.matches);
    query.addEventListener("change", update);
    update();
    return () => query.removeEventListener("change", update);
  }, []);
  useLayoutEffect(() => {
    const root = document.documentElement;
    root.dataset.substrate = "blockui";
    root.classList.toggle("dark", isDark);
    root.classList.toggle("light", !isDark);
    root.style.colorScheme = isDark ? "dark" : "light";
  }, [isDark]);
  const setMode = useCallback((next: AppearanceMode) => {
    // One preference, one write. Failed persistence leaves the saved selection
    // unchanged and presents a retry affordance through the still-enabled control.
    if (!setStorageItem(THEME_STORAGE_KEY, next)) {
      toast.error("Couldn't save appearance. Try selecting it again.");
      return;
    }
    setModeState(next);
  }, []);
  const terminalPalette = useMemo(
    () =>
      extractTerminalPalette({
        name: "blockui",
        settings: [],
        colors: {
          "editor.background": isDark ? "#000000" : "#ffffff",
          "editor.foreground": isDark ? "#ffffff" : "#000000",
        },
      }),
    [isDark],
  );
  const value = useMemo<ThemeContextValue>(
    () => ({
      mode,
      setMode,
      isDark,
      themeName: isDark ? "buzz-dark" : "buzz",
      terminalPalette,
    }),
    [mode, setMode, isDark, terminalPalette],
  );
  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

/** Read the active Block UI color mode and the matching code/terminal palette. */
export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) throw new Error("useTheme must be used within ThemeProvider");
  return context;
}
