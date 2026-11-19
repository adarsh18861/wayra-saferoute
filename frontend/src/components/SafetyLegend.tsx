import { LEVEL_COLOR, LEVEL_LABEL, OTHER_ROUTE_COLOR } from "../lib/risk";
import InfoTip from "./InfoTip";

export function SafetyScoreExplainer() {
  return (
    <>
      <strong className="mb-1 block text-sm">What is the safety score?</strong>
      A 0–100 score for the whole route. Our AI risk model estimates risk for every Chicago street in each 2-hour
      window, learned from past street-crime reports (2022 onwards) plus lighting and activity estimates. The score
      compares this route's streets with <em>all streets in the city at all times of day</em>: 100 = among the
      lowest-risk, 0 = among the highest.
      <span className="mt-1.5 block text-white/80">
        It is relative, not a guarantee: past data can't predict any single walk.
      </span>
    </>
  );
}

/** Colour key for the selected route + "What is the safety score?" explainer. */
export default function SafetyLegend() {
  return (
    <div className="rounded-2xl bg-white/95 p-3 text-xs text-ink-soft shadow-[var(--shadow-lift)] ring-1 ring-line backdrop-blur-xl">
      <ul className="space-y-1" aria-label="Route colour legend">
        {(["green", "amber", "red"] as const).map((l) => (
          <li key={l} className="flex items-center gap-2">
            <span aria-hidden className="h-1.5 w-6 rounded-full" style={{ background: LEVEL_COLOR[l] }} />
            {LEVEL_LABEL[l]}
          </li>
        ))}
        <li className="flex items-center gap-2">
          <span aria-hidden className="h-0 w-6 border-t-[3px] border-dotted" style={{ borderColor: OTHER_ROUTE_COLOR }} />
          Other routes (tap to pick)
        </li>
      </ul>
      <div className="mt-2.5 border-t border-line pt-2.5">
        <InfoTip label="What is the safety score?">
          <SafetyScoreExplainer />
        </InfoTip>
      </div>
    </div>
  );
}
