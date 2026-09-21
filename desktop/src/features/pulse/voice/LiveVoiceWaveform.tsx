import { useEffect, useRef, type RefObject } from "react";

const bars = Array.from({ length: 17 }, (_, index) => index);
// Fade the outer four strokes on each end; keep the center fully opaque.
const edgeOpacity = bars.map((index) =>
  Math.min(1, (Math.min(index, 16 - index) + 1) / 5),
);

/** A single waveform with tapered edges follows the microphone amplitude history. */
export function LiveVoiceWaveform({
  meter,
  reduced,
}: {
  meter: RefObject<{ level: number; at: number }>;
  reduced: boolean;
}) {
  const waveform = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const history = bars.map(() => 0);
    const timer = window.setInterval(() => {
      const level =
        performance.now() - meter.current.at < 250 ? meter.current.level : 0;
      history.shift();
      history.push(level);
      waveform.current
        ?.querySelectorAll<SVGLineElement>("line")
        .forEach((bar, index) => {
          bar.style.transform = `scaleY(${reduced ? 2 / 11 : Math.max(0.001, history[index])})`;
          bar.style.opacity = String(
            edgeOpacity[index] * (reduced ? 0.35 + level * 0.65 : 1),
          );
        });
    }, 100);
    return () => window.clearInterval(timer);
  }, [meter, reduced]);
  return (
    <span ref={waveform} className="live-voice-waveform" aria-hidden="true">
      <svg
        aria-hidden="true"
        className="live-voice-waveform-primary"
        width="82"
        height="24"
        viewBox="0 0 82 24"
      >
        {bars.map((index) => (
          <line
            key={index}
            style={{ opacity: edgeOpacity[index] }}
            x1={1 + index * 5}
            x2={1 + index * 5}
            y1="1"
            y2="23"
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </svg>
    </span>
  );
}
