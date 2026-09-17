import { Pause, Play, RotateCcw, RotateCw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { albumArt } from "./data";
import { Control, Widget } from "./Widget";

const timeLabel = (time: number) =>
  `${Math.floor(time / 60)}:${String(Math.floor(time % 60)).padStart(2, "0")}`;

/** A real audio element owns playback, time, seeking, and failure state. */
export function MusicWidget({
  src = "/widget-assets/soft-focus.wav",
  title = "Soft focus",
  artist = "Studio sessions",
  artwork = albumArt,
}: {
  src?: string;
  title?: string;
  artist?: string;
  artwork?: string;
}) {
  const audio = useRef<HTMLAudioElement>(null);
  const generation = useRef(0);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [error, setError] = useState<string | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: A new source invalidates pending playback and resets the transport.
  useEffect(() => {
    generation.current += 1;
    setPlaying(false);
    setPosition(0);
    setDuration(0);
    setError(null);
    return () => {
      generation.current += 1;
    };
  }, [src]);
  const seek = (time: number) => {
    if (audio.current && duration) {
      audio.current.currentTime = Math.max(0, Math.min(duration, time));
      setPosition(audio.current.currentTime);
    }
  };
  const toggle = async () => {
    const element = audio.current;
    if (!element) return;
    if (!element.paused) {
      generation.current += 1;
      element.pause();
      return;
    }
    const request = ++generation.current;
    try {
      setError(null);
      if (element.error) element.load();
      await element.play();
    } catch {
      if (request === generation.current)
        setError("Audio couldn’t play. Press play to retry.");
    }
  };
  return (
    <Widget title="Music" className="music-widget" scale="14 / 16 / 24">
      <img
        className="album-art"
        src={artwork}
        alt="Sunrise over a misty green landscape"
      />
      <div className="track-details">
        <h3>{title}</h3>
        <p className="subtle">{artist}</p>
      </div>
      {/* Original instrumental fixture; no spoken content needs a transcript. */}
      {/* biome-ignore lint/a11y/useMediaCaption: Instrumental audio has no speech. */}
      <audio
        ref={audio}
        src={src}
        preload="metadata"
        onLoadedMetadata={(e) =>
          setDuration(
            Number.isFinite(e.currentTarget.duration)
              ? e.currentTarget.duration
              : 0,
          )
        }
        onTimeUpdate={(e) => setPosition(e.currentTarget.currentTime)}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onError={() => {
          setPlaying(false);
          setError("Audio unavailable. Press play to retry.");
        }}
      />
      <div className="scrubber">
        <input
          type="range"
          aria-label="Playback position"
          aria-valuetext={`${timeLabel(position)} of ${timeLabel(duration)}`}
          min={0}
          max={duration || 1}
          step={0.1}
          value={position}
          disabled={!duration}
          onChange={(e) => seek(Number(e.target.value))}
          style={
            {
              "--progress": `${duration ? (position / duration) * 100 : 0}%`,
            } as React.CSSProperties
          }
        />
        <div className="time-labels">
          <span>{timeLabel(position)}</span>
          <span>{timeLabel(duration)}</span>
        </div>
      </div>
      <div className="music-controls">
        <Control
          className="icon-control"
          aria-label="Rewind 10 seconds"
          disabled={!duration}
          onClick={() => seek(position - 10)}
        >
          <RotateCcw aria-hidden="true" />
        </Control>
        <Control
          className="play-control icon-control"
          aria-label={playing ? "Pause" : "Play"}
          onClick={toggle}
        >
          {playing ? (
            <Pause aria-hidden="true" fill="currentColor" />
          ) : (
            <Play aria-hidden="true" fill="currentColor" />
          )}
        </Control>
        <Control
          className="icon-control"
          aria-label="Forward 10 seconds"
          disabled={!duration}
          onClick={() => seek(position + 10)}
        >
          <RotateCw aria-hidden="true" />
        </Control>
      </div>
      {error && (
        <p role="alert" className="widget-error">
          {error}
        </p>
      )}
    </Widget>
  );
}
