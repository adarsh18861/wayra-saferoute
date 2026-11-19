import { Footprints, MapPin, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { createPortal } from "react-dom";
import Modal from "./ui/Modal";

type PermState = "granted" | "prompt" | "denied" | "unknown";

async function geoPermission(): Promise<PermState> {
  if (!("geolocation" in navigator)) return "denied";
  try {
    const st = await navigator.permissions?.query({ name: "geolocation" as PermissionName });
    return (st?.state as PermState | undefined) ?? "unknown";
  } catch {
    return "unknown";
  }
}

function readDemoDefault(): boolean {
  try {
    return localStorage.getItem("wayra.demoDefault") !== "0";
  } catch {
    return true;
  }
}

/**
 * Sticky footer of the route panel: one big "Start trip on <route>" button plus the demo-mode switch.
 * With real GPS, a short explainer comes first so the browser's permission prompt isn't a surprise.
 */
export default function StartTripBar({ label, onStart }: { label: string; onStart: (demo: boolean) => Promise<void> }) {
  const [demo, setDemo] = useState(readDemoDefault);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [explain, setExplain] = useState<PermState | null>(null);

  async function start(demoOn: boolean) {
    setExplain(null);
    setBusy(true);
    setErr(null);
    try {
      localStorage.setItem("wayra.demoDefault", demoOn ? "1" : "0");
    } catch {
      /* ignore */
    }
    try {
      await onStart(demoOn);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't start the trip.");
    } finally {
      setBusy(false);
    }
  }

  async function click() {
    if (demo) return start(true);
    const perm = await geoPermission();
    if (perm === "granted") return start(false);
    setExplain(perm);
  }

  return (
    <div className="shrink-0 border-t border-line bg-white/98 px-3.5 pb-3 pt-2.5 shadow-[0_-8px_20px_-12px_rgba(59,31,107,0.25)]">
      <button
        type="button"
        disabled={busy}
        onClick={() => void click()}
        className="inline-flex h-14 w-full items-center justify-center gap-2.5 rounded-2xl bg-brand-teal text-base font-bold text-brand-950 shadow-[var(--shadow-glow)] transition hover:-translate-y-px hover:bg-brand-teal-light active:translate-y-0 disabled:opacity-60"
      >
        <Footprints className="h-5 w-5" aria-hidden />
        {busy ? "Starting…" : `Start trip on ${label} route`}
      </button>
      <label className="mt-2 flex cursor-pointer items-center gap-2 text-xs text-ink-soft">
        <input type="checkbox" checked={demo} onChange={(e) => setDemo(e.target.checked)} className="h-4 w-4 accent-brand-700" />
        <span>
          <span className="font-semibold text-ink">Demo mode</span>: a simulated walker follows the route. Untick to use your real GPS.
        </span>
      </label>
      {err && <p className="mt-2 text-xs text-red-700">{err}</p>}

      {createPortal(
      <Modal open={explain !== null} onClose={() => setExplain(null)} title="Share your location for this trip?" icon={<MapPin className="h-5 w-5" aria-hidden />}>
        <div className="space-y-3 text-sm text-ink-soft">
          <p>WAYRA uses your location to follow the route, warn you if you drift off it, and show your trusted contacts where you are.</p>
          <p className="flex items-start gap-2 rounded-xl bg-brand-50 p-3 text-brand-900">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <span>
              Shared <strong>only during this trip or an SOS</strong>. When the trip ends, your contacts stop seeing it.
            </span>
          </p>
          {explain === "denied" ? (
            <p className="rounded-xl bg-amber-50 p-3 text-amber-900">
              Location is blocked for this site. The trip will start in <strong>DEMO MODE</strong> (a simulated walker). To use real GPS,
              allow location in the address bar's site settings.
            </p>
          ) : (
            <p>Your browser will ask next. If you're outside Chicago or say no, WAYRA switches to <strong>DEMO MODE</strong> automatically.</p>
          )}
        </div>
        <div className="mt-5 flex gap-2">
          <button
            type="button"
            onClick={() => void start(explain === "denied")}
            className="flex-1 rounded-xl bg-brand-800 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-700"
          >
            {explain === "denied" ? "Start in demo mode" : "Continue"}
          </button>
          <button
            type="button"
            onClick={() => {
              setDemo(true);
              void start(true);
            }}
            className={`flex-1 rounded-xl py-2.5 text-sm font-semibold text-brand-800 ring-1 ring-line transition hover:bg-brand-50 ${explain === "denied" ? "hidden" : ""}`}
          >
            Use demo mode
          </button>
        </div>
      </Modal>,
        document.body,
      )}
    </div>
  );
}
