import { MapContainer, TileLayer } from "react-leaflet";

const CHICAGO_CENTER: [number, number] = [41.8781, -87.6298];

export default function MapPage() {
  return (
    <MapContainer center={CHICAGO_CENTER} zoom={13} className="absolute inset-0 h-full w-full">
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
    </MapContainer>
  );
}
