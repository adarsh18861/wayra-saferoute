import { ChevronDown, CircleAlert, Clock, Footprints, LocateFixed, Moon, Navigation, Pencil } from "lucide-react";
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
  onStartTrip: (demo: boolean) => Promise<void>;
};

/** "Start trip" on the selected route, with the DEMO MODE choice (simulated walker). */
function StartTrip({ label, onStart }: { label: string; onStart: (demo: boolean) => Promise<void> }) {
  const [demo, setDemo] = useState(() => {
    try {
      return localStorage.getItem("wayra.demoDefault") !== "0";
    } catch {
      return true;
    }
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <div className="rounded-2xl bg-brand-teal/8 p-3 ring-1 ring-brand-teal/25">
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setErr(null);
          try {
            localStorage.setItem("wayra.demoDefault", demo ? "1" : "0");
          } catch {
            /* ignore */
          }
          try {
            await onStart(demo);
          } catch (e) {
            setErr(e instanceof Error ? e.message : "Couldn't start the trip.");
          } finally {
            setBusy(false);
          }
        }}
        className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-brand-teal font-semibold text-brand-950 shadow-[var(--shadow-glow)] transition hover:-translate-y-px hover:bg-brand-teal-light active:translate-y-0 disabled:opacity-60"
      >
        <Footprints className="h-5 w-5" aria-hidden />
        {busy ? "Starting…" : `Start trip on ${label}`}
      </button>
      <label className="mt-2 flex cursor-pointer items-start gap-2 text-xs text-ink-soft">
        <input type="checkbox" checked={demo} onChange={(e) => setDemo(e.target.checked)} className="mt-0.5 h-4 w-4 accent-brand-700" />
        <span>
          <span className="font-semibold text-ink">Demo mode</span>: a simulated walker follows the route (for presenting away from
          Chicago). Turn off to use your real GPS.
        </span>
      </label>
      {err && <p className="mt-2 text-xs text-red-700">{err}</p>}
    </div>
  );
}

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
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-xl bg-brand-50 p-0.5 ring-1 ring-brand-100">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={`rounded-[10px] px-2.5 py-1 text-xs font-semibold transition ${
            value === o.value ? "bg-white text-brand-800 shadow-[var(--shadow-card)]" : "text-ink-soft hover:text-brand-800"
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
  const { routing, error, onSearch, onDemo, result, selected, onSelect, onStartTrip } = props;
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
      className="pointer-events-auto flex max-h-[62%] min-h-0 w-full flex-col overflow-hidden rounded-3xl bg-white/95 shadow-[var(--shadow-lift)] ring-1 ring-line backdrop-blur-xl sm:max-h-full sm:w-[25rem]"
    >
      {/* ---------------- search form ---------------- */}
      {formOpen ? (
        <form
          className="shrink-0 space-y-3 p-3.5"
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
                className="inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-brand-teal-dark transition hover:bg-brand-teal/10 disabled:opacity-60"
              >
                <LocateFixed className="h-3.5 w-3.5" aria-hidden />
                {locating ? "Locating…" : "Me"}
              </button>
            }
          />
          <PlaceInput label="To" placeholder="Destination in Chicago" value={to} onChange={onToChange} dotClass="bg-brand-purple" />

          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <div className="flex items-center gap-1.5">
              <span className="inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-ink-soft">
                <Clock className="h-3.5 w-3.5" aria-hidden /> Leave
              </span>
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
              <span className="inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-ink-soft" id="night-label">
                <Moon className="h-3.5 w-3.5" aria-hidden /> Night-safe
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
                className="min-w-0 flex-1 rounded-lg border border-line px-2 py-1.5 text-sm text-ink focus:border-brand-teal focus:outline-none focus:ring-4 focus:ring-brand-teal/15"
              />
            </label>
          )}
          <NightModeBadge active={nightActive} source={nightSource} sunset={sunsetText} />

          <button
            type="submit"
            disabled={!from || !to || routing}
            className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-brand-800 font-semibold text-white shadow-[var(--shadow-card)] transition hover:-translate-y-px hover:bg-brand-700 hover:shadow-[var(--shadow-lift)] active:translate-y-0 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0"
          >
            <Navigation className={`h-4 w-4 ${routing ? "animate-pulse" : ""}`} aria-hidden />
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
        <div className="flex shrink-0 items-center gap-2 border-b border-line px-3.5 py-3">
          <div className="min-w-0 flex-1 text-sm">
            <p className="truncate font-semibold text-ink">
              {from?.name ?? "?"} <span className="text-brand-teal-dark">→</span> {to?.name ?? "?"}
            </p>
            <p className="truncate text-xs text-ink-soft">
              {departAt ? departLabel(departAt) : "Leaving now"}
              {nightActive && " · Night-safe mode active"}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setFormOpen(true)}
            className="inline-flex shrink-0 items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-semibold text-brand-800 ring-1 ring-brand-200 transition hover:bg-brand-50"
          >
            <Pencil className="h-3.5 w-3.5" aria-hidden />
            Edit
          </button>
        </div>
      )}

      {/* ---------------- loading / error / results ---------------- */}
      {routing && (
        <div role="status" aria-label="Finding routes" className="grid shrink-0 grid-cols-3 gap-2 border-t border-line p-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-32 animate-pulse rounded-2xl bg-brand-50" />
          ))}
        </div>
      )}
      {!routing && error && (
        <div role="alert" className="m-3 mt-0 shrink-0 rounded-2xl border border-red-200 bg-red-50 p-3.5 text-sm text-red-900">
          <p className="flex items-center gap-1.5 font-semibold">
            <CircleAlert className="h-4 w-4 shrink-0" aria-hidden />
            {error.title}
          </p>
          <p className="mt-0.5 text-red-800">{error.text}</p>
          {from && to && (
            <button type="button" onClick={onSearch} className="mt-2 rounded-lg bg-red-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-800">
              Try again
            </button>
          )}
        </div>
      )}
      {!routing && result && (
        <section aria-label="Route results" className="flex min-h-0 flex-col border-t border-line">
          <button
            type="button"
            aria-expanded={resultsOpen}
            onClick={() => setResultsOpen((o) => !o)}
            className="flex shrink-0 items-center justify-between gap-2 px-3.5 py-2.5 text-left transition hover:bg-brand-50/50"
          >
            <span className="min-w-0 text-sm">
              <span className="font-display text-base font-semibold text-brand-800">Routes</span>
              {!resultsOpen && sel && (
                <span className="text-ink-soft">
                  {" "}
                  · {sel.label}: safety {sel.safety_score}, {Math.round(sel.eta_min)} min, {km(sel.distance_m)}
                </span>
              )}
            </span>
            <ChevronDown aria-hidden className={`h-4 w-4 shrink-0 text-ink-soft transition ${resultsOpen ? "rotate-180" : ""}`} />
            <span className="sr-only">{resultsOpen ? "Hide routes" : "Show routes"}</span>
          </button>
          {resultsOpen && (
            <div className="min-h-0 space-y-2.5 overflow-y-auto px-3.5 pb-3.5">
              <RouteCompare result={result} selected={selected} onSelect={onSelect} />
              {sel && <StartTrip label={sel.label} onStart={onStartTrip} />}
              {sel && (
                <p className="text-xs text-ink-soft">
                  <span className="font-semibold text-ink">{sel.label}:</span>{" "}
                  {(["green", "amber", "red"] as const)
                    .map((l) => {
                      const tot = sel.risk_m.green + sel.risk_m.amber + sel.risk_m.red || 1;
                      return `${Math.round((100 * sel.risk_m[l]) / tot)}% ${LEVEL_LABEL[l].toLowerCase()}`;
                    })
                    .join(" · ")}
                  {sel.identical_to.length > 0 && ` · same path as ${sel.identical_to.join(" & ")}`}
                </p>
              )}
              <p className="text-[11px] leading-snug text-ink-soft">
                {result.night_mode ? "Night-safe routing (extra weight on risk and unlit streets)" : "Daytime routing"}
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
