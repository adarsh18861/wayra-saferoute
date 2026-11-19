import { ChevronDown, ListOrdered } from "lucide-react";
import { useMemo, useState } from "react";
import type { RouteOption } from "../lib/api";
import { LEVEL_COLOR, LEVEL_LABEL } from "../lib/risk";
import { directionRows } from "../lib/routeStats";
import { km } from "./RouteCompare";

type Props = {
  route: RouteOption;
  /** Zoom the map to one street of the route. */
  onFocus: (coords: [number, number][], index: number) => void;
  focused: number | null;
  defaultOpen?: boolean;
};

/** Street-by-street list for the selected route; each row is coloured by its risk and zooms the map on click. */
export default function Directions({ route, onFocus, focused, defaultOpen = true }: Props) {
  const rows = useMemo(() => directionRows(route.segments), [route]);
  const [open, setOpen] = useState(defaultOpen);
  if (!rows) {
    return (
      <p className="text-[11px] text-ink-soft">Street names aren't loaded on the server yet (run `npm run score` to enable directions).</p>
    );
  }
  return (
    <section aria-label="Directions" className="rounded-2xl ring-1 ring-line">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-3 py-2.5 text-left transition hover:bg-brand-50/60"
      >
        <ListOrdered className="h-4 w-4 shrink-0 text-brand-700" aria-hidden />
        <span className="flex-1 text-sm">
          <span className="font-semibold text-ink">Directions</span>{" "}
          <span className="text-ink-soft">
            · {rows.length} {rows.length === 1 ? "street" : "streets"} on {route.label}
          </span>
        </span>
        <ChevronDown aria-hidden className={`h-4 w-4 shrink-0 text-ink-soft transition ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <ol className="max-h-72 overflow-y-auto border-t border-line px-1.5 py-1.5">
          {rows.map((r, i) => (
            <li key={`${i}-${r.name}`}>
              <button
                type="button"
                onClick={() => onFocus(r.coords, i)}
                aria-current={focused === i ? "true" : undefined}
                title={`${LEVEL_LABEL[r.level]} · tap to zoom the map to this street`}
                className={`flex w-full items-center gap-2.5 rounded-xl px-2 py-1.5 text-left transition hover:bg-brand-50 ${
                  focused === i ? "bg-brand-50 ring-1 ring-brand-300" : ""
                }`}
              >
                <span className="w-5 shrink-0 text-right text-[11px] font-semibold tabular-nums text-ink-soft">{i + 1}</span>
                <span aria-hidden className="h-7 w-1.5 shrink-0 rounded-full" style={{ background: LEVEL_COLOR[r.level] }} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-semibold text-ink">{r.name}</span>
                  <span className="block text-[11px] text-ink-soft">{LEVEL_LABEL[r.level]}</span>
                </span>
                <span className="shrink-0 text-xs font-semibold tabular-nums text-ink">{km(r.length_m)}</span>
              </button>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
