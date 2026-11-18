import { useState } from "react";
import { inChicago, type Place } from "../lib/api";
import PlaceInput from "./PlaceInput";

type Props = {
  from: Place | null;
  to: Place | null;
  onFromChange: (p: Place | null) => void;
  onToChange: (p: Place | null) => void;
};

export default function SearchPanel({ from, to, onFromChange, onToChange }: Props) {
  const [locating, setLocating] = useState(false);
  const [message, setMessage] = useState<{ kind: "info" | "error"; text: string } | null>(null);

  function useMyLocation() {
    if (!("geolocation" in navigator)) {
      setMessage({ kind: "error", text: "Your browser doesn't support location access." });
      return;
    }
    setLocating(true);
    setMessage(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        const { latitude: lat, longitude: lon } = pos.coords;
        if (!inChicago(lat, lon)) {
          setMessage({
            kind: "error",
            text: "You're outside the Chicago pilot area. Search for a Chicago address instead.",
          });
          return;
        }
        onFromChange({ name: "My location", lat, lon });
      },
      (err) => {
        setLocating(false);
        const text =
          err.code === err.PERMISSION_DENIED
            ? "Location permission was denied. Allow it in your browser settings, or type an address."
            : "Couldn't get your location. Try again or type an address.";
        setMessage({ kind: "error", text });
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 },
    );
  }

  function findRoute() {
    setMessage({
      kind: "info",
      text: "Safe routing is coming in a later phase. Your start and destination are set.",
    });
  }

  return (
    <div className="absolute inset-x-0 top-0 z-[1000] p-3 sm:left-3 sm:right-auto sm:w-[26rem]">
      <div className="space-y-2 rounded-2xl bg-white/95 p-3 shadow-lg backdrop-blur">
        <PlaceInput
          label="From"
          placeholder="Start point in Chicago"
          value={from}
          onChange={(p) => {
            setMessage(null);
            onFromChange(p);
          }}
          dotClass="bg-brand-teal"
          action={
            <button
              type="button"
              onClick={useMyLocation}
              disabled={locating}
              title="Use my location"
              aria-label="Use my location"
              className="shrink-0 rounded-md px-2 py-1 text-xs font-semibold text-brand-teal-dark hover:bg-brand-teal/10 disabled:opacity-60"
            >
              {locating ? "Locating…" : "◎ Me"}
            </button>
          }
        />
        <PlaceInput
          label="To"
          placeholder="Destination in Chicago"
          value={to}
          onChange={(p) => {
            setMessage(null);
            onToChange(p);
          }}
          dotClass="bg-brand-purple"
        />
        <button
          type="button"
          onClick={findRoute}
          disabled={!from || !to}
          className="w-full rounded-lg bg-brand-purple py-3 font-semibold text-white transition hover:bg-brand-purple-light disabled:cursor-not-allowed disabled:opacity-50"
        >
          Find safe route
        </button>
        {message && (
          <p
            role={message.kind === "error" ? "alert" : "status"}
            className={`rounded-lg px-3 py-2 text-sm ${
              message.kind === "error" ? "bg-red-50 text-red-700" : "bg-brand-teal/10 text-brand-teal-dark"
            }`}
          >
            {message.text}
          </p>
        )}
      </div>
    </div>
  );
}
