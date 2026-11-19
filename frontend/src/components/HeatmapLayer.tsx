import L from "leaflet";
import { useMemo } from "react";
import { GeoJSON } from "react-leaflet";
import type { Heatmap } from "../lib/api";
import { LEVEL_COLOR, levelOf } from "../lib/risk";

const FILL_OPACITY = { green: 0.12, amber: 0.26, red: 0.38 } as const;

/** H3 cells coloured by relative risk. Canvas + non-interactive so 6k polygons stay fast and never block panning. */
export default function HeatmapLayer({ data }: { data: Heatmap }) {
  const renderer = useMemo(() => L.canvas({ padding: 0.3 }), []);
  return (
    <GeoJSON
      key={data.bucket}
      data={data as unknown as GeoJSON.FeatureCollection}
      interactive={false}
      style={(f) => {
        const lvl = levelOf((f?.properties as { rel_risk?: number } | undefined)?.rel_risk ?? 0);
        return { renderer, stroke: false, fillColor: LEVEL_COLOR[lvl], fillOpacity: FILL_OPACITY[lvl], interactive: false };
      }}
    />
  );
}
