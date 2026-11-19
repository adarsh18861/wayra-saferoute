import type { RiskLevel, RouteOption, RouteResponse, RouteSegment } from "./api";
import { levelOf } from "./risk";

/** Length-weighted mean relative risk of a route (the quantity behind the safety score). */
export function meanRisk(route: RouteOption): number {
  let len = 0;
  let acc = 0;
  for (const s of route.segments) {
    len += s.length_m;
    acc += s.length_m * s.rel_risk;
  }
  return len > 0 ? acc / len : 1 - route.safety_score / 100;
}

export type RiskComparison = {
  /** e.g. "−67% risk vs Fastest" */
  pctText: string;
  /** e.g. "3× less risk than Fastest" (only when at least 1.5× lower) */
  ratioText: string | null;
  /** Short card text, e.g. "−67% risk" */
  short: string;
  better: boolean;
};

function fmtRatio(r: number): string {
  return r >= 10 ? Math.round(r).toString() : (Math.round(r * 10) / 10).toString().replace(/\.0$/, "");
}

/**
 * How this route's risk compares with Fastest's. Scores are relative to all Chicago streets at all
 * hours, so at night every route scores lower; the comparison between routes stays meaningful.
 */
export function compareToFastest(route: RouteOption, result: RouteResponse): RiskComparison | null {
  const fastest = result.routes.find((r) => r.profile === "fastest");
  if (!fastest || route.profile === "fastest" || route.identical_to.includes("fastest")) return null;
  const a = meanRisk(route);
  const f = meanRisk(fastest);
  if (f <= 0) return null;
  const pct = Math.round(((a - f) / f) * 100);
  if (pct === 0) return { pctText: "Same risk as Fastest", ratioText: null, short: "≈ same risk", better: false };
  const sign = pct < 0 ? "−" : "+";
  const ratio = a > 0 ? f / a : Infinity;
  return {
    pctText: `${sign}${Math.abs(pct)}% risk vs Fastest`,
    ratioText: pct < 0 && ratio >= 1.5 ? `${Number.isFinite(ratio) ? fmtRatio(ratio) : "Far"}× less risk than Fastest` : null,
    short: `${sign}${Math.abs(pct)}% risk`,
    better: pct < 0,
  };
}

// ---------------------------------------------------------------- directions
/** Backend labels for unnamed ways (router_engine.UNNAMED_LABELS); short ones get folded into neighbours. */
const GENERIC = new Set([
  "Footpath", "Pedestrian walkway", "Path", "Steps", "Service road / alley", "Cycle path", "Track",
  "Indoor corridor", "Living street", "Residential street", "Unnamed path",
]);
const FOLD_SHORT_M = 30;

export type DirectionRow = {
  name: string;
  length_m: number;
  risk: number;
  level: RiskLevel;
  coords: [number, number][];
};

type Acc = { name: string; length_m: number; riskLen: number; coords: [number, number][] };

function push(rows: Acc[], name: string, s: { length_m: number; riskLen: number; coords: [number, number][] }) {
  const last = rows[rows.length - 1];
  if (last && last.name === name) {
    last.length_m += s.length_m;
    last.riskLen += s.riskLen;
    last.coords.push(...s.coords.slice(1));
  } else rows.push({ name, length_m: s.length_m, riskLen: s.riskLen, coords: [...s.coords] });
}

/**
 * Street-by-street list: consecutive edges with the same name merge into one row; short unnamed
 * bits (< 30 m, e.g. crossings) fold into the street before them. Null without name data.
 */
export function directionRows(segments: RouteSegment[]): DirectionRow[] | null {
  if (!segments.length || segments.some((s) => s.name === undefined)) return null;
  const raw: Acc[] = [];
  for (const s of segments) push(raw, s.name ?? "", { length_m: s.length_m, riskLen: s.length_m * s.rel_risk, coords: s.coords });
  const rows: Acc[] = [];
  raw.forEach((r, i) => {
    const short = GENERIC.has(r.name) && r.length_m < FOLD_SHORT_M;
    const target = short ? (rows.length ? rows[rows.length - 1].name : raw[i + 1]?.name ?? r.name) : r.name;
    push(rows, target, r);
  });
  return rows.map((r) => {
    const risk = r.length_m > 0 ? r.riskLen / r.length_m : 0;
    return { name: r.name, length_m: r.length_m, risk, level: levelOf(risk), coords: r.coords };
  });
}
