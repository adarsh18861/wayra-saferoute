import { useId } from "react";
import { LEVEL_COLOR } from "../lib/risk";
import { bucketLabel } from "../lib/time";

type Props = {
  bucket: number;
  currentBucket: number;
  onBucket: (b: number) => void;
  loading: boolean;
  error: string | null;
  forecastMonth: string | null;
  onClose: () => void;
};

function monthLabel(ym: string | null): string | null {
  if (!ym) return null;
  const [y, m] = ym.split("-").map(Number);
  if (!y || !m) return null;
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

/** Time slider (12 two-hour windows), "Next 2 hours" jump and the heatmap legend. */
export default function HeatmapControls({ bucket, currentBucket, onBucket, loading, error, forecastMonth, onClose }: Props) {
  const id = useId();
  const next = (currentBucket + 1) % 12;
  const month = monthLabel(forecastMonth);
  return (
    <section aria-label="Risk heatmap" className="rounded-xl bg-white/95 p-3 text-slate-800 shadow-lg backdrop-blur">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-brand-purple">Risk heatmap</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Hide heatmap"
          className="rounded-md px-1.5 text-lg leading-none text-slate-500 hover:bg-slate-100 hover:text-slate-800"
        >
          ×
        </button>
      </div>
      <div className="mt-1 flex items-center justify-between gap-2">
        <label htmlFor={id} className="text-base font-bold tabular-nums text-slate-900">
          {bucketLabel(bucket)}
          {bucket === currentBucket && <span className="ml-1.5 align-middle text-[11px] font-semibold uppercase text-brand-teal-dark">now</span>}
        </label>
        <button
          type="button"
          onClick={() => onBucket(next)}
          aria-pressed={bucket === next}
          className={`shrink-0 rounded-full border px-2.5 py-1 text-xs font-semibold transition ${
            bucket === next
              ? "border-brand-teal-dark bg-brand-teal-dark text-white"
              : "border-brand-teal-dark text-brand-teal-dark hover:bg-brand-teal/10"
          }`}
        >
          Next 2 hours
        </button>
      </div>
      <input
        id={id}
        type="range"
        min={0}
        max={11}
        step={1}
        value={bucket}
        onChange={(e) => onBucket(Number(e.target.value))}
        aria-valuetext={bucketLabel(bucket)}
        className="mt-2 w-full accent-brand-purple"
      />
      <div aria-hidden className="flex justify-between text-[10px] text-slate-500">
        <span>12 AM</span>
        <span>6 AM</span>
        <span>12 PM</span>
        <span>6 PM</span>
        <span>12 AM</span>
      </div>
      <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-700" aria-label="Heatmap legend">
        {(
          [
            ["green", "Lower"],
            ["amber", "Moderate"],
            ["red", "Higher risk"],
          ] as const
        ).map(([l, t]) => (
          <li key={l} className="flex items-center gap-1.5">
            <span aria-hidden className="h-3 w-3 rounded-sm" style={{ background: LEVEL_COLOR[l], opacity: l === "green" ? 0.55 : 0.85 }} />
            {t}
          </li>
        ))}
      </ul>
      <p className="mt-1 text-[11px] leading-snug text-slate-600">
        Relative risk across Chicago from the AI model{month ? `, forecast for ${month}` : ""}. Uncoloured areas had too few
        past incidents to model.
      </p>
      {loading && (
        <p role="status" className="mt-1 text-xs text-brand-teal-dark">
          Loading heatmap…
        </p>
      )}
      {error && (
        <p role="alert" className="mt-1 text-xs text-red-700">
          {error}
        </p>
      )}
    </section>
  );
}
