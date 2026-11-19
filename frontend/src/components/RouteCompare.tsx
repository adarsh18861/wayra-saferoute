import type { RouteOption, RouteResponse } from "../lib/api";

/** Line style per profile; shared with the map so cards and lines match. */
export const ROUTE_STYLE: Record<RouteOption["profile"], { color: string; weight: number; dashArray?: string }> = {
  safest: { color: "#3b1f6b", weight: 7 },
  balanced: { color: "#0f766e", weight: 4, dashArray: "8 8" },
  fastest: { color: "#64748b", weight: 3, dashArray: "4 8" },
};

function km(m: number): string {
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`;
}

function scoreClass(score: number): string {
  if (score >= 67) return "text-emerald-700";
  if (score >= 34) return "text-amber-700";
  return "text-red-700";
}

type Props = { result: RouteResponse };

/** Basic route cards (full styling comes in the next phase). */
export default function RouteCompare({ result }: Props) {
  const order = ["safest", "balanced", "fastest"] as const;
  const routes = order
    .map((p) => result.routes.find((r) => r.profile === p))
    .filter((r): r is RouteOption => r !== undefined);
  return (
    <div className="space-y-2">
      <p className="text-xs text-slate-600">
        {result.night_mode ? "🌙 Night-safe mode on" : "Daytime routing"}
        {result.night_mode_source === "override" ? " (manual)" : " (auto, after sunset)"}
        {" · "}lighting and crowd levels are estimates
      </p>
      <ul className="grid grid-cols-3 gap-2">
        {routes.map((r) => {
          const style = ROUTE_STYLE[r.profile];
          return (
            <li key={r.profile} className="rounded-lg border border-slate-200 p-2 text-center">
              <div className="flex items-center justify-center gap-1 text-xs font-semibold text-slate-700">
                <span
                  aria-hidden
                  className="inline-block h-1.5 w-4 rounded"
                  style={{ background: style.color }}
                />
                {r.label}
              </div>
              <div className={`text-xl font-bold ${scoreClass(r.safety_score)}`} title="Safety score (0–100)">
                {r.safety_score}
              </div>
              <div className="text-[11px] text-slate-600">
                {km(r.distance_m)} · {Math.round(r.eta_min)} min
              </div>
              {r.identical_to.length > 0 && (
                <div className="mt-0.5 text-[10px] text-slate-500">same as {r.identical_to.join(", ")}</div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
