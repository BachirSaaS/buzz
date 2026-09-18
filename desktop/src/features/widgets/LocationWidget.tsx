import { Minus, Navigation, Plus } from "lucide-react";
import { useId, useState } from "react";
import { Control, Widget } from "./Widget";
import { useWidgetSize } from "./WidgetSizing";

/** An illustrative San Francisco map with bounded zoom and recenter controls. */
export function LocationWidget() {
  const size = useWidgetSize();
  const [zoom, setZoom] = useState(1);
  const patternId = useId();
  return (
    <Widget
      title="Location"
      bleed
      className="location-widget"
      scale="14 / 16 / 32"
    >
      <svg
        className="location-map"
        viewBox="0 0 400 336"
        preserveAspectRatio="xMidYMid slice"
        role="img"
        aria-label="Illustrated map of San Francisco and the bay"
      >
        <defs>
          <pattern
            id={patternId}
            width="26"
            height="20"
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(-12)"
          >
            <rect width="26" height="20" fill="#e5e6df" />
            <path d="M0 0H26M0 0V20" stroke="#fafbf6" strokeWidth="5" />
          </pattern>
        </defs>
        <rect width="400" height="336" fill="#cedddf" />
        <g transform={`translate(200 168) scale(${zoom}) translate(-200 -168)`}>
          <path
            d="M-40-20H274L286 27 318 58 305 89 328 116 354 158 330 185 341 211 319 227 350 277 376 360H-40Z"
            fill={`url(#${patternId})`}
            stroke="#f9fbf8"
            strokeWidth="4"
          />
          <path
            d="M-8 154 135 127 145 180 0 211Z"
            fill="#bdcbb1"
            stroke="#f4f5e9"
            strokeWidth="4"
          />
          <path d="m0 0 110 0 13 42-52 43L0 105Z" fill="#b5c6aa" />
          <path
            d="m198 35 23-5 8 42-23 5Z M194 226l24-5 9 47-24 5Z"
            fill="#c1cdb5"
          />
          <path
            d="M104 354 160 231 230 182 319 88M-10 112 326 47M-10 265 334 192"
            stroke="#fdfbf3"
            strokeWidth="9"
            fill="none"
          />
          <path
            d="M104 354 160 231 230 182 319 88"
            stroke="#dacdbc"
            strokeWidth="2"
            fill="none"
          />
          <g className="map-labels" fill="#68766b">
            <text x="30" y="60">
              PRESIDIO
            </text>
            <text x="33" y="166" transform="rotate(-12 33 166)">
              GOLDEN GATE PARK
            </text>
            <text x="238" y="106">
              NOB HILL
            </text>
            <text x="203" y="280">
              MISSION
            </text>
          </g>
          <circle cx="225" cy="168" r="27" fill="#fff" fillOpacity=".45" />
          <circle
            cx="225"
            cy="168"
            r="12"
            fill="#171717"
            stroke="white"
            strokeWidth="5"
          />
        </g>
      </svg>
      {size !== "small" && (
        <div className="map-top">
          <div className="map-controls">
            <Control
              className="icon-control"
              aria-label="Zoom out"
              disabled={zoom <= 1}
              onClick={() => setZoom((z) => Math.max(1, z - 0.25))}
            >
              <Minus aria-hidden="true" />
            </Control>
            <Control
              className="icon-control"
              aria-label="Zoom in"
              disabled={zoom >= 2}
              onClick={() => setZoom((z) => Math.min(2, z + 0.25))}
            >
              <Plus aria-hidden="true" />
            </Control>
          </div>
        </div>
      )}
      <div className="map-caption">
        <div>
          <h3>San Francisco</h3>
          <p>California, United States</p>
        </div>
        <Control
          className="icon-control"
          aria-label="Recenter map"
          onClick={() => setZoom(1)}
        >
          <Navigation aria-hidden="true" />
        </Control>
      </div>
    </Widget>
  );
}
