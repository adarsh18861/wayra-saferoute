import L from "leaflet";
import { Fragment, useEffect, useMemo } from "react";
import { Polyline, Tooltip, useMap } from "react-leaflet";
import type { RiskLevel, RouteOption, RouteProfile, RouteResponse } from "../lib/api";
import { LEVEL_COLOR, OTHER_ROUTE_COLOR } from "../lib/risk";

type Run = { level: RiskLevel; coords: [number, number][] };

/** Merge consecutive same-level edges into one polyline each (fewer layers, no seams). */
export function mergeSegments(route: RouteOption): Run[] {
  const runs: Run[] = [];
  for (const s of route.segments) {
    const last = runs[runs.length - 1];
    if (last && last.level === s.level) last.coords.push(...s.coords.slice(1));
    else runs.push({ level: s.level, coords: [...s.coords] });
  }
  return runs;
}

type Props = {
  result: RouteResponse;
  selected: RouteProfile;
  onSelect: (p: RouteProfile) => void;
};

/** Selected route in green/amber/red segments; the others thin grey and clickable. */
export default function RouteLayer({ result, selected, onSelect }: Props) {
  const sel = result.routes.find((r) => r.profile === selected);
  const others = result.routes.filter((r) => r.profile !== selected && !(sel && r.identical_to.includes(sel.profile)));
  const runs = useMemo(() => (sel ? mergeSegments(sel) : []), [sel]);

  return (
    <>
      {others.map((r) => (
        <Fragment key={`other-${r.profile}`}>
          <Polyline
            positions={r.geometry}
            pathOptions={{ color: OTHER_ROUTE_COLOR, weight: 4, opacity: 0.75, dashArray: "1 7", lineCap: "round" }}
            interactive={false}
          />
          {/* Wide invisible hit area so the thin line is easy to click/tap. */}
          <Polyline
            positions={r.geometry}
            pathOptions={{ color: "#000", weight: 22, opacity: 0, className: "wayra-route-hit" }}
            eventHandlers={{ click: () => onSelect(r.profile) }}
          >
            <Tooltip sticky>
              {r.label}: safety {r.safety_score} · {Math.round(r.eta_min)} min — tap to select
            </Tooltip>
          </Polyline>
        </Fragment>
      ))}
      {sel && (
        <>
          <Polyline positions={sel.geometry} pathOptions={{ color: "#ffffff", weight: 11, opacity: 0.95 }} interactive={false} />
          <Polyline positions={sel.geometry} pathOptions={{ color: "#3b1f6b", weight: 9, opacity: 0.35 }} interactive={false} />
          {runs.map((run, i) => (
            <Polyline
              key={`${sel.profile}-${i}`}
              positions={run.coords}
              pathOptions={{ color: LEVEL_COLOR[run.level], weight: 6, opacity: 1, lineCap: "round", lineJoin: "round" }}
              interactive={false}
            />
          ))}
        </>
      )}
    </>
  );
}

/** Fit the map to the selected route, keeping it clear of the floating panels. */
export function FitToRoute({
  route,
  padding,
}: {
  route: RouteOption | undefined;
  padding: () => { topLeft: [number, number]; bottomRight: [number, number] };
}) {
  const map = useMap();
  useEffect(() => {
    if (!route || route.geometry.length < 2) return;
    // Wait a frame or two so the panel has its final size (on phones it folds after results arrive).
    const t = setTimeout(() => {
      const p = padding();
      map.flyToBounds(L.latLngBounds(route.geometry), {
        paddingTopLeft: p.topLeft,
        paddingBottomRight: p.bottomRight,
        duration: 0.6,
        maxZoom: 17,
      });
    }, 80);
    return () => clearTimeout(t);
    // Only refit when the selected route (geometry) changes, not when the padding callback is recreated.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, route]);
  return null;
}
