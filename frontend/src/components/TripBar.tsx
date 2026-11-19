import {
  Check,
  ChevronDown,
  Copy,
  Flag,
  Footprints,
  Hand,
  PhoneIncoming,
  Play,
  Route as RouteIcon,
  ShieldCheck,
  Shuffle,
  Square,
  Users,
} from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { trackLink } from "../lib/api";
import { km } from "../lib/geo";
import { useSafety, type DemoSpeed } from "../lib/safety";
import { VoiceToggle } from "./VoiceSOS";

const SPEEDS: DemoSpeed[] = [1, 5, 20];

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-soft">{label}</p>
      <p className="font-display text-2xl font-bold leading-tight text-ink tabular-nums">
        {value}
        {sub && <span className="ml-1 font-sans text-sm font-semibold text-ink-soft">{sub}</span>}
      </p>
    </div>
  );
}

/** Bottom card while a trip is active. */
export default function TripBar({ onReport }: { onReport: () => void }) {
  const s = useSafety();
  const { trip, progress, demo, socket, contacts } = s;
  // Expanded on desktop; collapsed on phones so the map stays visible (tap the header to expand).
  const [open, setOpen] = useState(() => typeof window === "undefined" || window.matchMedia("(min-width: 640px)").matches);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState<"end" | "safe" | null>(null);
  if (!trip || !progress) return null;

  const eta = Math.max(0, Math.round(progress.etaMin));
  const nContacts = contacts?.length ?? 0;
  const live = socket === "open";
  const status = !progress.onRoute
    ? { text: `Off route · ${Math.round(progress.offRouteM)} m`, cls: "bg-amber-100 text-amber-900 ring-amber-300" }
    : demo.on && demo.stopped
      ? { text: "Stopped", cls: "bg-amber-100 text-amber-900 ring-amber-300" }
      : { text: "On route", cls: "bg-emerald-50 text-emerald-800 ring-emerald-200" };

  async function copyLink() {
    if (!trip) return;
    try {
      await navigator.clipboard.writeText(trackLink(trip.share_token));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt("Copy this trip link", trackLink(trip.share_token));
    }
  }

  async function run(kind: "end" | "safe") {
    setBusy(kind);
    try {
      if (kind === "end") await s.endTrip();
      else await s.imSafe();
    } catch (e) {
      s.notify({ tone: "warn", title: "Couldn't reach the server", text: e instanceof Error ? e.message : undefined });
    } finally {
      setBusy(null);
    }
  }

  return (
    <section
      aria-label="Active trip"
      className="pointer-events-auto w-full overflow-hidden rounded-3xl bg-white/97 shadow-[var(--shadow-lift)] ring-1 ring-line backdrop-blur-xl"
    >
      {demo.on && (
        <div
          className="flex items-center justify-between gap-2 bg-gradient-to-r from-brand-800 to-brand-600 px-4 py-1.5 text-white"
          title="Demo trips use shorter alert timers: off route for 10 s (real: 30 s), stopped for 20 s (real: 3 min)."
        >
          <span className="whitespace-nowrap text-[11px] font-extrabold uppercase tracking-[0.16em]">Demo mode</span>
          <span className="truncate text-[11px] text-white/85">Simulated GPS · fast timers 10 s / 20 s</span>
        </div>
      )}

      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 px-4 pb-2 pt-3 text-left"
      >
        <span className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-brand-teal/15 text-brand-teal-dark">
          <Footprints className="h-5 w-5" aria-hidden />
          {live && <span className="absolute -right-0.5 -top-0.5 h-3 w-3 rounded-full bg-brand-teal ring-2 ring-white" aria-hidden />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-ink">
            {trip.to_name ? `To ${trip.to_name}` : "Trip in progress"}
          </span>
          <span className="block truncate text-xs text-ink-soft">
            {live ? "Live" : socket === "connecting" ? "Connecting…" : "Reconnecting…"} ·{" "}
            {nContacts ? `${nContacts} contact${nContacts > 1 ? "s" : ""} watching` : "no trusted contacts yet"} · {trip.profile} route
          </span>
        </span>
        <ChevronDown className={`h-4 w-4 shrink-0 text-ink-soft transition ${open ? "" : "rotate-180"}`} aria-hidden />
        <span className="sr-only">{open ? "Collapse trip panel" : "Expand trip panel"}</span>
      </button>

      <div className="grid grid-cols-[1fr_1fr_auto] items-end gap-3 px-4">
        <Stat label="ETA" value={String(eta)} sub="min" />
        <Stat label="Left" value={km(progress.remainingM)} />
        <span className={`mb-1 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ${status.cls}`} role="status">
          {status.text}
        </span>
      </div>
      <div className="mx-4 mt-2 h-1.5 overflow-hidden rounded-full bg-brand-50" aria-hidden>
        <div className="h-full rounded-full bg-brand-teal transition-[width] duration-700" style={{ width: `${Math.round(progress.done * 100)}%` }} />
      </div>

      <div className="grid grid-cols-2 gap-2 p-4 pb-3">
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => void run("safe")}
          className="inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-brand-teal font-semibold text-brand-950 shadow-[var(--shadow-glow)] transition hover:bg-brand-teal-light active:scale-[0.98] disabled:opacity-60"
        >
          <ShieldCheck className="h-5 w-5" aria-hidden /> I'm safe
        </button>
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => void run("end")}
          className="inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-white font-semibold text-brand-800 ring-1 ring-line transition hover:ring-brand-300 active:scale-[0.98] disabled:opacity-60"
        >
          <Square className="h-4 w-4" aria-hidden /> End trip
        </button>
      </div>

      {open && (
        <div className="space-y-3 border-t border-line px-4 py-3">
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => void copyLink()} className="inline-flex items-center gap-1.5 rounded-xl bg-white px-3 py-2 text-sm font-semibold text-ink ring-1 ring-line transition hover:ring-brand-300">
              {copied ? <Check className="h-4 w-4 text-emerald-700" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />}
              {copied ? "Link copied" : "Trip link"}
            </button>
            <button type="button" onClick={s.openFakeCallSetup} className="inline-flex items-center gap-1.5 rounded-xl bg-white px-3 py-2 text-sm font-semibold text-ink ring-1 ring-line transition hover:ring-brand-300">
              <PhoneIncoming className="h-4 w-4" aria-hidden /> Fake call
            </button>
            <button type="button" onClick={onReport} className="inline-flex items-center gap-1.5 rounded-xl bg-white px-3 py-2 text-sm font-semibold text-ink ring-1 ring-line transition hover:ring-brand-300">
              <Flag className="h-4 w-4" aria-hidden /> Report
            </button>
            <VoiceToggle compact />
            {nContacts === 0 && (
              <Link to="/contacts" className="inline-flex items-center gap-1.5 rounded-xl bg-brand-50 px-3 py-2 text-sm font-semibold text-brand-800 ring-1 ring-brand-200">
                <Users className="h-4 w-4" aria-hidden /> Add contacts
              </Link>
            )}
          </div>

          <div className="rounded-2xl bg-brand-50/70 p-3 ring-1 ring-brand-100">
            <div className="flex items-center justify-between gap-3">
              <span id="demo-label" className="text-sm font-semibold text-ink">
                Demo mode
                <span className="block text-xs font-normal text-ink-soft">Simulated walker instead of real GPS</span>
              </span>
              <button
                type="button"
                role="switch"
                aria-checked={demo.on}
                aria-labelledby="demo-label"
                onClick={() => void s.setDemoOn(!demo.on)}
                className={`relative h-7 w-12 shrink-0 rounded-full transition ${demo.on ? "bg-brand-700" : "bg-slate-300"}`}
              >
                <span className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-all ${demo.on ? "left-[1.375rem]" : "left-0.5"}`} />
              </button>
            </div>
            {demo.on && (
              <div className="mt-3 space-y-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-ink-soft">Speed</span>
                  <div role="radiogroup" aria-label="Walker speed" className="inline-flex rounded-xl bg-white p-0.5 ring-1 ring-brand-100">
                    {SPEEDS.map((sp) => (
                      <button
                        key={sp}
                        type="button"
                        role="radio"
                        aria-checked={demo.speed === sp}
                        onClick={() => s.setDemoSpeed(sp)}
                        className={`rounded-[10px] px-3 py-1 text-xs font-bold transition ${demo.speed === sp ? "bg-brand-800 text-white" : "text-ink-soft hover:text-brand-800"}`}
                      >
                        {sp}×
                      </button>
                    ))}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    aria-pressed={demo.deviating}
                    onClick={s.toggleDeviation}
                    className={`inline-flex h-10 items-center justify-center gap-1.5 rounded-xl text-sm font-semibold ring-1 transition ${
                      demo.deviating ? "bg-amber-100 text-amber-900 ring-amber-300" : "bg-white text-ink ring-line hover:ring-brand-300"
                    }`}
                  >
                    {demo.deviating ? <RouteIcon className="h-4 w-4" aria-hidden /> : <Shuffle className="h-4 w-4" aria-hidden />}
                    {demo.deviating ? "Back on route" : "Simulate deviation"}
                  </button>
                  <button
                    type="button"
                    aria-pressed={demo.stopped}
                    onClick={s.toggleStop}
                    className={`inline-flex h-10 items-center justify-center gap-1.5 rounded-xl text-sm font-semibold ring-1 transition ${
                      demo.stopped ? "bg-amber-100 text-amber-900 ring-amber-300" : "bg-white text-ink ring-line hover:ring-brand-300"
                    }`}
                  >
                    {demo.stopped ? <Play className="h-4 w-4" aria-hidden /> : <Hand className="h-4 w-4" aria-hidden />}
                    {demo.stopped ? "Resume walking" : "Simulate stop"}
                  </button>
                </div>
              </div>
            )}
            {!demo.on && s.locationError && <p className="mt-2 text-xs text-amber-800">{s.locationError}</p>}
          </div>
        </div>
      )}
    </section>
  );
}
