import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { WorkspaceController } from "../lib/usePulseWorkspaces";
import { useInterfaceCommands } from "./useInterfaceCommands";
import { useLiveInterface } from "./useLiveInterface";
import { LiveVoicePill } from "./LiveVoicePill";

type Surface = "workspace" | null;
const InterfaceContext = createContext<{
  commands: ReturnType<typeof useInterfaceCommands>;
  surface: Surface;
  show: (surface: Surface) => void;
} | null>(null);

/** One command transaction, clarification and undo history across both entry points. */
export function InterfaceCommandsProvider({
  workspaces,
  children,
}: {
  workspaces: WorkspaceController;
  children: ReactNode;
}) {
  const commands = useInterfaceCommands(workspaces);
  const live = useLiveInterface(
    commands,
    workspaces.active.id,
    workspaces.scope,
  );
  const [surface, setSurface] = useState<Surface>(null);
  const [mode, setMode] = useState<"voice" | "text">("voice");
  const active = live.status !== "off";
  const close = () => {
    live.stop();
    commands.cancel();
    live.clearError();
    setMode("voice");
  };
  const show = (next: Surface) => {
    if (next === surface) return;
    close();
    setSurface(next);
  };
  const toVoice = () => {
    if (commands.busy || surface === "workspace") commands.cancel();
    setSurface(null);
    setMode("voice");
    void live.start();
  };
  const toText = () => {
    live.stop();
    if (commands.busy || surface === "workspace") commands.cancel();
    setSurface(null);
    setMode("text");
  };
  // A microphone failure must leave an immediately usable typed fallback.
  useEffect(() => {
    if (live.error) setMode("text");
  }, [live.error]);
  const controls = useRef({ active, mode, close, toVoice });
  controls.current = { active, mode, close, toVoice };
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.isComposing || event.keyCode === 229) return;
      const activate =
        (event.metaKey || event.ctrlKey) &&
        !event.altKey &&
        ((!event.shiftKey && event.code === "KeyB") ||
          (event.shiftKey && event.code === "Space"));
      const dismiss =
        event.key === "Escape" &&
        (controls.current.active || controls.current.mode === "text");
      if (!activate && !dismiss) return;
      event.preventDefault();
      event.stopPropagation();
      if (event.repeat) return;
      if (dismiss) controls.current.close();
      else if (!controls.current.active) controls.current.toVoice();
    };
    window.addEventListener("keydown", keydown, true);
    return () => window.removeEventListener("keydown", keydown, true);
  }, []);
  return (
    <InterfaceContext.Provider value={{ commands, surface, show }}>
      {children}
      <LiveVoicePill
        live={live}
        commands={commands}
        mode={mode}
        showFeedback={surface === null}
        toText={toText}
        toVoice={toVoice}
        toggleMute={active ? close : toVoice}
      />
    </InterfaceContext.Provider>
  );
}
/** Shared interface engine; callers select presentation, never a second planner. */
export function useInterfaceSession() {
  const value = useContext(InterfaceContext);
  if (!value)
    throw new Error("Interface commands require a workspace provider.");
  return value;
}
