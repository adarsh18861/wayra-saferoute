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
      {sel && <CasedRoute geometry={sel.geometry} runs={runs} />}
    </>
  );
}

/**
 * The selected route, drawn so it reads at every zoom and over any map colour: a dark halo, a white
 * casing, then the green/amber/red runs on top (or brand purple while risk colours are unknown).
 */
export function CasedRoute({ geometry, runs }: { geometry: [number, number][]; runs: Run[] | null }) {
  const round = { lineCap: "round", lineJoin: "round" } as const;
  return (
    <>
      <Polyline positions={geometry} pathOptions={{ color: "#1e1033", weight: 17, opacity: 0.35, ...round }} interactive={false} />
      <Polyline positions={geometry} pathOptions={{ color: "#ffffff", weight: 13, opacity: 1, ...round }} interactive={false} />
      {runs ? (
        runs.map((run, i) => (
          <Polyline key={i} positions={run.coords} pathOptions={{ color: LEVEL_COLOR[run.level], weight: 8, opacity: 1, ...round }} interactive={false} />
        ))
      ) : (
        <Polyline positions={geometry} pathOptions={{ color: "#3b1f6b", weight: 8, opacity: 0.9, ...round }} interactive={false} />
      )}
    </>
  );
}

/** Highlight of one street picked in the Directions list (drawn under the route). */
export function FocusedStreet({ coords }: { coords: [number, number][] | null }) {
  if (!coords || coords.length < 2) return null;
  return <Polyline positions={coords} pathOptions={{ color: "#7c3aed", weight: 26, opacity: 0.3, lineCap: "round", lineJoin: "round" }} interactive={false} />;
}

type Padding = () => { topLeft: [number, number]; bottomRight: [number, number] };

/** Fly to a street segment (Directions click), keeping it clear of the panel. */
export function FlyToCoords({ coords, nonce, padding }: { coords: [number, number][] | null; nonce: number; padding: Padding }) {
  const map = useMap();
  useEffect(() => {
    if (!coords || coords.length === 0) return;
    const p = padding();
    map.flyToBounds(L.latLngBounds(coords), { paddingTopLeft: p.topLeft, paddingBottomRight: p.bottomRight, maxZoom: 18, duration: 0.6 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, nonce]);
  return null;
}

/** Fit the map to the selected route, keeping it clear of the floating panels. */
export function FitToRoute({ route, padding, nonce = 0 }: { route: RouteOption | undefined; padding: Padding; nonce?: number }) {
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
    }, 120);
    return () => clearTimeout(t);
    // Refit when the selected route changes or on request (Fit route button, panel toggled), not when
    // the padding callback is recreated.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, route, nonce]);
  return null;
}
