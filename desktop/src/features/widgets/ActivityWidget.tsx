import { Action } from "@/shared/ui/action";
import { useState } from "react";
import { activityDays } from "./data";
import { Widget } from "./Widget";
import { useWidgetSize } from "./WidgetSizing";

/** One daily measure; day selection changes both the value and progress. */
export function ActivityWidget({
  days = activityDays,
  goal = 10000,
}: {
  days?: typeof activityDays;
  goal?: number;
}) {
  const [selected, setSelected] = useState(Math.max(0, days.length - 1));
  const size = useWidgetSize();
  const day = days[selected];
  const steps = day?.steps ?? 0;
  const fraction = goal > 0 ? Math.min(1, Math.max(0, steps / goal)) : 0;
  return (
    <Widget title="Activity" className="activity-widget" scale="14 / 16 / 32">
      <div className="activity-summary">
        <div aria-live="polite">
          <p className="small subtle">
            {selected === days.length - 1
              ? "Today’s steps"
              : `${day?.day ?? "Daily"} steps`}
          </p>
          <p className="activity-value">{steps.toLocaleString("en-US")}</p>
          <p className="small subtle">
            of {goal.toLocaleString("en-US")} steps
          </p>
        </div>
        <svg
          className="activity-ring"
          viewBox="0 0 96 96"
          role="img"
          aria-label={`${Math.round(fraction * 100)} percent of daily goal`}
        >
          <circle cx="48" cy="48" r="38" className="ring-track" />
          <circle
            cx="48"
            cy="48"
            r="38"
            className="ring-value"
            pathLength="100"
            strokeDasharray={`${fraction * 100} 100`}
            transform="rotate(-90 48 48)"
          />
        </svg>
      </div>
      {size !== "small" && (
        <fieldset className="activity-days" aria-label="Activity by day">
          {days.map((item, index) => (
            <Action
              type="button"
              key={item.day}
              onClick={() => setSelected(index)}
              aria-pressed={selected === index}
              aria-label={`${item.day}, ${item.steps.toLocaleString("en-US")} steps`}
            >
              {item.day}
              {size === "large" && (
                <span className="day-steps small">
                  {(item.steps / 1000).toFixed(1)}k
                </span>
              )}
            </Action>
          ))}
        </fieldset>
      )}
    </Widget>
  );
}
