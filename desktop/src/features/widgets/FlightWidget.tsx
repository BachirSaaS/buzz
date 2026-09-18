import { Plane } from "lucide-react";
import { Widget } from "./Widget";
import { useWidgetSize } from "./WidgetSizing";

/** The essential itinerary, with explicit local time zones and dates. */
export function FlightWidget({
  origin = "SFO",
  destination = "JFK",
  originCity = "San Francisco",
  destinationCity = "New York",
  departure = "10:30 AM",
  arrival = "7:05 PM",
  departureDate = "Sep 18",
  arrivalDate = "Sep 18",
  departureZone = "PDT",
  arrivalZone = "EDT",
}: {
  origin?: string;
  destination?: string;
  originCity?: string;
  destinationCity?: string;
  departure?: string;
  arrival?: string;
  departureDate?: string;
  arrivalDate?: string;
  departureZone?: string;
  arrivalZone?: string;
}) {
  const size = useWidgetSize();
  return (
    <Widget title="Flight" className="flight-widget" scale="14 / 16 / 32">
      <div className="flight-route">
        <div>
          <h3>{origin}</h3>
          {size !== "small" && <p className="small subtle">{originCity}</p>}
        </div>
        <div className="flight-path" aria-hidden="true">
          <span />
          <Plane />
          <span />
        </div>
        <div>
          <h3>{destination}</h3>
          {size !== "small" && (
            <p className="small subtle">{destinationCity}</p>
          )}
        </div>
      </div>
      <div className="flight-times">
        <div>
          {size === "large" && <p className="small subtle">Departs</p>}
          <p>{departure}</p>
          <p className="small subtle">
            {departureDate} · {departureZone}
          </p>
        </div>
        <div>
          {size === "large" && <p className="small subtle">Arrives</p>}
          <p>{arrival}</p>
          <p className="small subtle">
            {arrivalDate} · {arrivalZone}
          </p>
        </div>
      </div>
    </Widget>
  );
}
