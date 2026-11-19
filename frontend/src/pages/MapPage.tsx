import L from "leaflet";
import { CircleAlert, Flag, Layers, LocateFixed, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { MapContainer, Marker, Popup, TileLayer, ZoomControl, useMap } from "react-leaflet";
import type { DemoTrip } from "../components/DemoChips";
import HeatmapControls from "../components/HeatmapControls";
import HeatmapLayer from "../components/HeatmapLayer";
import { FitOnce, FollowPosition, LiveMarker, MapClick, ReportMarkers, TripRouteLayer } from "../components/LiveLayers";
import ReportIncident from "../components/ReportIncident";
import TripBar from "../components/TripBar";
import RouteLayer, { FitToRoute } from "../components/RouteLayer";
import SafetyLegend from "../components/SafetyLegend";
import SearchPanel, { type NightSetting } from "../components/SearchPanel";
import {
  friendlyError,
  getHeatmap,
  getStatus,
  inChicago,
  listReports,
  planRoute,
  type IncidentReport,
  type FriendlyError,
  type Heatmap,
  type MapStatus,
  type Place,
  type RouteProfile,
  type RouteResponse,
} from "../lib/api";
import { useSafety } from "../lib/safety";
import { chicagoBucket, chicagoClock } from "../lib/time";

const CHICAGO_CENTER: [number, number] = [41.8781, -87.6298];

// Simple CSS pin icons (avoids Leaflet's default image icons, which break under Vite bundling).
function pin(color: string, letter: string): L.DivIcon {
  return L.divIcon({
    className: "",
    html: `<div style="background:${color};width:30px;height:30px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4);display:flex;align-items:center;justify-content:center"><span style="transform:rotate(45deg);color:#fff;font:700 12px system-ui">${letter}</span></div>`,
    iconSize: [30, 30],
    iconAnchor: [15, 30],
    popupAnchor: [0, -28],
  });
}
const FROM_ICON = pin("#0f766e", "A");
const TO_ICON = pin("#3b1f6b", "B");

/** Pan/zoom to the chosen places while there is no route yet. */
function FitToPlaces({ from, to, active }: { from: Place | null; to: Place | null; active: boolean }) {
  const map = useMap();
  useEffect(() => {
    if (!active) return;
    const pts = [from, to].filter((p): p is Place => p !== null).map((p) => L.latLng(p.lat, p.lon));
    if (pts.length === 1) map.flyTo(pts[0], Math.max(map.getZoom(), 15), { duration: 0.6 });
    if (pts.length === 2) map.flyToBounds(L.latLngBounds(pts), { padding: [60, 60], duration: 0.6 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, from, to]);
  return null;
}

const nightParam = (s: NightSetting): boolean | "auto" => (s === "auto" ? "auto" : s === "on");

export default function MapPage() {
  const safety = useSafety();
  const { trip, tripSegments, position, progress } = safety;
  const demoMode = safety.demo;
  const [follow, setFollow] = useState(true);
  const [reports, setReports] = useState<IncidentReport[]>([]);
  const [reportMode, setReportMode] = useState(false);
  const [reportPoint, setReportPoint] = useState<{ lat: number; lng: number; label: string } | null>(null);
  const [from, setFrom] = useState<Place | null>(null);
  const [to, setTo] = useState<Place | null>(null);
  const [departAt, setDepartAt] = useState<string | null>(null);
  const [nightSetting, setNightSetting] = useState<NightSetting>("auto");
  const [result, setResult] = useState<RouteResponse | null>(null);
  const [selected, setSelected] = useState<RouteProfile>("safest");
  const [routing, setRouting] = useState(false);
  const [error, setError] = useState<FriendlyError | null>(null);

  const [status, setStatus] = useState<MapStatus | null>(null);
  const [statusError, setStatusError] = useState<FriendlyError | null>(null);

  const [heatOn, setHeatOn] = useState(false);
  const [heatBucket, setHeatBucket] = useState(() => chicagoBucket());
  const [heat, setHeat] = useState<Heatmap | null>(null);
  const [heatLoading, setHeatLoading] = useState(false);
  const [heatError, setHeatError] = useState<string | null>(null);
  const heatCache = useRef(new Map<number, Heatmap>());

  const panelRef = useRef<HTMLDivElement>(null);
  const mapBoxRef = useRef<HTMLDivElement>(null);
  const reqId = useRef(0);

  // ---- status (night mode badge + readiness); refreshed every minute and when the departure changes
  useEffect(() => {
    let cancelled = false;
    const load = () =>
      getStatus(departAt)
        .then((s) => {
          if (cancelled) return;
          setStatus(s);
          setStatusError(null);
        })
        .catch((err: unknown) => !cancelled && setStatusError(friendlyError(err, "route")));
    load();
    const t = setInterval(load, 60_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [departAt]);

  const nightActive = nightSetting === "on" || (nightSetting === "auto" && !!status?.night_mode);
  const currentBucket = status && departAt === null ? status.bucket : chicagoBucket();

  // ---- routing
  const plan = useCallback(
    async (a: Place | null, b: Place | null) => {
      if (!a || !b) return;
      if (!inChicago(a.lat, a.lon) || !inChicago(b.lat, b.lon)) {
        setResult(null);
        setError({
          title: "Outside the Chicago pilot area",
          text: "WAYRA currently has data for the City of Chicago only. Pick a start and destination inside Chicago, or try a demo trip.",
        });
        return;
      }
      const id = ++reqId.current;
      setRouting(true);
      setError(null);
      try {
        const res = await planRoute(a, b, { departAt: departAt ?? undefined, nightMode: nightParam(nightSetting) });
        if (id !== reqId.current) return;
        setResult(res);
        setSelected("safest");
      } catch (err) {
        if (id !== reqId.current) return;
        setResult(null);
        setError(friendlyError(err, "route"));
      } finally {
        if (id === reqId.current) setRouting(false);
      }
    },
    [departAt, nightSetting],
  );

  // Re-plan when the departure time or night-safe setting changes and a route is showing.
  const planRef = useRef(plan);
  const hasResult = useRef(false);
  hasResult.current = result !== null;
  useEffect(() => {
    if (planRef.current === plan) return;
    planRef.current = plan;
    if (!hasResult.current) return;
    const t = setTimeout(() => plan(from, to), 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan]);

  function changeFrom(p: Place | null) {
    setFrom(p);
    setResult(null);
    setError(null);
  }
  function changeTo(p: Place | null) {
    setTo(p);
    setResult(null);
    setError(null);
  }
  function demo(t: DemoTrip) {
    setFrom(t.from);
    setTo(t.to);
    setResult(null);
    void plan(t.from, t.to);
  }

  // ---- incident reports (shown on the map; they also raise nearby street risk for 2 h)
  const loadReports = useCallback(() => {
    listReports().then(setReports).catch(() => {});
  }, []);
  useEffect(() => {
    loadReports();
    const t = setInterval(loadReports, 60_000);
    return () => clearInterval(t);
  }, [loadReports]);

  function reportHere() {
    if (trip && position) {
      setReportPoint({ lat: position.lat, lng: position.lng, label: position.sim ? "At the demo walker's position" : "At your current location" });
    } else {
      setReportMode(true);
    }
  }

  // ---- trips
  async function startTrip(demoOn: boolean) {
    const r = result?.routes.find((x) => x.profile === selected);
    if (!r) return;
    await safety.startTrip(r, from, to, demoOn);
    setFollow(true);
  }

  // ---- heatmap
  useEffect(() => {
    if (!heatOn) return;
    const cached = heatCache.current.get(heatBucket);
    if (cached) {
      setHeat(cached);
      setHeatError(null);
      return;
    }
    const ctrl = new AbortController();
    setHeatLoading(true);
    setHeatError(null);
    getHeatmap(heatBucket, ctrl.signal)
      .then((h) => {
        heatCache.current.set(heatBucket, h);
        setHeat(h);
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        const f = friendlyError(err, "heatmap");
        setHeatError(`${f.title}. ${f.text}`);
      })
      .finally(() => !ctrl.signal.aborted && setHeatLoading(false));
    return () => ctrl.abort();
  }, [heatOn, heatBucket]);

  function toggleHeat() {
    if (!heatOn) setHeatBucket(result ? result.bucket : currentBucket);
    setHeatOn((o) => !o);
  }

  // Keep the fitted route clear of the floating panel (left column on desktop, top sheet on phones).
  const fitPadding = useCallback(() => {
    const map = mapBoxRef.current?.getBoundingClientRect();
    const panel = panelRef.current?.getBoundingClientRect();
    if (!map || !panel) return { topLeft: [40, 40] as [number, number], bottomRight: [40, 40] as [number, number] };
    if (panel.width < map.width * 0.6) {
      return { topLeft: [panel.right - map.left + 32, 40] as [number, number], bottomRight: [96, 40] as [number, number] };
    }
    return { topLeft: [28, panel.bottom - map.top + 20] as [number, number], bottomRight: [28, 110] as [number, number] };
  }, []);

  const selRoute = result?.routes.find((r) => r.profile === selected);
  const notReady =
    statusError ??
    (status && !status.routing_ready
      ? { title: "Routing is still getting ready", text: "The street-risk data isn't loaded on the server yet. Run `npm run score`, then restart the backend." }
      : null);

  return (
    <div ref={mapBoxRef} className="absolute inset-0">
      <MapContainer
        center={CHICAGO_CENTER}
        zoom={12}
        zoomControl={false}
        dragging
        touchZoom
        scrollWheelZoom
        doubleClickZoom
        boxZoom
        keyboard
        className="absolute inset-0 z-0 h-full w-full"
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <ZoomControl position="topright" />
        {heatOn && heat && <HeatmapLayer data={heat} />}
        {reports.length > 0 && <ReportMarkers reports={reports} />}
        {trip ? (
          <>
            <TripRouteLayer geometry={trip.geometry} segments={tripSegments} />
            <Marker position={trip.geometry[trip.geometry.length - 1]} icon={TO_ICON}>
              <Popup>{trip.to_name || "Destination"}</Popup>
            </Marker>
            {position && (
              <LiveMarker
                lat={position.lat}
                lng={position.lng}
                tone={progress && !progress.onRoute ? "amber" : "teal"}
                label={position.sim ? "DEMO" : undefined}
                title={position.sim ? "Simulated walker (demo mode)" : "You"}
              />
            )}
            <FitOnce points={trip.geometry} deps={trip.id} />
            <FollowPosition point={position} follow={follow} onUserMove={() => setFollow(false)} />
          </>
        ) : (
          result && <RouteLayer result={result} selected={selected} onSelect={setSelected} />
        )}
        {reportMode && (
          <MapClick
            onClick={(lat, lng) => {
              setReportMode(false);
              setReportPoint({ lat, lng, label: `At the point you picked (${lat.toFixed(4)}, ${lng.toFixed(4)})` });
            }}
          />
        )}
        {!trip && from && (
          <Marker position={[from.lat, from.lon]} icon={FROM_ICON}>
            <Popup>From: {from.name}</Popup>
          </Marker>
        )}
        {!trip && to && (
          <Marker position={[to.lat, to.lon]} icon={TO_ICON}>
            <Popup>To: {to.name}</Popup>
          </Marker>
        )}
        <FitToPlaces from={from} to={to} active={!result && !routing && !trip} />
        {!trip && <FitToRoute route={selRoute} padding={fitPadding} />}
      </MapContainer>

      {/* Overlay: the container is click-through; only the panels themselves take pointer events. */}
      <div className="pointer-events-none absolute inset-0 z-[1000] flex flex-col items-stretch gap-2 p-3 sm:items-start">
        {notReady && (
          <div role="alert" className="pointer-events-auto flex w-full items-start gap-2 rounded-2xl bg-amber-50 px-3.5 py-2.5 text-sm text-amber-900 shadow-[var(--shadow-card)] ring-1 ring-amber-200 sm:w-[25rem]">
            <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <span>
              <span className="font-semibold">{notReady.title}.</span> {notReady.text}
            </span>
          </div>
        )}
        {reportMode && (
          <div role="status" className="pointer-events-auto flex w-full items-center gap-2 rounded-2xl bg-brand-900 px-3.5 py-2.5 text-sm text-white shadow-[var(--shadow-lift)] sm:w-[25rem]">
            <Flag className="h-4 w-4 shrink-0 text-brand-teal-light" aria-hidden />
            <span className="flex-1">Tap the map where it happened.</span>
            <button type="button" onClick={() => setReportMode(false)} aria-label="Cancel report" className="rounded-full p-1 hover:bg-white/15">
              <X className="h-4 w-4" aria-hidden />
            </button>
          </div>
        )}
        {!trip && (
        <SearchPanel
          ref={panelRef}
          from={from}
          to={to}
          onFromChange={changeFrom}
          onToChange={changeTo}
          departAt={departAt}
          onDepartAt={setDepartAt}
          nightSetting={nightSetting}
          onNightSetting={setNightSetting}
          nightActive={nightActive}
          sunsetText={status ? chicagoClock(status.sunset) : undefined}
          routing={routing}
          error={error}
          onSearch={() => void plan(from, to)}
          onDemo={demo}
          result={result}
          selected={selected}
          onSelect={setSelected}
          onStartTrip={startTrip}
        />
        )}
      </div>

      {/* Active trip: bottom card on phones (above SOS), left column on desktop. */}
      {trip && (
        <div className="pointer-events-none absolute inset-x-3 bottom-24 z-[1000] flex max-h-[calc(100%-7rem)] flex-col overflow-y-auto sm:bottom-auto sm:left-3 sm:right-auto sm:top-3 sm:max-h-[calc(100%-1.5rem)] sm:w-[25rem]">
          <TripBar onReport={reportHere} />
        </div>
      )}
      {safety.saferRoute && (
        <div className="pointer-events-none absolute inset-x-3 top-3 z-[1010] flex justify-center sm:left-[27rem] sm:right-3">
          <div role="alert" className="pointer-events-auto w-full max-w-sm rounded-2xl bg-white p-3.5 shadow-[var(--shadow-lift)] ring-2 ring-brand-teal">
            <p className="font-display text-base font-bold text-ink">Safer route found</p>
            <p className="mt-0.5 text-sm text-ink-soft">
              Avoids {safety.saferRoute.avoided === 1 ? "a spot reported unsafe" : `${safety.saferRoute.avoided} spots reported unsafe`} on your route ahead ·{" "}
              {safety.saferRoute.extraMin > 0.5
                ? `+${Math.round(safety.saferRoute.extraMin)} min`
                : safety.saferRoute.extraMin < -0.5
                  ? `${Math.round(-safety.saferRoute.extraMin)} min shorter`
                  : "about the same time"}
            </p>
            <div className="mt-2.5 flex gap-2">
              <button type="button" onClick={() => void safety.acceptSaferRoute()} className="flex-1 rounded-xl bg-brand-teal py-2 text-sm font-semibold text-brand-950 hover:bg-brand-teal-light">
                Switch route
              </button>
              <button type="button" onClick={safety.dismissSaferRoute} className="flex-1 rounded-xl py-2 text-sm font-semibold text-brand-800 ring-1 ring-line hover:bg-brand-50">
                Keep current
              </button>
            </div>
          </div>
        </div>
      )}
      <ReportIncident
        point={reportPoint}
        onClose={() => setReportPoint(null)}
        onSaved={(r) => {
          setReportPoint(null);
          setReports((rs) => [r, ...rs]);
          safety.notify({ tone: "success", title: "Thanks, report saved", text: "Nearby streets count as riskier for the next 2 hours." });
        }}
      />

      {/* Bottom-left: heatmap controls and/or route legend (kept clear of the SOS button on the right). */}
      <div className={`pointer-events-none absolute bottom-3 left-3 right-24 z-[1000] flex-col items-start gap-2 sm:left-[27rem] sm:right-auto sm:w-80 ${trip ? "hidden sm:flex" : "flex"}`}>
        {(result || trip) && !(heatOn && window.matchMedia("(max-width: 639px)").matches) && (
          <div className="pointer-events-auto">
            <SafetyLegend />
          </div>
        )}
        {heatOn && (
          <div className="pointer-events-auto w-full">
            <HeatmapControls
              bucket={heatBucket}
              currentBucket={currentBucket}
              onBucket={setHeatBucket}
              loading={heatLoading}
              error={heatError}
              forecastMonth={heat?.forecast_month ?? null}
              onClose={() => setHeatOn(false)}
            />
          </div>
        )}
      </div>

      {/* Right-side map tools, stacked above the SOS button. */}
      <div className={`pointer-events-none absolute right-4 z-[1000] flex-col items-end gap-2 ${trip ? "hidden sm:flex sm:bottom-24" : "bottom-24 flex"}`}>
        {trip && !follow && position && (
          <button
            type="button"
            onClick={() => setFollow(true)}
            className="pointer-events-auto flex h-11 items-center gap-1.5 rounded-full bg-white px-3.5 text-sm font-semibold text-brand-800 shadow-[var(--shadow-lift)] ring-1 ring-line transition hover:bg-brand-50"
          >
            <LocateFixed className="h-[18px] w-[18px]" aria-hidden /> {demoMode.on ? "Follow walker" : "Recenter"}
          </button>
        )}
        <button
          type="button"
          onClick={reportHere}
          aria-label="Report unsafe spot"
          title="Report unsafe spot"
          className="pointer-events-auto flex h-11 min-w-11 items-center justify-center gap-1.5 rounded-full bg-white px-3 text-sm font-semibold text-brand-800 shadow-[var(--shadow-lift)] ring-1 ring-line transition hover:-translate-y-px hover:bg-brand-50 active:scale-95 sm:px-3.5"
        >
          <Flag className="h-[18px] w-[18px]" aria-hidden />
          <span className="hidden sm:inline">Report</span>
        </button>
        <button
          type="button"
          onClick={toggleHeat}
          aria-pressed={heatOn}
          aria-label="Heatmap"
          title="Risk heatmap"
          className={`pointer-events-auto flex h-11 min-w-11 items-center justify-center gap-1.5 rounded-full px-3 text-sm sm:px-3.5 font-semibold shadow-[var(--shadow-lift)] ring-1 transition active:scale-95 ${
            heatOn ? "bg-brand-800 text-white ring-brand-800" : "bg-white text-brand-800 ring-line hover:-translate-y-px hover:bg-brand-50"
          }`}
        >
          <Layers className="h-[18px] w-[18px]" aria-hidden />
          <span className="hidden sm:inline">Heatmap</span>
        </button>
      </div>
    </div>
  );
}
