import { invoke } from "@tauri-apps/api/core";
import liveAudioWorkletUrl from "./liveAudioWorklet.js?url&no-inline";
import { encodeSpeech, LiveSpeechBuffer, type SpeechSlice } from "./liveSpeech";
import type { LiveTranscript } from "./liveIntent";

/** Continuously capture local PCM. Partial inference coalesces; final utterances are never overwritten. */
export async function startLiveMicrophone(
  signal: AbortSignal,
  onTranscript: (value: LiveTranscript) => void,
  onError: (error: Error) => void,
  onLevel: (level: number) => void,
) {
  let context: AudioContext | undefined;
  let stream: MediaStream | undefined;
  let node: AudioWorkletNode | undefined;
  let source: MediaStreamAudioSourceNode | undefined;
  let closed = false;
  let processing = false;
  const queue = new Map<number, SpeechSlice>();
  const buffer = new LiveSpeechBuffer();
  const close = () => {
    if (closed) return;
    closed = true;
    queue.clear();
    onLevel(0);
    if (node) {
      node.port.onmessage = null;
      node.port.close();
      node.disconnect();
    }
    source?.disconnect();
    stream?.getTracks().forEach((track) => {
      track.stop();
    });
    if (context && context.state !== "closed") void context.close();
    signal.removeEventListener("abort", close);
  };
  const fail = (cause: unknown) => {
    close();
    onError(cause instanceof Error ? cause : new Error(String(cause)));
  };
  const drain = async () => {
    if (processing || closed) return;
    processing = true;
    try {
      while (queue.size && !closed) {
        const slice = queue.values().next().value as SpeechSlice;
        queue.delete(slice.id);
        const text = await invoke<string>("transcribe_interface_voice", {
          pcm: encodeSpeech(slice.pcm),
          partial: true,
        });
        if (!closed) onTranscript({ id: slice.id, text, final: slice.final });
      }
    } catch (cause) {
      if (!closed) fail(cause);
    } finally {
      processing = false;
    }
  };
  signal.addEventListener("abort", close, { once: true });
  try {
    if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    if (closed || signal.aborted) {
      stream.getTracks().forEach((track) => {
        track.stop();
      });
      throw new DOMException("Cancelled", "AbortError");
    }
    for (const track of stream.getAudioTracks())
      track.addEventListener(
        "ended",
        () => {
          if (!closed)
            fail(
              new Error("The microphone disconnected. Start listening again."),
            );
        },
        { once: true },
      );
    context = new AudioContext();
    // Keep this a same-origin file: the desktop CSP disallows data: scripts.
    await context.audioWorklet.addModule(liveAudioWorkletUrl);
    if (closed) throw new DOMException("Cancelled", "AbortError");
    node = new AudioWorkletNode(context, "interface-audio-capture");
    source = context.createMediaStreamSource(stream);
    node.port.onmessage = (event: MessageEvent<Float32Array>) => {
      if (closed) return;
      const pcm = event.data;
      const rms = Math.sqrt(
        pcm.reduce((sum, sample) => sum + sample * sample, 0) /
          Math.max(1, pcm.length),
      );
      // Match the speech detector noise floor; compress the range for quiet voices.
      onLevel(Math.min(1, Math.sqrt(Math.max(0, rms - 0.009) * 8)));
      const slice = buffer.push(pcm);
      if (!slice) return;
      if (queue.size >= 3 && !queue.has(slice.id)) {
        fail(
          new Error("Speech recognition fell behind. Start listening again."),
        );
        return;
      }
      queue.set(slice.id, slice);
      void drain();
    };
    source.connect(node);
    // The processor emits silence; connecting it keeps WebKit's audio graph running.
    node.connect(context.destination);
    await context.resume();
    if (closed) throw new DOMException("Cancelled", "AbortError");
    return close;
  } catch (cause) {
    close();
    throw cause;
  }
}
