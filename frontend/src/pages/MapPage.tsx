import L from "leaflet";
import { useEffect, useState } from "react";
import { MapContainer, Marker, Polyline, Popup, TileLayer, useMap } from "react-leaflet";
import { ROUTE_STYLE } from "../components/RouteCompare";
import SearchPanel from "../components/SearchPanel";
import type { Place, RouteResponse } from "../lib/api";

const CHICAGO_CENTER: [number, number] = [41.8781, -87.6298];

// Simple CSS pin icons (avoids Leaflet's default image icons, which break under Vite bundling).
function pin(color: string, letter: string): L.DivIcon {
  return L.divIcon({
    className: "",
    html: `<div style="background:${color};width:28px;height:28px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4);display:flex;align-items:center;justify-content:center"><span style="transform:rotate(45deg);color:#fff;font:600 12px system-ui">${letter}</span></div>`,
    iconSize: [28, 28],
    iconAnchor: [14, 28],
    popupAnchor: [0, -26],
  });
}
const FROM_ICON = pin("#0f766e", "A");
const TO_ICON = pin("#3b1f6b", "B");

/** Pan/zoom so the chosen places are in view. */
function FitToPlaces({ from, to }: { from: Place | null; to: Place | null }) {
  const map = useMap();
  useEffect(() => {
    const pts = [from, to].filter((p): p is Place => p !== null).map((p) => L.latLng(p.lat, p.lon));
    if (pts.length === 1) map.flyTo(pts[0], Math.max(map.getZoom(), 15), { duration: 0.6 });
    if (pts.length === 2) {
      map.flyToBounds(L.latLngBounds(pts), { paddingTopLeft: [40, 220], paddingBottomRight: [40, 40], duration: 0.6 });
    }
  }, [map, from, to]);
  return null;
}

/** Draw order: thin alternatives first so the bold Safest line sits on top. */
const DRAW_ORDER = ["fastest", "balanced", "safest"] as const;

/** Fit the map to the returned routes. */
function FitToRoutes({ result }: { result: RouteResponse | null }) {
  const map = useMap();
  useEffect(() => {
    if (!result) return;
    const pts = result.routes.flatMap((r) => r.geometry);
    if (pts.length > 1) {
      map.flyToBounds(L.latLngBounds(pts), { paddingTopLeft: [40, 340], paddingBottomRight: [40, 40], duration: 0.6 });
    }
  }, [map, result]);
  return null;
}

export default function MapPage() {
  const [from, setFrom] = useState<Place | null>(null);
  const [to, setTo] = useState<Place | null>(null);
  const [result, setResult] = useState<RouteResponse | null>(null);

  return (
    <>
      <MapContainer
        center={CHICAGO_CENTER}
        zoom={12}
        zoomControl={false}
        className="absolute inset-0 h-full w-full"
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {from && (
          <Marker position={[from.lat, from.lon]} icon={FROM_ICON}>
            <Popup>From: {from.name}</Popup>
          </Marker>
        )}
        {to && (
          <Marker position={[to.lat, to.lon]} icon={TO_ICON}>
            <Popup>To: {to.name}</Popup>
          </Marker>
        )}
        {result &&
          DRAW_ORDER.map((p) => {
            const r = result.routes.find((x) => x.profile === p);
            if (!r) return null;
            const s = ROUTE_STYLE[p];
            return (
              <Polyline
                key={p}
                positions={r.geometry}
                pathOptions={{ color: s.color, weight: s.weight, dashArray: s.dashArray, opacity: 0.9 }}
              >
                <Popup>
                  {r.label}: safety {r.safety_score}/100, {(r.distance_m / 1000).toFixed(1)} km,{" "}
                  {Math.round(r.eta_min)} min
                </Popup>
              </Polyline>
            );
          })}
        <FitToPlaces from={from} to={to} />
        <FitToRoutes result={result} />
      </MapContainer>
      <SearchPanel
        from={from}
        to={to}
        onFromChange={setFrom}
        onToChange={setTo}
        result={result}
        onResult={setResult}
      />
    </>
  );
}
