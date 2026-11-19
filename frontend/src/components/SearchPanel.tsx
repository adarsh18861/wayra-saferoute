import { forwardRef, useEffect, useState } from "react";
import { inChicago, type FriendlyError, type Place, type RouteProfile, type RouteResponse } from "../lib/api";
import { LEVEL_LABEL } from "../lib/risk";
import { chicagoLocalInput, departLabel } from "../lib/time";
import DemoChips, { type DemoTrip } from "./DemoChips";
import NightModeBadge from "./NightModeBadge";
import PlaceInput from "./PlaceInput";
import RouteCompare, { km } from "./RouteCompare";

export type NightSetting = "auto" | "on" | "off";

type Props = {
  from: Place | null;
  to: Place | null;
  onFromChange: (p: Place | null) => void;
  onToChange: (p: Place | null) => void;
  departAt: string | null;
  onDepartAt: (v: string | null) => void;
  nightSetting: NightSetting;
  onNightSetting: (v: NightSetting) => void;
  nightActive: boolean;
  sunsetText?: string;
  routing: boolean;
  error: FriendlyError | null;
  onSearch: () => void;
  onDemo: (t: DemoTrip) => void;
  result: RouteResponse | null;
  selected: RouteProfile;
  onSelect: (p: RouteProfile) => void;
};

function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-lg bg-slate-100 p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={`rounded-md px-2.5 py-1 text-xs font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-teal ${
            value === o.value ? "bg-white text-brand-purple shadow-sm" : "text-slate-600 hover:text-slate-900"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function isSmallScreen(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(max-width: 639px)").matches;
}

/** Floating panel: From/To, departure time, night-safe control, demo chips, and the route results. */
const SearchPanel = forwardRef<HTMLDivElement, Props>(function SearchPanel(props, ref) {
  const { from, to, onFromChange, onToChange, departAt, onDepartAt, nightSetting, onNightSetting, nightActive, sunsetText } = props;
  const { routing, error, onSearch, onDemo, result, selected, onSelect } = props;
  const [locating, setLocating] = useState(false);
  const [geoMsg, setGeoMsg] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(true);
  const [resultsOpen, setResultsOpen] = useState(true);

  // On phones, fold the form away once routes arrive so the map stays visible.
  useEffect(() => {
    if (result) {
      setResultsOpen(true);
      if (isSmallScreen()) setFormOpen(false);
    }
  }, [result]);

  function useMyLocation() {
    if (!("geolocation" in navigator)) {
      setGeoMsg("Your browser doesn't support location access.");
      return;
    }
    setLocating(true);
    setGeoMsg(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        const { latitude: lat, longitude: lon } = pos.coords;
        if (!inChicago(lat, lon)) {
          setGeoMsg("You're outside the Chicago pilot area. Search for a Chicago address instead, or try a demo trip.");
          return;
        }
        onFromChange({ name: "My location", lat, lon });
      },
      (err) => {
        setLocating(false);
        setGeoMsg(
          err.code === err.PERMISSION_DENIED
            ? "Location permission was denied. Allow it in your browser settings, or type an address."
            : "Couldn't get your location. Try again or type an address.",
        );
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 },
    );
  }

  const sel = result?.routes.find((r) => r.profile === selected);
  const nightSource = nightSetting === "on" ? "on" : "auto";

  return (
    <div
      ref={ref}
      className="pointer-events-auto flex max-h-[62%] min-h-0 w-full flex-col overflow-hidden rounded-2xl bg-white/[0.97] shadow-xl ring-1 ring-black/5 backdrop-blur sm:max-h-full sm:w-[25rem]"
    >
      {/* ---------------- search form ---------------- */}
      {formOpen ? (
        <form
          className="shrink-0 space-y-2.5 p-3"
          onSubmit={(e) => {
            e.preventDefault();
            onSearch();
          }}
        >
          <PlaceInput
            label="From"
            placeholder="Start point in Chicago"
            value={from}
            onChange={(p) => {
              setGeoMsg(null);
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
          <PlaceInput label="To" placeholder="Destination in Chicago" value={to} onChange={onToChange} dotClass="bg-brand-purple" />

          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Leave</span>
              <Segmented
                label="Departure time"
                value={departAt === null ? "now" : "later"}
                options={[
                  { value: "now", label: "Now" },
                  { value: "later", label: "Later" },
                ]}
                onChange={(v) => onDepartAt(v === "now" ? null : chicagoLocalInput(new Date(Date.now() + 60 * 60 * 1000)))}
              />
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500" id="night-label">
                🌙 Night-safe
              </span>
              <Segmented
                label="Night-safe mode"
                value={nightSetting}
                options={[
                  { value: "auto", label: "Auto" },
                  { value: "on", label: "On" },
                  { value: "off", label: "Off" },
                ]}
                onChange={onNightSetting}
              />
            </div>
          </div>
          {departAt !== null && (
            <label className="flex items-center gap-2 text-xs text-slate-600">
              <span className="shrink-0">Departure (Chicago time)</span>
              <input
                type="datetime-local"
                value={departAt}
                onChange={(e) => e.target.value && onDepartAt(e.target.value)}
                className="min-w-0 flex-1 rounded-md border border-slate-300 px-2 py-1 text-sm text-slate-900 focus:border-brand-teal focus:outline-none focus:ring-2 focus:ring-brand-teal/30"
              />
            </label>
          )}
          <NightModeBadge active={nightActive} source={nightSource} sunset={sunsetText} />

          <button
            type="submit"
            disabled={!from || !to || routing}
            className="w-full rounded-xl bg-brand-purple py-3 font-semibold text-white shadow-sm transition hover:bg-brand-purple-light focus:outline-none focus-visible:ring-4 focus-visible:ring-brand-teal/40 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {routing ? "Finding safe routes…" : "Find safe route"}
          </button>
          <DemoChips onPick={onDemo} disabled={routing} />
          {geoMsg && (
            <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
              {geoMsg}
            </p>
          )}
        </form>
      ) : (
        <div className="flex shrink-0 items-center gap-2 border-b border-slate-200 px-3 py-2.5">
          <div className="min-w-0 flex-1 text-sm">
            <p className="truncate font-semibold text-slate-900">
              {from?.name ?? "?"} <span className="text-brand-teal-dark">→</span> {to?.name ?? "?"}
            </p>
            <p className="truncate text-xs text-slate-600">
              {departAt ? departLabel(departAt) : "Leaving now"}
              {nightActive && " · 🌙 Night-safe mode active"}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setFormOpen(true)}
            className="shrink-0 rounded-lg border border-brand-purple/30 px-3 py-1.5 text-xs font-semibold text-brand-purple hover:bg-brand-purple/5"
          >
            Edit
          </button>
        </div>
      )}

      {/* ---------------- loading / error / results ---------------- */}
      {routing && (
        <div role="status" aria-label="Finding routes" className="grid shrink-0 grid-cols-3 gap-2 border-t border-slate-100 p-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-28 animate-pulse rounded-xl bg-slate-100" />
          ))}
        </div>
      )}
      {!routing && error && (
        <div role="alert" className="m-3 mt-0 shrink-0 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-900">
          <p className="font-semibold">{error.title}</p>
          <p className="mt-0.5 text-red-800">{error.text}</p>
          {from && to && (
            <button type="button" onClick={onSearch} className="mt-2 rounded-lg bg-red-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-800">
              Try again
            </button>
          )}
        </div>
      )}
      {!routing && result && (
        <section aria-label="Route results" className="flex min-h-0 flex-col border-t border-slate-200">
          <button
            type="button"
            aria-expanded={resultsOpen}
            onClick={() => setResultsOpen((o) => !o)}
            className="flex shrink-0 items-center justify-between gap-2 px-3 py-2 text-left hover:bg-slate-50"
          >
            <span className="min-w-0 text-sm">
              <span className="font-semibold text-brand-purple">Routes</span>
              {!resultsOpen && sel && (
                <span className="text-slate-700">
                  {" "}
                  · {sel.label}: safety {sel.safety_score}, {Math.round(sel.eta_min)} min, {km(sel.distance_m)}
                </span>
              )}
            </span>
            <span aria-hidden className={`text-slate-500 transition ${resultsOpen ? "rotate-180" : ""}`}>
              ▾
            </span>
            <span className="sr-only">{resultsOpen ? "Hide routes" : "Show routes"}</span>
          </button>
          {resultsOpen && (
            <div className="min-h-0 space-y-2 overflow-y-auto px-3 pb-3">
              <RouteCompare result={result} selected={selected} onSelect={onSelect} />
              {sel && (
                <p className="text-xs text-slate-700">
                  <span className="font-semibold text-slate-900">{sel.label}:</span>{" "}
                  {(["green", "amber", "red"] as const)
                    .map((l) => {
                      const tot = sel.risk_m.green + sel.risk_m.amber + sel.risk_m.red || 1;
                      return `${Math.round((100 * sel.risk_m[l]) / tot)}% ${LEVEL_LABEL[l].toLowerCase()}`;
                    })
                    .join(" · ")}
                  {sel.identical_to.length > 0 && ` · same path as ${sel.identical_to.join(" & ")}`}
                </p>
              )}
              <p className="text-[11px] leading-snug text-slate-500">
                {result.night_mode ? "🌙 Night-safe routing (extra weight on risk and unlit streets)" : "Daytime routing"}
                {result.night_mode_source === "override" ? " · set manually" : " · auto"} · lighting and crowd levels are
                estimates · tap a grey line on the map to switch routes
              </p>
            </div>
          )}
        </section>
      )}
    </div>
  );
});

export default SearchPanel;
