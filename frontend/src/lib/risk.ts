import type { RiskLevel } from "./api";

/** Map line / fill colours per risk level (paired with text labels everywhere they appear). */
export const LEVEL_COLOR: Record<RiskLevel, string> = {
  green: "#16a34a",
  amber: "#f59e0b",
  red: "#dc2626",
};

export const LEVEL_LABEL: Record<RiskLevel, string> = {
  green: "Lower risk",
  amber: "Moderate risk",
  red: "Higher risk",
};

/** Same thresholds as the backend (rel_risk < 0.33 green, < 0.66 amber). */
export function levelOf(rel: number): RiskLevel {
  return rel < 0.33 ? "green" : rel < 0.66 ? "amber" : "red";
}

/** Score 0..100 = 100·(1 − mean rel_risk), so the same thresholds apply in reverse. */
export function scoreLevel(score: number): RiskLevel {
  return levelOf(1 - score / 100);
}

/** Badge background with white text; all ≥ 4.5:1 contrast. */
export const SCORE_BADGE: Record<RiskLevel, string> = {
  green: "bg-emerald-700",
  amber: "bg-amber-700",
  red: "bg-red-700",
};

export const OTHER_ROUTE_COLOR = "#64748b";
