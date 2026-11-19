import { CircleCheck, Clock3, History, MapPin, Mic, Radio, WifiOff } from "lucide-react";
import { useEffect, useState } from "react";
import { myAlerts, osmLink, sosHistory, type Alert, type SOSRecord } from "../lib/api";
import { useSafety } from "../lib/safety";

const fmt = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

function duration(s: number): string {
  if (s < 60) return `${Math.round(s)} s`;
  const m = Math.round(s / 60);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
}

const SOURCE = {
  button: { icon: Radio, label: "SOS button" },
  voice: { icon: Mic, label: "Voice SOS" },
  offline: { icon: WifiOff, label: "Offline SMS" },
} as const;

const KIND_LABEL: Partial<Record<Alert["kind"], string>> = {
  off_route: "Off route",
  stopped: "Stopped too long",
  arrived: "Arrived safely",
  safe: "I'm safe",
  trip_started: "Trip started",
  trip_ended: "Trip ended",
  sos_resolved: "SOS closed",
};

function SOSItem({ s }: { s: SOSRecord }) {
  const src = SOURCE[(s.source as keyof typeof SOURCE) ?? "button"] ?? SOURCE.button;
  const Icon = src.icon;
  const open = !s.resolved_at;
  return (
    <li className="rounded-3xl bg-white p-4 shadow-[var(--shadow-card)] ring-1 ring-line sm:p-5">
      <div className="flex flex-wrap items-center gap-2">
        <span className={`flex h-10 w-10 items-center justify-center rounded-2xl ${open ? "bg-red-600 text-white" : "bg-red-50 text-red-700"}`}>
          <Icon className="h-5 w-5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-ink">{fmt(s.created_at)}</p>
          <p className="text-sm text-ink-soft">{src.label}</p>
        </div>
        {open ? (
          <span className="rounded-full bg-red-600 px-2.5 py-1 text-xs font-bold text-white">Active</span>
        ) : (
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-800 ring-1 ring-emerald-200">
            <CircleCheck className="h-3.5 w-3.5" aria-hidden /> Resolved{s.duration_s != null ? ` after ${duration(s.duration_s)}` : ""}
          </span>
        )}
      </div>
      {s.lat != null && s.lng != null && (
        <a
          href={osmLink(s.lat, s.lng)}
          target="_blank"
          rel="noreferrer"
          className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-brand-teal-dark underline-offset-2 hover:underline"
        >
          <MapPin className="h-4 w-4" aria-hidden /> {s.lat.toFixed(5)}, {s.lng.toFixed(5)}
        </a>
      )}
      {s.deliveries.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-1.5" aria-label="Delivery log">
          {s.deliveries.map((d, i) => (
            <li
              key={i}
              title={d.detail ?? undefined}
              className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-2.5 py-1 text-xs font-medium text-brand-900 ring-1 ring-brand-100"
            >
              {d.status === "live" || d.status === "sent" ? (
                <CircleCheck className="h-3.5 w-3.5 text-emerald-700" aria-hidden />
              ) : (
                <Clock3 className="h-3.5 w-3.5 text-ink-soft" aria-hidden />
              )}
              {d.contact_name} · {d.channel === "in_app" ? "watch link" : d.channel} · {d.status}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

export default function SOSHistoryPage() {
  const { sos } = useSafety();
  const [items, setItems] = useState<SOSRecord[] | null>(null);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    sosHistory()
      .then(setItems)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Couldn't load the SOS log."));
    myAlerts()
      .then((a) => setAlerts(a.filter((x) => x.kind !== "sos")))
      .catch(() => {});
  }, [sos.phase]);

  return (
    <div className="mx-auto max-w-3xl px-4 pb-32 pt-6 sm:px-6 sm:pt-10">
      <p className="text-sm font-semibold text-brand-teal-dark">SOS log</p>
      <h1 className="mt-1 text-3xl font-bold text-ink sm:text-4xl">SOS history</h1>
      <p className="mt-2 max-w-xl text-ink-soft">
        Every SOS you've sent, who it reached and how it ended. Police are never contacted automatically: the “authorities” entry
        is a log line, and calling 911 is always your choice.
      </p>

      {error && <p className="mt-6 rounded-2xl bg-red-50 p-4 text-sm text-red-800">{error}</p>}
      {items === null && !error && (
        <div className="mt-6 space-y-3" role="status" aria-label="Loading">
          {[0, 1].map((i) => (
            <div key={i} className="h-32 animate-pulse rounded-3xl bg-white/70 ring-1 ring-line" />
          ))}
        </div>
      )}
      {items?.length === 0 && (
        <div className="mt-6 rounded-3xl border-2 border-dashed border-brand-200 bg-white/60 p-8 text-center">
          <History className="mx-auto h-8 w-8 text-brand-400" aria-hidden />
          <p className="mt-3 font-semibold text-ink">No SOS sent yet</p>
          <p className="mt-1 text-sm text-ink-soft">The red SOS button is always in the bottom-right corner.</p>
        </div>
      )}
      {items && items.length > 0 && (
        <ul className="mt-6 space-y-3">
          {items.map((s) => (
            <SOSItem key={s.id} s={s} />
          ))}
        </ul>
      )}

      {alerts.length > 0 && (
        <section className="mt-10">
          <h2 className="text-xl font-bold text-ink">Other messages to your contacts</h2>
          <ul className="mt-3 divide-y divide-line overflow-hidden rounded-2xl bg-white ring-1 ring-line">
            {alerts.slice(0, 20).map((a) => (
              <li key={a.id} className="flex items-start gap-3 px-4 py-3 text-sm">
                <span className="w-32 shrink-0 font-semibold text-ink">{KIND_LABEL[a.kind] ?? a.kind}</span>
                <span className="min-w-0 flex-1 text-ink-soft">{a.message}</span>
                <span className="hidden shrink-0 text-xs text-ink-soft sm:inline">{fmt(a.created_at)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
