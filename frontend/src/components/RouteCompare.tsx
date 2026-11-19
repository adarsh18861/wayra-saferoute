import { useRef } from "react";
import type { RouteOption, RouteProfile, RouteResponse } from "../lib/api";
import { LEVEL_COLOR, LEVEL_LABEL, SCORE_BADGE, scoreLevel } from "../lib/risk";

export const PROFILE_ORDER: RouteProfile[] = ["safest", "balanced", "fastest"];

export function km(m: number): string {
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`;
}

export function orderedRoutes(result: RouteResponse): RouteOption[] {
  return PROFILE_ORDER.map((p) => result.routes.find((r) => r.profile === p)).filter(
    (r): r is RouteOption => r !== undefined,
  );
}

function signed(n: number, unit: string): string {
  return `${n > 0 ? "+" : n < 0 ? "−" : "±"}${Math.abs(n)}${unit}`;
}

/** Tiny green/amber/red proportion bar (share of the route's metres), with 2px gaps. */
export function RiskBar({ route, className = "" }: { route: RouteOption; className?: string }) {
  const total = route.risk_m.green + route.risk_m.amber + route.risk_m.red || 1;
  const pct = (["green", "amber", "red"] as const).map((l) => ({ l, p: (100 * route.risk_m[l]) / total }));
  const text = pct.map(({ l, p }) => `${Math.round(p)}% ${LEVEL_LABEL[l].toLowerCase()}`).join(", ");
  return (
    <div className={`flex h-1.5 w-full gap-[2px] overflow-hidden rounded-full ${className}`} role="img" aria-label={text} title={text}>
      {pct.map(({ l, p }) =>
        p > 0 ? <span key={l} className="h-full first:rounded-l-full last:rounded-r-full" style={{ width: `${p}%`, background: LEVEL_COLOR[l] }} /> : null,
      )}
    </div>
  );
}

type Props = {
  result: RouteResponse;
  selected: RouteProfile;
  onSelect: (p: RouteProfile) => void;
};

/** Safest / Balanced / Fastest cards. A radio group: click/tap, or arrow keys when focused. */
export default function RouteCompare({ result, selected, onSelect }: Props) {
  const routes = orderedRoutes(result);
  const fastest = result.routes.find((r) => r.profile === "fastest");
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  function onKeyDown(e: React.KeyboardEvent, i: number) {
    const step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const j = (i + step + routes.length) % routes.length;
    onSelect(routes[j].profile);
    refs.current[j]?.focus();
  }

  return (
    <div role="radiogroup" aria-label="Route options" className="grid grid-cols-3 gap-2 pt-2">
      {routes.map((r, i) => {
        const active = r.profile === selected;
        const lvl = scoreLevel(r.safety_score);
        let note: string;
        if (r.profile === "fastest") note = "Quickest";
        else if (fastest && r.identical_to.includes("fastest")) note = "Same as Fastest";
        else if (fastest) {
          const dMin = Math.round(r.eta_min - fastest.eta_min);
          const dScore = r.safety_score - fastest.safety_score;
          note = `${signed(dMin, " min")}, ${signed(dScore, " safety")}`;
        } else note = "";
        return (
          <button
            key={r.profile}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onSelect(r.profile)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={`group relative flex min-w-0 flex-col items-stretch gap-1.5 rounded-xl border-2 p-2 text-left transition focus:outline-none focus-visible:ring-4 focus-visible:ring-brand-teal/40 ${
              active
                ? "border-brand-purple bg-brand-purple/[0.06] shadow-sm"
                : "border-slate-200 bg-white hover:border-brand-purple/40 hover:bg-slate-50"
            }`}
          >
            {r.profile === "safest" && (
              <span className="absolute -top-2.5 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-brand-teal-dark px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-white shadow-sm">
                Recommended
              </span>
            )}
            <span className={`mt-0.5 text-sm font-semibold ${active ? "text-brand-purple" : "text-slate-800"}`}>{r.label}</span>
            <span className="flex items-center gap-1.5">
              <span
                className={`flex h-8 min-w-8 shrink-0 items-center justify-center rounded-full px-1 text-sm font-bold text-white ${SCORE_BADGE[lvl]}`}
                aria-label={`Safety score ${r.safety_score} out of 100`}
                title="Safety score (0–100, higher is safer)"
              >
                {r.safety_score}
              </span>
              <span aria-hidden className="text-[11px] leading-tight text-slate-600">
                safety
              </span>
            </span>
            <span className="text-xs text-slate-700">
              <span className="font-semibold text-slate-900">{Math.round(r.eta_min)} min</span> · {km(r.distance_m)}
            </span>
            <RiskBar route={r} />
            <span className="text-[11px] leading-tight text-slate-600">
              {note}
            </span>
          </button>
        );
      })}
    </div>
  );
}
