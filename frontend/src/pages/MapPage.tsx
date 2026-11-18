import L from "leaflet";
import { useEffect, useState } from "react";
import { MapContainer, Marker, Popup, TileLayer, useMap } from "react-leaflet";
import SearchPanel from "../components/SearchPanel";
import type { Place } from "../lib/api";

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

export default function MapPage() {
  const [from, setFrom] = useState<Place | null>(null);
  const [to, setTo] = useState<Place | null>(null);

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
        <FitToPlaces from={from} to={to} />
      </MapContainer>
      <SearchPanel from={from} to={to} onFromChange={setFrom} onToChange={setTo} />
    </>
  );
}
