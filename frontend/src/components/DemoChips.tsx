import type { Place } from "../lib/api";

export type DemoTrip = { label: string; from: Place; to: Place };

/** Demo trips (same coordinates as backend/scripts/verify_routes.py). */
export const DEMO_TRIPS: DemoTrip[] = [
  {
    label: "Union Station → Navy Pier",
    from: { name: "Chicago Union Station", lat: 41.8786, lon: -87.6403 },
    to: { name: "Navy Pier", lat: 41.8917, lon: -87.6086 },
  },
  {
    label: "UChicago → 63rd St Green Line",
    from: { name: "University of Chicago", lat: 41.7886, lon: -87.5987 },
    to: { name: "Cottage Grove (63rd St) Green Line", lat: 41.7804, lon: -87.6162 },
  },
  {
    label: "Wrigley Field → Lincoln Park Zoo",
    from: { name: "Wrigley Field", lat: 41.9484, lon: -87.6553 },
    to: { name: "Lincoln Park Zoo", lat: 41.9211, lon: -87.634 },
  },
];

/** Quick-demo chips: fill From/To and search right away. */
export default function DemoChips({ onPick, disabled }: { onPick: (t: DemoTrip) => void; disabled?: boolean }) {
  return (
    <div>
      <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Try a demo trip</p>
      <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 sm:flex-wrap sm:overflow-visible">
        {DEMO_TRIPS.map((t) => (
          <button
            key={t.label}
            type="button"
            disabled={disabled}
            onClick={() => onPick(t)}
            className="shrink-0 rounded-full border border-brand-teal-dark/40 bg-brand-teal/10 px-3 py-1.5 text-xs font-medium text-brand-teal-dark transition hover:bg-brand-teal/20 disabled:opacity-50"
          >
            {t.label}
          </button>
        ))}
      </div>
    </div>
  );
}
