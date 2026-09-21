import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { resolveIntent } from "./intent";
import { LiveIntentSession } from "./liveIntent";
import { startLiveMicrophone } from "./liveMicrophone";
import type { useInterfaceCommands } from "./useInterfaceCommands";

/** One explicit listening session spans automatic actions and recipient clarification replies. */
export function useLiveInterface(
  commands: ReturnType<typeof useInterfaceCommands>,
  workspace: string,
  scope: string | null,
) {
  const [status, setStatus] = useState<"off" | "starting" | "listening">("off");
  const [transcript, setTranscript] = useState("");
  const [error, setError] = useState<string | null>(null);
  const current = useRef(commands);
  current.current = commands;
  const flight = useRef<AbortController | null>(null);
  const engine = useRef<LiveIntentSession | null>(null);
  const applying = useRef(false);
  const meter = useRef({ level: 0, at: 0 });
  const stop = () => {
    flight.current?.abort();
    flight.current = null;
    engine.current?.stop();
    engine.current = null;
    meter.current = { level: 0, at: 0 };
    setStatus("off");
  };
  const start = async () => {
    if (flight.current) return;
    const abort = new AbortController();
    flight.current = abort;
    setError(null);
    setTranscript("");
    setStatus("starting");
    const fail = (cause: Error) => {
      if (flight.current !== abort) return;
      stop();
      setError(cause.message);
    };
    try {
      const ready = await invoke<boolean>("prepare_interface_voice");
      if (abort.signal.aborted) return;
      if (!ready)
        throw new Error(
          "Downloading Buzz's speech model. Start listening again shortly; you can type now.",
        );
      const session = new LiveIntentSession({
        context: () => current.current.liveContext(),
        interpret: resolveIntent,
        run: async (text, signal) => {
          applying.current = false;
          try {
            const result = await current.current.run(text, undefined, {
              signal,
              onApply: () => {
                applying.current = true;
              },
            });
            // Let React publish a newly created/switched workspace before the next action.
            await new Promise<void>((resolve) =>
              requestAnimationFrame(() => resolve()),
            );
            return result;
          } finally {
            applying.current = false;
          }
        },
        error: fail,
      });
      engine.current = session;
      await startLiveMicrophone(
        abort.signal,
        (value) => {
          if (abort.signal.aborted) return;
          if (value.text) setTranscript(value.text);
          session.update(value);
        },
        fail,
        (level) => {
          if (!abort.signal.aborted)
            meter.current = { level, at: performance.now() };
        },
      );
      if (abort.signal.aborted) return;
      setStatus("listening");
    } catch (cause) {
      if (!abort.signal.aborted)
        fail(cause instanceof Error ? cause : new Error(String(cause)));
    }
  };
  const controls = useRef({ start, stop });
  controls.current = { start, stop };
  useEffect(() => {
    const hidden = () => {
      if (document.hidden) controls.current.stop();
    };
    document.addEventListener("visibilitychange", hidden);
    return () => {
      controls.current.stop();
      document.removeEventListener("visibilitychange", hidden);
    };
  }, []);
  // biome-ignore lint/correctness/useExhaustiveDependencies: identity/community transitions retire microphone and model replies.
  useEffect(() => () => controls.current.stop(), [scope]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: explicit navigation cancels captured context; voice navigation stays live.
  useEffect(() => {
    if (!applying.current) controls.current.stop();
  }, [workspace]);
  useEffect(() => {
    if (status !== "listening") return;
    const timer = window.setTimeout(
      () => {
        controls.current.stop();
        setError(
          "Listening session ended after 30 minutes. Start again to continue.",
        );
      },
      30 * 60 * 1000,
    );
    return () => window.clearTimeout(timer);
  }, [status]);
  return {
    status,
    transcript,
    error,
    start,
    stop,
    meter,
    clearError: () => setError(null),
  };
}
