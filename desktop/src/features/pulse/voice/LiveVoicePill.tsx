import { Action } from "@/shared/ui/action";
import { useEffect, useRef, useState, useId } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { ArrowUp, Keyboard, Mic, Loader2 } from "lucide-react";
import type { useLiveInterface } from "./useLiveInterface";
import type { useInterfaceCommands } from "./useInterfaceCommands";
import { RecipientChoices } from "./RecipientChoices";
import { LiveVoiceWaveform } from "./LiveVoiceWaveform";
import { CommandSuggestions } from "./CommandSuggestions";
import { searchCommandEntries, type CommandEntry } from "./commandCatalog";
import "./LiveVoicePill.css";

/** Voice and typing are two presentations of the same command session. */
export function LiveVoicePill({
  live,
  commands,
  mode,
  showFeedback,
  toText,
  toVoice,
  toggleMute,
}: {
  live: ReturnType<typeof useLiveInterface>;
  commands: ReturnType<typeof useInterfaceCommands>;
  mode: "voice" | "text";
  showFeedback: boolean;
  toText: () => void;
  toVoice: () => void;
  toggleMute: () => void;
}) {
  const [reduced, setReduced] = useState(
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  const [request, setRequest] = useState("");
  const input = useRef<HTMLTextAreaElement>(null);
  const listId = useId();
  const [selected, setSelected] = useState(-1);
  const typing = mode === "text";
  const muted = live.status === "off";
  const clarifying = showFeedback && commands.clarifying;
  const choices: CommandEntry[] =
    typing && request.trim() && !clarifying && !commands.busy
      ? [
          ...searchCommandEntries(commands.entries, request),
          {
            id: "search-query",
            title: `Search Buzz for “${request.trim()}”`,
            detail: "Search",
            aliases: [],
            plan: { action: "search_messages", text: request.trim() },
          },
        ]
      : [];
  const choose = (entry: CommandEntry) => {
    live.clearError();
    const submitted = request;
    const result =
      entry.id === "search-query"
        ? commands.run(`search Buzz for ${request.trim()}`)
        : commands.runEntry(entry.id);
    void result.then((outcome) => {
      if (outcome === "applied")
        setRequest((current) => (current === submitted ? "" : current));
    });
    setSelected(-1);
  };
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    if (clarifying) setRequest("");
  }, [clarifying]);
  useEffect(() => {
    if (!typing) return;
    const previous = document.activeElement;
    input.current?.focus({ preventScroll: true });
    return () => {
      if (
        document.activeElement === document.body ||
        document.activeElement?.closest(".live-voice-anchor")
      ) {
        if (previous instanceof HTMLElement && previous.isConnected)
          previous.focus({ preventScroll: true });
        else
          document
            .querySelector<HTMLElement>('[data-testid="canvas-options"]')
            ?.focus();
      }
    };
  }, [typing]);
  const error = live.error ?? commands.error;
  const layout = {
    duration: reduced ? 0 : 0.22,
    ease: [0.77, 0, 0.175, 1] as const,
  };
  const fade = { duration: reduced ? 0.1 : 0.14 };
  return createPortal(
    <div className="live-voice-anchor">
      <motion.div
        key="session"
        role={typing ? "dialog" : undefined}
        aria-label={typing ? "Buzz commands" : undefined}
        className="live-voice-session"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={fade}
      >
        {showFeedback && (error || commands.catalogError) && (
          <div className="live-voice-feedback pulse-control-surface rounded-2xl p-3">
            <p role="alert" className="text-sm text-destructive">
              {error || "Couldn’t load your windows. Please try again."}
            </p>
            {commands.catalogError && (
              <Action
                type="button"
                onClick={() => void commands.retryCatalog()}
                className="text-sm underline"
              >
                Retry loading windows
              </Action>
            )}
          </div>
        )}
        {!clarifying && (
          <span role="status" className="sr-only">
            {(showFeedback && commands.feedback) ||
              (live.status === "starting"
                ? "Preparing live listening"
                : !commands.ready
                  ? "Loading available windows"
                  : typing
                    ? "Ready for a command"
                    : muted
                      ? "Microphone muted"
                      : "Listening")}
          </span>
        )}
        <motion.div
          layout
          className="live-voice-controls"
          transition={{ layout }}
        >
          <motion.div
            layout="position"
            transition={{ layout }}
            className="live-voice-avatar-container pulse-control-surface"
            aria-hidden="true"
          >
            <img
              className="live-voice-avatar"
              src={reduced ? "/voice/fuzzy-still.png" : "/voice/fuzzy.gif"}
              alt=""
              draggable={false}
            />
          </motion.div>
          <motion.div
            layout
            className="live-voice-pill pulse-control-surface"
            style={{
              width:
                typing || clarifying ? "min(440px, calc(100vw - 144px))" : 128,
              borderRadius: 20,
            }}
            transition={{ layout }}
          >
            {choices.length > 0 && (
              <CommandSuggestions
                entries={choices}
                selected={selected}
                listId={listId}
                choose={choose}
              />
            )}
            <AnimatePresence initial={false} mode="popLayout">
              {typing ? (
                <motion.form
                  key="text"
                  layout="position"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={fade}
                  className="live-voice-input"
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (!request.trim() || commands.busy || !commands.ready)
                      return;
                    if (selected >= 0 && choices[selected]) {
                      choose(choices[selected]);
                      return;
                    }
                    live.clearError();
                    const submitted = request;
                    void commands.run(submitted).then((result) => {
                      if (result === "applied")
                        setRequest((current) =>
                          current === submitted ? "" : current,
                        );
                    });
                  }}
                >
                  <textarea
                    ref={input}
                    rows={1}
                    aria-label="Interface command"
                    maxLength={1000}
                    aria-description="Enter runs the command. Shift+Enter adds a new line. Escape returns to muted voice mode."
                    placeholder={
                      clarifying
                        ? "Who did you mean?"
                        : "Search Buzz or ask for anything…"
                    }
                    value={request}
                    readOnly={commands.busy}
                    aria-autocomplete="list"
                    aria-controls={choices.length ? listId : undefined}
                    aria-activedescendant={
                      choices[selected] ? `${listId}-${selected}` : undefined
                    }
                    onChange={(event) => {
                      setRequest(event.target.value);
                      setSelected(-1);
                    }}
                    onKeyDown={(event) => {
                      if (
                        !event.nativeEvent.isComposing &&
                        !event.altKey &&
                        !event.metaKey &&
                        !event.ctrlKey &&
                        (event.key === "ArrowDown" ||
                          event.key === "ArrowUp") &&
                        choices.length
                      ) {
                        event.preventDefault();
                        setSelected((index) =>
                          event.key === "ArrowDown"
                            ? (index + 1) % choices.length
                            : (index <= 0 ? choices.length : index) - 1,
                        );
                        return;
                      }
                      if (
                        event.key !== "Enter" ||
                        event.shiftKey ||
                        event.altKey ||
                        event.nativeEvent.isComposing ||
                        event.nativeEvent.keyCode === 229
                      )
                        return;
                      event.preventDefault();
                      if (!event.repeat)
                        event.currentTarget.form?.requestSubmit();
                    }}
                    className="min-w-0 flex-1 resize-none bg-transparent py-2.5 pl-4 text-sm leading-5 outline-none"
                  />
                  <Action
                    type="submit"
                    aria-label="Run command"
                    disabled={
                      !request.trim() || commands.busy || !commands.ready
                    }
                    aria-busy={commands.busy}
                    className="live-voice-icon mr-2 disabled:opacity-50"
                  >
                    {commands.busy ? (
                      <Loader2
                        aria-hidden
                        className="size-4 animate-spin motion-reduce:animate-none"
                      />
                    ) : (
                      <ArrowUp aria-hidden className="size-4" />
                    )}
                  </Action>
                </motion.form>
              ) : (
                <motion.button
                  key="voice"
                  layout="position"
                  type="button"
                  aria-label="Buzz microphone"
                  aria-pressed={!muted}
                  title={
                    live.status === "starting"
                      ? "Preparing microphone · click to cancel"
                      : muted
                        ? "Microphone muted · click or ⌘B to listen"
                        : "Listening · click to mute"
                  }
                  aria-keyshortcuts="Meta+B Control+B Escape"
                  onClick={toggleMute}
                  data-muted={muted}
                  className="live-voice-listen"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={fade}
                >
                  <LiveVoiceWaveform meter={live.meter} reduced={reduced} />
                </motion.button>
              )}
            </AnimatePresence>
            {clarifying && (
              <div className="live-voice-clarification space-y-2 px-4 pb-4 pt-2">
                <p role="status" className="text-xs text-muted-foreground">
                  {commands.feedback}
                </p>
                <RecipientChoices commands={commands} />
                <Action
                  type="button"
                  onClick={commands.cancel}
                  className="text-xs underline"
                >
                  Cancel
                </Action>
              </div>
            )}
          </motion.div>
          <motion.button
            layout="position"
            transition={{ layout }}
            type="button"
            className="live-voice-toggle pulse-control-surface"
            aria-label={typing ? "Switch to voice" : "Switch to typing"}
            title={typing ? "Use microphone" : "Type a command"}
            onClick={typing ? toVoice : toText}
          >
            <AnimatePresence initial={false} mode="popLayout">
              <motion.span
                key={mode}
                initial={{ opacity: 0, transform: "scale(0.95)" }}
                animate={{ opacity: 1, transform: "scale(1)" }}
                exit={{ opacity: 0, transform: "scale(0.95)" }}
                transition={fade}
              >
                {typing ? (
                  <Mic aria-hidden className="size-4" />
                ) : (
                  <Keyboard aria-hidden className="size-4" />
                )}
              </motion.span>
            </AnimatePresence>
          </motion.button>
        </motion.div>
      </motion.div>
    </div>,
    document.body,
  );
}
