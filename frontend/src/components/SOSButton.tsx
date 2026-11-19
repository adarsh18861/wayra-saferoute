import {
  ChevronDown,
  CircleCheck,
  Clock3,
  LoaderCircle,
  MapPin,
  MessageSquareText,
  Mic,
  Phone,
  Radio,
  ShieldCheck,
  WifiOff,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { osmLink, type Delivery } from "../lib/api";
import { useSafety } from "../lib/safety";
import { playTick } from "../lib/sound";

const COUNTDOWN_S = 5;

/** Always-visible SOS button (bottom-right on every signed-in page). */
export default function SOSButton() {
  const { sos, startSOS } = useSafety();
  const busy = sos.phase !== "idle";
  return (
    <>
      <button
        type="button"
        onClick={() => startSOS("button")}
        disabled={busy}
        aria-label="SOS emergency: alert my trusted contacts"
        className="fixed bottom-5 right-4 z-[1200] flex h-16 w-16 items-center justify-center rounded-full bg-red-600 font-display text-lg font-extrabold tracking-wider text-white shadow-[0_6px_20px_rgba(220,38,38,0.55)] ring-4 ring-white transition hover:bg-red-700 focus:outline-none focus-visible:ring-red-300 active:scale-95 disabled:opacity-90"
      >
        <span aria-hidden className="absolute inset-0 animate-pulse-ring rounded-full bg-red-500/60" />
        <span className="relative">SOS</span>
      </button>
      <SOSOverlay />
    </>
  );
}

function CountdownRing({ value, total }: { value: number; total: number }) {
  const r = 70;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative mx-auto h-48 w-48">
      <svg viewBox="0 0 160 160" className="h-full w-full -rotate-90" aria-hidden>
        <circle cx="80" cy="80" r={r} fill="none" stroke="rgb(255 255 255 / 0.18)" strokeWidth="10" />
        <circle
          cx="80"
          cy="80"
          r={r}
          fill="none"
          stroke="#fff"
          strokeWidth="10"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - value / total)}
          style={{ transition: "stroke-dashoffset 1s linear" }}
        />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center font-display text-8xl font-extrabold tabular-nums text-white">
        {Math.ceil(value)}
      </span>
    </div>
  );
}

const STATUS_TEXT: Record<string, string> = {
  live: "seeing it live",
  queued: "waiting in their watch link",
  sent: "sent",
  failed: "failed",
  simulated: "simulated (no call placed)",
};

function DeliveryRow({ d }: { d: Delivery }) {
  const ok = d.status === "live" || d.status === "sent";
  const channel = d.channel === "in_app" ? "Watch link" : d.channel === "sms" ? "SMS" : d.channel === "email" ? "Email" : "Log only";
  return (
    <li className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 rounded-xl bg-white/10 px-3 py-2 text-sm">
      {ok ? <CircleCheck className="h-4 w-4 shrink-0 text-emerald-300" aria-hidden /> : <Clock3 className="h-4 w-4 shrink-0 text-white/70" aria-hidden />}
      <span className="min-w-0 flex-1 font-semibold">{d.contact_name}</span>
      <span className="text-xs text-white/75">
        {channel} · {STATUS_TEXT[d.status] ?? d.status}
      </span>
    </li>
  );
}

/** Full-screen SOS: 5 s countdown with a big Cancel, then "Help is being alerted". */
function SOSOverlay() {
  const { sos, cancelSOS, confirmSOS, resolveSOS, contacts, position, trip } = useSafety();
  const [left, setLeft] = useState(COUNTDOWN_S);
  const [minimized, setMinimized] = useState(false);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef(confirmSOS);
  confirmRef.current = confirmSOS;

  useEffect(() => {
    if (sos.phase !== "countdown") return;
    setLeft(COUNTDOWN_S);
    setMinimized(false);
    cancelRef.current?.focus();
    const started = Date.now();
    playTick();
    const id = window.setInterval(() => {
      const remaining = COUNTDOWN_S - (Date.now() - started) / 1000;
      if (remaining <= 0) {
        window.clearInterval(id);
        setLeft(0);
        void confirmRef.current();
        return;
      }
      setLeft((prev) => {
        if (Math.ceil(remaining) !== Math.ceil(prev)) playTick(remaining < 1.5);
        return remaining;
      });
    }, 100);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && cancelSOS();
    document.addEventListener("keydown", onKey);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("keydown", onKey);
    };
  }, [sos.phase, cancelSOS]);

  const nContacts = contacts?.length ?? 0;
  const phones = contacts?.filter((c) => c.phone).length ?? 0;
  const pos = position ?? sos.position;
  const show = sos.phase !== "idle" && !(minimized && sos.phase === "active");

  return (
    <>
      {/* Minimised SOS: a red bar under the navbar keeps it obvious while the map is visible. */}
      {sos.phase === "active" && minimized && (
        <button
          type="button"
          onClick={() => setMinimized(false)}
          className="fixed inset-x-0 top-16 z-[1450] flex items-center justify-center gap-2 bg-red-600 px-4 py-2 text-sm font-bold text-white shadow-lg"
        >
          <span className="relative flex h-2.5 w-2.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white/80" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-white" />
          </span>
          SOS active · {sos.offline ? "offline SMS" : "sharing your live location"} · Open
        </button>
      )}
      <AnimatePresence>
        {show && (
          <motion.div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="sos-title"
            aria-describedby="sos-desc"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[2000] overflow-y-auto bg-gradient-to-b from-red-600 via-red-700 to-red-950 text-white"
          >
            <div className="mx-auto flex min-h-full max-w-md flex-col px-5 pb-8 pt-[max(1.5rem,env(safe-area-inset-top))]">
              {sos.phase === "countdown" && (
                <div className="flex flex-1 flex-col items-center justify-center text-center">
                  <p className="flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1 text-xs font-bold uppercase tracking-widest">
                    {sos.source === "voice" ? <Mic className="h-3.5 w-3.5" aria-hidden /> : <Radio className="h-3.5 w-3.5" aria-hidden />}
                    {sos.source === "voice" ? "Voice SOS heard" : "SOS"}
                  </p>
                  <h2 id="sos-title" className="mt-5 text-3xl font-extrabold">
                    Sending SOS in
                  </h2>
                  <div className="my-8">
                    <CountdownRing value={left} total={COUNTDOWN_S} />
                  </div>
                  <p id="sos-desc" className="max-w-xs text-base text-white/90">
                    {nContacts
                      ? `Your ${nContacts === 1 ? "trusted contact" : `${nContacts} trusted contacts`} will get your live location.`
                      : "You have no trusted contacts yet. The SOS will be logged and you can call 911."}
                    {!navigator.onLine && " You're offline, so your SMS app will open instead."}
                  </p>
                  <button
                    ref={cancelRef}
                    type="button"
                    onClick={cancelSOS}
                    className="mt-10 h-16 w-full max-w-xs rounded-2xl bg-white text-xl font-extrabold text-red-700 shadow-2xl transition hover:bg-red-50 focus-visible:outline-4 focus-visible:outline-offset-4 focus-visible:outline-white active:scale-[0.98]"
                  >
                    Cancel
                  </button>
                  <p className="mt-3 text-xs text-white/70">Press Esc or tap Cancel if this was a mistake.</p>
                </div>
              )}

              {sos.phase === "sending" && (
                <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center" role="status">
                  <LoaderCircle className="h-14 w-14 animate-spin" aria-hidden />
                  <h2 id="sos-title" className="text-2xl font-extrabold">
                    Alerting your contacts…
                  </h2>
                  <p id="sos-desc" className="sr-only">Sending your SOS</p>
                </div>
              )}

              {sos.phase === "active" && (
                <div className="flex flex-1 flex-col">
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-2 rounded-full bg-white/15 px-3 py-1 text-xs font-bold uppercase tracking-widest">
                      <span className="relative flex h-2 w-2">
                        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white" />
                        <span className="relative inline-flex h-2 w-2 rounded-full bg-white" />
                      </span>
                      SOS active
                    </span>
                    <button
                      type="button"
                      onClick={() => setMinimized(true)}
                      className="flex items-center gap-1 rounded-full px-3 py-1.5 text-sm font-semibold text-white/90 transition hover:bg-white/10"
                    >
                      <ChevronDown className="h-4 w-4" aria-hidden /> Minimise
                    </button>
                  </div>

                  {sos.offline ? (
                    <>
                      <WifiOff className="mt-8 h-12 w-12" aria-hidden />
                      <h2 id="sos-title" className="mt-3 text-3xl font-extrabold leading-tight">
                        You're offline
                      </h2>
                      <p id="sos-desc" className="mt-2 text-white/90">
                        {phones
                          ? `We opened your SMS app with a message to ${phones === 1 ? "your contact" : `${phones} contacts`}. Press send.`
                          : "No trusted contact has a phone number saved, so no SMS could be prepared. Call 911."}
                      </p>
                      <p className="mt-3 rounded-xl bg-white/10 p-3 text-sm">
                        “SOS from WAYRA – my location: {pos ? osmLink(pos.lat, pos.lng) : "location unavailable"}”
                      </p>
                      {phones > 0 && sos.smsUrl && (
                        <a
                          href={sos.smsUrl}
                          className="mt-3 inline-flex h-12 items-center justify-center gap-2 rounded-2xl bg-white/15 font-semibold ring-1 ring-white/40 transition hover:bg-white/25"
                        >
                          <MessageSquareText className="h-5 w-5" aria-hidden /> Open SMS again
                        </a>
                      )}
                    </>
                  ) : (
                    <>
                      <h2 id="sos-title" className="mt-8 text-3xl font-extrabold leading-tight">
                        Help is being alerted
                      </h2>
                      <p id="sos-desc" className="mt-2 text-white/90">
                        {nContacts
                          ? "Your trusted contacts got your SOS and can follow your live location until you say you're safe."
                          : "Your SOS is logged. Add trusted contacts so they're alerted next time."}
                      </p>
                      {sos.record && sos.record.deliveries.length > 0 && (
                        <ul className="mt-4 space-y-1.5" aria-label="Who was alerted">
                          {sos.record.deliveries.map((d, i) => (
                            <DeliveryRow key={i} d={d} />
                          ))}
                        </ul>
                      )}
                      <p className="mt-3 flex items-center gap-2 text-sm text-white/85">
                        <MapPin className="h-4 w-4 shrink-0" aria-hidden />
                        {pos ? (
                          <span>
                            Sharing location {pos.sim ? "(demo walker) " : ""}
                            <a className="underline underline-offset-2" href={osmLink(pos.lat, pos.lng)} target="_blank" rel="noreferrer">
                              {pos.lat.toFixed(5)}, {pos.lng.toFixed(5)}
                            </a>
                            {trip ? " · trip in progress" : ""}
                          </span>
                        ) : (
                          "Waiting for your location…"
                        )}
                      </p>
                    </>
                  )}

                  <div className="mt-auto space-y-3 pt-8">
                    <a
                      href="tel:911"
                      className="flex h-16 w-full items-center justify-center gap-3 rounded-2xl bg-white text-xl font-extrabold text-red-700 shadow-2xl transition hover:bg-red-50 active:scale-[0.98]"
                    >
                      <Phone className="h-6 w-6" aria-hidden /> Call 911
                    </a>
                    <p className="text-center text-xs text-white/75">
                      Chicago pilot: 911. WAYRA never dials for you, and no dispatcher is contacted automatically.
                    </p>
                    <button
                      type="button"
                      onClick={() => void resolveSOS()}
                      className="flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-brand-teal font-bold text-brand-950 shadow-[var(--shadow-glow)] transition hover:bg-brand-teal-light active:scale-[0.98]"
                    >
                      <ShieldCheck className="h-5 w-5" aria-hidden /> I'm safe now
                    </button>
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
