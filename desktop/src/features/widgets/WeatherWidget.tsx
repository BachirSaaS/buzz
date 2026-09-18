import { Action } from "@/shared/ui/action";
import { Cloud, CloudRain, CloudSun, Sun } from "lucide-react";
import { useState } from "react";
import { forecast } from "./data";
import { Control, DetailDialog, Widget } from "./Widget";
import { useWidgetSize } from "./WidgetSizing";

const icons = {
  sun: Sun,
  "cloud-sun": CloudSun,
  cloud: Cloud,
  rain: CloudRain,
};

/** Current conditions and five selectable forecast days. Temperatures enter in °F. */
export function WeatherWidget({
  days = forecast,
}: {
  days?: readonly (typeof forecast)[number][];
}) {
  const [unit, setUnit] = useState<"F" | "C">("F");
  const [selected, setSelected] = useState<number | null>(null);
  const size = useWidgetSize();
  const [open, setOpen] = useState(false);
  const day = selected === null ? null : days[selected];
  const temperature = (f: number) =>
    Math.round(unit === "F" ? f : ((f - 32) * 5) / 9);
  const Icon = day ? icons[day.icon] : CloudSun;
  return (
    <Widget title="Weather" className="weather-widget" scale="14 / 16 / 56">
      <div className="weather-current" aria-live="polite">
        <div>
          <p className="subtle">San Francisco</p>
          <div className="weather-value">
            <span className="hero-number">{temperature(day?.high ?? 68)}°</span>
            <Control
              className="unit-control"
              aria-label={`Switch to degrees ${unit === "F" ? "Celsius" : "Fahrenheit"}`}
              onClick={() => setUnit((u) => (u === "F" ? "C" : "F"))}
            >
              °{unit}
            </Control>
          </div>
          <p>{day ? `${day.day} · ${day.condition}` : "Partly cloudy"}</p>
        </div>
        <Icon className="weather-hero-icon" aria-hidden="true" />
      </div>
      {size === "small" ? (
        <Control className="forecast-open" onClick={() => setOpen(true)}>
          5-day forecast
        </Control>
      ) : (
        <fieldset className="weather-forecast" aria-label="Five-day forecast">
          {days.map((item, index) => {
            const ForecastIcon = icons[item.icon];
            return (
              <Action
                type="button"
                key={item.day}
                aria-label={`${item.day}: ${item.condition}, high ${temperature(item.high)}, low ${temperature(item.low)} degrees ${unit}`}
                aria-pressed={index === selected}
                onClick={() => setSelected(index === selected ? null : index)}
              >
                <span className="subtle">{item.day}</span>
                <ForecastIcon aria-hidden="true" />
                <span>{temperature(item.high)}°</span>
                {size === "large" && (
                  <span className="subtle">{temperature(item.low)}°</span>
                )}
              </Action>
            );
          })}
        </fieldset>
      )}
      {open && (
        <DetailDialog title="Five-day forecast" onClose={() => setOpen(false)}>
          <div className="forecast-details">
            {days.map((item) => (
              <p key={item.day}>
                <span>
                  {item.day} · {item.condition}
                </span>
                <span>
                  {temperature(item.high)}° / {temperature(item.low)}°
                </span>
              </p>
            ))}
          </div>
        </DetailDialog>
      )}
    </Widget>
  );
}
