import L from "leaflet";
import { useEffect, useMemo, useRef } from "react";
import { CircleMarker, Marker, Polyline, Tooltip, useMap, useMapEvents } from "react-leaflet";
import type { IncidentReport, RouteSegment } from "../lib/api";
import { REPORT_LABEL } from "./ReportIncident";
import { CasedRoute } from "./RouteLayer";

/** Pulsing location dot. `tone` = teal (normal), amber (off route) or red (SOS). */
function dotIcon(tone: "teal" | "amber" | "red", label?: string): L.DivIcon {
  const color = tone === "red" ? "#dc2626" : tone === "amber" ? "#d97706" : "#0f766e";
  const tag = label
    ? `<span style="position:absolute;left:50%;top:-22px;transform:translateX(-50%);white-space:nowrap;background:${color};color:#fff;font:700 10px/1 system-ui;letter-spacing:.06em;padding:4px 6px;border-radius:999px;box-shadow:0 1px 4px rgba(0,0,0,.3)">${label}</span>`
    : "";
  return L.divIcon({
    className: "",
    html: `<div style="position:relative;width:22px;height:22px">
      <span class="animate-pulse-ring" style="position:absolute;inset:0;border-radius:999px;background:${color};opacity:.45"></span>
      <span style="position:absolute;inset:3px;border-radius:999px;background:${color};border:3px solid #fff;box-shadow:0 1px 6px rgba(0,0,0,.4)"></span>
      ${tag}
    </div>`,
    iconSize: [22, 22],
    iconAnchor: [11, 11],
  });
}

export function LiveMarker({
  lat,
  lng,
  tone = "teal",
  label,
  title,
}: {
  lat: number;
  lng: number;
  tone?: "teal" | "amber" | "red";
  label?: string;
  title?: string;
}) {
  const icon = useMemo(() => dotIcon(tone, label), [tone, label]);
  return (
    <Marker position={[lat, lng]} icon={icon} keyboard={false} interactive={!!title} zIndexOffset={1000}>
      {title && <Tooltip direction="top" offset={[0, -14]}>{title}</Tooltip>}
    </Marker>
  );
}

type Run = { level: RouteSegment["level"]; coords: [number, number][] };
function runs(segments: RouteSegment[]): Run[] {
  const out: Run[] = [];
  for (const s of segments) {
    const last = out[out.length - 1];
    if (last && last.level === s.level) last.coords.push(...s.coords.slice(1));
    else out.push({ level: s.level, coords: [...s.coords] });
  }
  return out;
}

/** The trip's planned route: risk-coloured when the segments are known, otherwise brand purple. */
export function TripRouteLayer({ geometry, segments }: { geometry: [number, number][]; segments?: RouteSegment[] | null }) {
  const r = useMemo(() => (segments ? runs(segments) : null), [segments]);
  return <CasedRoute geometry={geometry} runs={r} />;
}

/** Where the person has actually walked (dotted). */
export function TrailLayer({ trail }: { trail: [number, number][] }) {
  if (trail.length < 2) return null;
  return <Polyline positions={trail} pathOptions={{ color: "#0f766e", weight: 4, opacity: 0.9, dashArray: "2 8", lineCap: "round" }} interactive={false} />;
}

/** Keep the map centred on a moving point until the user drags the map. */
export function FollowPosition({
  point,
  follow,
  onUserMove,
}: {
  point: { lat: number; lng: number } | null;
  follow: boolean;
  onUserMove: () => void;
}) {
  const map = useMap();
  const first = useRef(true);
  useMapEvents({ dragstart: onUserMove });
  useEffect(() => {
    if (!follow || !point) return;
    if (first.current) {
      map.setView([point.lat, point.lng], Math.max(map.getZoom(), 16), { animate: true });
      first.current = false;
    } else {
      map.panTo([point.lat, point.lng], { animate: true, duration: 0.8 });
    }
  }, [map, point?.lat, point?.lng, follow]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

/** Fit once to a set of points (when a trip starts / a watch page opens). */
export function FitOnce({ points, deps }: { points: [number, number][]; deps: unknown }) {
  const map = useMap();
  useEffect(() => {
    if (points.length < 2) return;
    map.fitBounds(L.latLngBounds(points), { padding: [50, 50], maxZoom: 16 });
  }, [map, deps]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

/** Recent incident reports, fading with age. Amber = caution (safety meaning). */
export function ReportMarkers({ reports }: { reports: IncidentReport[] }) {
  return (
    <>
      {reports.map((r) => (
        <CircleMarker
          key={r.id}
          center={[r.lat, r.lng]}
          radius={9}
          pathOptions={{ color: "#b45309", weight: 2, fillColor: "#f59e0b", fillOpacity: 0.25 + 0.5 * r.weight, opacity: 0.4 + 0.6 * r.weight }}
        >
          <Tooltip direction="top">
            {REPORT_LABEL[r.category]} · reported {Math.max(1, Math.round((Date.now() - new Date(r.created_at).getTime()) / 60000))} min ago
            {r.note ? ` · “${r.note}”` : ""}
          </Tooltip>
        </CircleMarker>
      ))}
    </>
  );
}

/** Map click handler for "pick a point" modes. */
export function MapClick({ onClick }: { onClick: (lat: number, lng: number) => void }) {
  useMapEvents({ click: (e) => onClick(e.latlng.lat, e.latlng.lng) });
  return null;
}
