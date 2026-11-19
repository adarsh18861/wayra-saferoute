import L from "leaflet";
import {
  Bell,
  BellRing,
  CircleCheck,
  Flag,
  Footprints,
  Hand,
  LocateFixed,
  MapPin,
  Phone,
  Route as RouteIcon,
  ShieldAlert,
  ShieldCheck,
  Siren,
  Square,
  type LucideIcon,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MapContainer, Marker, TileLayer, ZoomControl } from "react-leaflet";
import { Link } from "react-router";
import { useWebSocket } from "../hooks/useWebSocket";
import { ApiError, osmLink, wsUrl, type Alert, type AlertKind, type LiveSnapshot, type Trip } from "../lib/api";
import { km } from "../lib/geo";
import { audioUnlocked, playChime, playSiren, unlockAudio } from "../lib/sound";
import { FitOnce, FollowPosition, LiveMarker, TrailLayer, TripRouteLayer } from "./LiveLayers";
import Logo from "./ui/Logo";

const CHICAGO: [number, number] = [41.8781, -87.6298];
const DEST_ICON = L.divIcon({
  className: "",
  html: `<div style="background:#3b1f6b;width:28px;height:28px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4);display:flex;align-items:center;justify-content:center"><span style="transform:rotate(45deg);color:#fff;font:700 11px system-ui">B</span></div>`,
  iconSize: [28, 28],
  iconAnchor: [14, 28],
});

const KIND: Record<AlertKind, { icon: LucideIcon; label: string; cls: string }> = {
  sos: { icon: Siren, label: "SOS", cls: "bg-red-600 text-white" },
  sos_resolved: { icon: ShieldCheck, label: "Safe now", cls: "bg-emerald-50 text-emerald-700" },
  off_route: { icon: RouteIcon, label: "Off route", cls: "bg-amber-100 text-amber-800" },
  stopped: { icon: Hand, label: "Stopped", cls: "bg-amber-100 text-amber-800" },
  arrived: { icon: Flag, label: "Arrived", cls: "bg-emerald-50 text-emerald-700" },
  safe: { icon: ShieldCheck, label: "I'm safe", cls: "bg-emerald-50 text-emerald-700" },
  trip_started: { icon: Footprints, label: "Trip started", cls: "bg-brand-50 text-brand-700" },
  trip_ended: { icon: Square, label: "Trip ended", cls: "bg-brand-50 text-brand-700" },
};

function ago(iso: string | null, now: number): string {
  if (!iso) return "";
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 5) return "just now";
  if (s < 60) return `${s} s ago`;
  const m = Math.round(s / 60);
  return m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`;
}

function notifySystem(title: string, body: string, urgent: boolean) {
  try {
    if ("Notification" in window && Notification.permission === "granted") {
      new Notification(title, { body, tag: urgent ? "wayra-sos" : undefined, requireInteraction: urgent });
    }
  } catch {
    /* some mobile browsers only allow notifications from a service worker */
  }
}

type Props = {
  kind: "watch" | "track";
  token: string;
  load: (token: string) => Promise<LiveSnapshot>;
};

/** Public live page for a trusted contact (/watch/:token) or a one-off trip link (/track/:token). */
export default function LiveViewer({ kind, token, load }: Props) {
  const [snap, setSnap] = useState<LiveSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState<string | null>(null);
  const [follow, setFollow] = useState(true);
  const [now, setNow] = useState(Date.now());
  const [alertsOn, setAlertsOn] = useState(false);
  const [flash, setFlash] = useState<Alert | null>(null);
  const nameRef = useRef("They");
  nameRef.current = snap?.user.first_name ?? "They";

  useEffect(() => {
    load(token)
      .then(setSnap)
      .catch((e: unknown) =>
        setError(e instanceof ApiError && e.status === 404 ? "This link isn't valid any more. Ask for a new one." : "Can't reach WAYRA right now. We'll keep trying."),
      );
  }, [load, token]);

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const onMessage = useCallback((msg: Record<string, unknown>) => {
    const name = nameRef.current;
    switch (msg.type) {
      case "snapshot": {
        const { type: _t, ...rest } = msg;
        void _t;
        setSnap(rest as unknown as LiveSnapshot);
        setError(null);
        break;
      }
      case "loc":
        setSnap((s) => {
          if (!s) return s;
          const p = { lat: Number(msg.lat), lng: Number(msg.lng), t: String(msg.t), sim: Boolean(msg.sim) };
          const progress =
            msg.remaining_m !== undefined
              ? { remaining_m: Number(msg.remaining_m), off_route_m: Number(msg.off_route_m), on_route: Boolean(msg.on_route), eta_min: Number(msg.eta_min) }
              : s.progress;
          return { ...s, last: p, trail: [...s.trail.slice(-799), [p.lat, p.lng]], progress };
        });
        break;
      case "trip": {
        const t = msg.trip as Trip;
        setSnap((s) => {
          if (!s) return s;
          if (t.status === "active") {
            const fresh = s.trip?.id !== t.id;
            return { ...s, trip: t, trail: fresh ? [] : s.trail, progress: fresh ? null : s.progress };
          }
          // Ended: a contact's page stops showing the location (unless an SOS is open); a trip link shows the ending.
          if (s.kind === "track") return { ...s, trip: t, last: null, trail: [], progress: null };
          return s.trip?.id === t.id ? { ...s, trip: null, progress: null, last: s.sos ? s.last : null, trail: s.sos ? s.trail : [] } : s;
        });
        setChecking(null);
        break;
      }
      case "check":
        setChecking(String(msg.reason));
        break;
      case "check_cleared":
        setChecking(null);
        break;
      case "alert": {
        const a = msg.alert as Alert;
        setSnap((s) => {
          if (!s || s.alerts.some((x) => x.id === a.id)) return s;
          const sos = a.kind === "sos" ? a : a.kind === "sos_resolved" ? null : s.sos;
          const keepLoc = a.kind !== "sos_resolved" || !!s.trip;
          return { ...s, alerts: [a, ...s.alerts].slice(0, 50), sos, last: keepLoc ? s.last : null, trail: keepLoc ? s.trail : [] };
        });
        if (a.kind === "off_route" || a.kind === "stopped") setChecking(null);
        const urgent = a.kind === "sos";
        if (urgent) playSiren(4);
        else if (a.kind !== "trip_ended") playChime();
        if (["sos", "off_route", "stopped", "arrived", "safe", "sos_resolved"].includes(a.kind)) {
          setFlash(a);
          window.setTimeout(() => setFlash((f) => (f?.id === a.id ? null : f)), 9000);
        }
        notifySystem(urgent ? `SOS from ${name}` : `WAYRA · ${name}`, a.message, urgent);
        break;
      }
    }
  }, []);

  const path = kind === "watch" ? `/api/ws/watch/${encodeURIComponent(token)}` : `/api/ws/track/${encodeURIComponent(token)}`;
  const { state, fatal } = useWebSocket(error && !snap ? null : wsUrl(path), onMessage);
  useEffect(() => {
    if (fatal === 4404) setError("This link isn't valid any more. Ask for a new one.");
  }, [fatal]);

  // Title shows the SOS so a background tab is noticeable.
  useEffect(() => {
    const name = snap?.user.first_name;
    document.title = snap?.sos ? `🚨 SOS · ${name} · WAYRA` : name ? `${kind === "watch" ? "Watching" : "Following"} ${name} · WAYRA` : "WAYRA";
    return () => {
      document.title = "WAYRA – SafeRoute";
    };
  }, [snap?.sos, snap?.user.first_name, kind]);

  async function enableAlerts() {
    unlockAudio();
    playChime();
    try {
      if ("Notification" in window && Notification.permission === "default") await Notification.requestPermission();
    } catch {
      /* ignore */
    }
    setAlertsOn(true);
  }

  const trip = snap?.trip ?? null;
  const active = trip?.status === "active";
  const name = snap?.user.first_name ?? "";
  const last = snap?.last ?? null;
  const progress = snap?.progress ?? null;
  const offRoute = progress ? !progress.on_route : false;
  const points = useMemo<[number, number][]>(() => trip?.geometry ?? (last ? [[last.lat, last.lng]] : []), [trip, last]);
  const notifPerm = typeof Notification !== "undefined" ? Notification.permission : "unsupported";
  const soundReady = alertsOn || audioUnlocked();

  if (error && !snap) {
    return (
      <div className="flex min-h-full flex-col items-center justify-center gap-6 bg-canvas px-4 text-center">
        <Logo />
        <div className="max-w-md rounded-3xl bg-white p-8 shadow-[var(--shadow-card)] ring-1 ring-line">
          <ShieldAlert className="mx-auto h-10 w-10 text-brand-600" aria-hidden />
          <h1 className="mt-3 text-2xl font-bold text-ink">Link not available</h1>
          <p className="mt-2 text-sm text-ink-soft">{error}</p>
          <Link to="/" className="mt-6 inline-flex h-11 items-center rounded-xl bg-brand-800 px-5 text-sm font-semibold text-white hover:bg-brand-700">
            About WAYRA
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-canvas">
      <header className="relative z-[1100] flex h-14 shrink-0 items-center justify-between gap-3 border-b border-line bg-white/95 px-3 backdrop-blur sm:h-16 sm:px-5">
        <Link to="/" aria-label="WAYRA home" className="shrink-0">
          <Logo sub={kind === "watch" ? "Trusted-contact view" : "Shared trip"} />
        </Link>
        <span
          className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ${
            state === "open" ? "bg-emerald-50 text-emerald-800 ring-emerald-200" : "bg-amber-50 text-amber-900 ring-amber-200"
          }`}
          role="status"
        >
          <span className={`h-2 w-2 rounded-full ${state === "open" ? "bg-emerald-600" : "animate-pulse bg-amber-500"}`} aria-hidden />
          {state === "open" ? "Live" : "Reconnecting…"}
        </span>
      </header>

      <AnimatePresence>
        {snap?.sos && (
          <motion.div
            role="alert"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="relative z-[1050] shrink-0 overflow-hidden bg-red-600 text-white"
          >
            <div className="flex flex-wrap items-center gap-3 px-4 py-4 sm:px-6">
              <span className="relative flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-white/20">
                <span className="absolute inset-0 animate-ping rounded-full bg-white/30" />
                <Siren className="relative h-6 w-6" aria-hidden />
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-display text-2xl font-extrabold leading-tight sm:text-3xl">SOS from {name}</p>
                <p className="text-sm text-white/90">
                  Sent {ago(snap.sos.created_at, now)}
                  {snap.sos.source === "voice" ? " by voice" : ""}. {last ? "Live location below." : "Waiting for location…"} Try calling {name}. If you
                  can't reach them, call 911.
                </p>
              </div>
              <div className="flex w-full gap-2 sm:w-auto">
                <a href="tel:911" className="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-white px-4 font-bold text-red-700 hover:bg-red-50 sm:flex-none">
                  <Phone className="h-4 w-4" aria-hidden /> Call 911
                </a>
                {last && (
                  <a
                    href={osmLink(last.lat, last.lng)}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-xl px-4 font-semibold ring-1 ring-white/50 hover:bg-white/10 sm:flex-none"
                  >
                    <MapPin className="h-4 w-4" aria-hidden /> Open in maps
                  </a>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <div className="relative h-[52dvh] shrink-0 lg:h-auto lg:flex-1">
          <MapContainer center={last ? [last.lat, last.lng] : CHICAGO} zoom={13} zoomControl={false} className="absolute inset-0 z-0 h-full w-full">
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            <ZoomControl position="topright" />
            {trip && active && (
              <>
                <TripRouteLayer geometry={trip.geometry} />
                <Marker position={trip.geometry[trip.geometry.length - 1]} icon={DEST_ICON} />
              </>
            )}
            {snap && <TrailLayer trail={snap.trail} />}
            {last && (
              <LiveMarker
                lat={last.lat}
                lng={last.lng}
                tone={snap?.sos ? "red" : offRoute ? "amber" : "teal"}
                label={snap?.sos ? `SOS · ${name.toUpperCase()}` : name.toUpperCase()}
                title={`${name} · ${ago(last.t, now)}${last.sim ? " (demo)" : ""}`}
              />
            )}
            <FitOnce points={points} deps={trip?.id ?? "none"} />
            <FollowPosition point={last} follow={follow} onUserMove={() => setFollow(false)} />
          </MapContainer>
          {!follow && last && (
            <button
              type="button"
              onClick={() => setFollow(true)}
              className="absolute bottom-3 right-3 z-[1000] inline-flex h-10 items-center gap-1.5 rounded-full bg-white px-3.5 text-sm font-semibold text-brand-800 shadow-[var(--shadow-lift)] ring-1 ring-line"
            >
              <LocateFixed className="h-4 w-4" aria-hidden /> Follow {name}
            </button>
          )}
          <AnimatePresence>
            {flash && flash.kind !== "sos" && (
              <motion.div
                role="status"
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className={`absolute inset-x-3 top-3 z-[1000] mx-auto max-w-md rounded-2xl p-3.5 shadow-[var(--shadow-lift)] ring-2 ${
                  flash.kind === "off_route" || flash.kind === "stopped" ? "bg-amber-50 ring-amber-400" : "bg-white ring-emerald-400"
                }`}
              >
                <p className="font-display text-base font-bold text-ink">{KIND[flash.kind].label}</p>
                <p className="text-sm text-ink-soft">{flash.message}</p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <aside className="min-h-0 flex-1 overflow-y-auto border-line bg-canvas lg:w-[24rem] lg:flex-none lg:border-l">
          <div className="space-y-4 p-4 sm:p-5">
            {snap?.viewer && (
              <p className="text-sm text-ink-soft">
                Hi {snap.viewer.name}, {name} added you as a trusted contact. Keep this page open to get alerts.
              </p>
            )}

            {/* Status */}
            <section className="rounded-3xl bg-white p-4 shadow-[var(--shadow-card)] ring-1 ring-line" aria-label="Status">
              {!snap ? (
                <div className="h-24 animate-pulse rounded-2xl bg-brand-50" />
              ) : active && trip ? (
                <>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-brand-teal-dark">{name} is walking</p>
                      <p className="mt-0.5 truncate font-display text-lg font-semibold text-ink">
                        {trip.to_name ? `To ${trip.to_name}` : "Trip in progress"}
                      </p>
                      {trip.from_name && <p className="truncate text-xs text-ink-soft">from {trip.from_name}</p>}
                    </div>
                    {trip.demo && (
                      <span className="shrink-0 rounded-full bg-brand-800 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white">Demo</span>
                    )}
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-3">
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-soft">ETA</p>
                      <p className="font-display text-2xl font-bold tabular-nums text-ink">
                        {progress ? Math.round(progress.eta_min) : Math.round(trip.eta_min)}
                        <span className="ml-1 font-sans text-sm text-ink-soft">min</span>
                      </p>
                    </div>
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-soft">Left</p>
                      <p className="font-display text-2xl font-bold tabular-nums text-ink">{km(progress ? progress.remaining_m : trip.distance_m)}</p>
                    </div>
                  </div>
                  <p className="mt-3 flex flex-wrap items-center gap-2 text-sm">
                    {checking ? (
                      <span className="rounded-full bg-brand-50 px-2.5 py-1 font-semibold text-brand-800 ring-1 ring-brand-200">
                        Checking in with {name}…
                      </span>
                    ) : offRoute ? (
                      <span className="rounded-full bg-amber-100 px-2.5 py-1 font-semibold text-amber-900 ring-1 ring-amber-300">
                        Off route · {Math.round(progress?.off_route_m ?? 0)} m
                      </span>
                    ) : (
                      <span className="rounded-full bg-emerald-50 px-2.5 py-1 font-semibold text-emerald-800 ring-1 ring-emerald-200">On route</span>
                    )}
                    <span className="text-xs text-ink-soft">{last ? `updated ${ago(last.t, now)}` : "waiting for first location…"}</span>
                  </p>
                </>
              ) : trip && kind === "track" ? (
                <div className="flex items-start gap-3">
                  <CircleCheck className="mt-0.5 h-6 w-6 shrink-0 text-emerald-700" aria-hidden />
                  <div>
                    <p className="font-display text-lg font-semibold text-ink">{trip.status === "arrived" ? `${name} arrived safely` : "This trip has ended"}</p>
                    <p className="text-sm text-ink-soft">Location sharing has stopped.</p>
                  </div>
                </div>
              ) : snap.sos ? (
                <p className="font-semibold text-red-700">{name} sent an SOS. Their live location is on the map.</p>
              ) : (
                <div className="flex items-start gap-3">
                  <ShieldCheck className="mt-0.5 h-6 w-6 shrink-0 text-brand-600" aria-hidden />
                  <div>
                    <p className="font-display text-lg font-semibold text-ink">No trip right now</p>
                    <p className="text-sm text-ink-soft">
                      {name}'s location is only shared during a trip or an SOS. This page updates live when that happens.
                    </p>
                  </div>
                </div>
              )}
            </section>

            {/* Alert sound + notifications */}
            <section className="rounded-3xl bg-white p-4 ring-1 ring-line">
              {soundReady ? (
                <p className="flex items-center gap-2 text-sm text-ink">
                  <BellRing className="h-4 w-4 text-brand-teal-dark" aria-hidden />
                  Alert sound on{notifPerm === "granted" ? " · notifications on" : notifPerm === "denied" ? " · notifications blocked in browser" : ""}.
                </p>
              ) : (
                <>
                  <p className="text-sm text-ink-soft">Turn on sound and browser notifications so you notice an SOS even in another tab.</p>
                  <button
                    type="button"
                    onClick={() => void enableAlerts()}
                    className="mt-3 inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-brand-800 text-sm font-semibold text-white transition hover:bg-brand-700"
                  >
                    <Bell className="h-4 w-4" aria-hidden /> Turn on alerts
                  </button>
                </>
              )}
            </section>

            {/* Feed */}
            <section aria-label="Alert feed">
              <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-ink-soft">Updates</h2>
              {snap && snap.alerts.length === 0 ? (
                <p className="rounded-2xl bg-white/70 p-4 text-sm text-ink-soft ring-1 ring-line">Nothing yet.</p>
              ) : (
                <ol className="space-y-2" aria-live="polite">
                  {snap?.alerts.map((a) => {
                    const k = KIND[a.kind] ?? KIND.trip_started;
                    const Icon = k.icon;
                    return (
                      <li key={a.id} className={`flex gap-3 rounded-2xl bg-white p-3 ring-1 ${a.kind === "sos" ? "ring-red-300" : "ring-line"}`}>
                        <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${k.cls}`}>
                          <Icon className="h-[18px] w-[18px]" aria-hidden />
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="flex items-baseline justify-between gap-2">
                            <span className="text-sm font-semibold text-ink">{k.label}</span>
                            <span className="shrink-0 text-xs text-ink-soft">{ago(a.created_at, now)}</span>
                          </p>
                          <p className="text-[13px] leading-snug text-ink-soft">{a.message}</p>
                          {a.lat != null && a.lng != null && (a.kind === "sos" || a.kind === "off_route" || a.kind === "stopped") && (
                            <a href={osmLink(a.lat, a.lng)} target="_blank" rel="noreferrer" className="mt-1 inline-block text-xs font-medium text-brand-teal-dark underline-offset-2 hover:underline">
                              Location at the time
                            </a>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ol>
              )}
            </section>
            <p className="pb-6 text-xs leading-relaxed text-ink-soft">
              WAYRA – SafeRoute pilot (Chicago). Messages are delivered on this page{snap?.channels.includes("sms") ? " and by SMS" : ""}
              {snap?.channels.includes("email") ? " and email" : ""}. Keep this link private.
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}
