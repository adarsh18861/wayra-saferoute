import { Grid3x3, MicOff, Phone, PhoneIncoming, PhoneOff, UserPlus, Video, Volume2, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import { useSafety } from "../lib/safety";
import Modal from "./ui/Modal";

const CALLERS = ["Mom", "Dad", "Sister", "Priya"];
const DELAYS = [
  { s: 0, label: "Now" },
  { s: 10, label: "In 10 s" },
  { s: 30, label: "In 30 s" },
];

function initials(name: string): string {
  const p = name.trim().split(/\s+/);
  return ((p[0]?.[0] ?? "") + (p.length > 1 ? p[p.length - 1][0] : "")).toUpperCase() || "?";
}

function mmss(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

/** Fake call: setup dialog, a "call in 8 s" pill, the incoming-call screen and the in-call screen. */
export default function FakeCall() {
  const { fakeCall, fakeSetupOpen, closeFakeCallSetup, scheduleFakeCall, acceptFakeCall, endFakeCall } = useSafety();
  const [caller, setCaller] = useState("Mom");
  const [custom, setCustom] = useState("");
  const [delay, setDelay] = useState(10);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (fakeCall.phase === "idle" || fakeCall.phase === "ringing") return;
    const id = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(id);
  }, [fakeCall.phase]);

  const name = caller === "custom" ? custom.trim() || "Unknown" : caller;

  return (
    <>
      <Modal open={fakeSetupOpen} onClose={closeFakeCallSetup} title="Fake call" icon={<PhoneIncoming className="h-5 w-5" aria-hidden />}>
        <p className="-mt-2 mb-4 text-sm text-ink-soft">
          A realistic incoming call to help you step away from an uncomfortable situation. Put your phone face-up and wait.
        </p>
        <fieldset>
          <legend className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-soft">Who's calling</legend>
          <div className="flex flex-wrap gap-2">
            {[...CALLERS, "custom"].map((c) => (
              <button
                key={c}
                type="button"
                aria-pressed={caller === c}
                onClick={() => setCaller(c)}
                className={`rounded-full px-3.5 py-1.5 text-sm font-semibold ring-1 transition ${
                  caller === c ? "bg-brand-800 text-white ring-brand-800" : "bg-white text-ink ring-line hover:ring-brand-300"
                }`}
              >
                {c === "custom" ? "Custom…" : c}
              </button>
            ))}
          </div>
          {caller === "custom" && (
            <input
              autoFocus
              value={custom}
              maxLength={30}
              onChange={(e) => setCustom(e.target.value)}
              placeholder="Caller name"
              aria-label="Custom caller name"
              className="mt-3 h-11 w-full rounded-xl border border-line px-3 text-sm focus:border-brand-teal focus:outline-none focus:ring-4 focus:ring-brand-teal/15"
            />
          )}
        </fieldset>
        <fieldset className="mt-5">
          <legend className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-soft">When</legend>
          <div role="radiogroup" aria-label="Delay" className="grid grid-cols-3 gap-1 rounded-2xl bg-brand-50 p-1 ring-1 ring-brand-100">
            {DELAYS.map((d) => (
              <button
                key={d.s}
                type="button"
                role="radio"
                aria-checked={delay === d.s}
                onClick={() => setDelay(d.s)}
                className={`rounded-xl py-2 text-sm font-semibold transition ${delay === d.s ? "bg-white text-brand-800 shadow-[var(--shadow-card)]" : "text-ink-soft hover:text-brand-800"}`}
              >
                {d.label}
              </button>
            ))}
          </div>
        </fieldset>
        <button
          type="button"
          onClick={() => scheduleFakeCall(name, delay)}
          className="mt-6 inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-brand-800 font-semibold text-white shadow-[var(--shadow-card)] transition hover:bg-brand-700 active:scale-[0.99]"
        >
          <Phone className="h-4 w-4" aria-hidden />
          {delay === 0 ? `Ring now as “${name}”` : `Schedule call from “${name}”`}
        </button>
      </Modal>

      {/* Waiting pill */}
      <AnimatePresence>
        {fakeCall.phase === "scheduled" && fakeCall.ringAt && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            className="fixed bottom-6 left-1/2 z-[1300] flex -translate-x-1/2 items-center gap-2 rounded-full bg-brand-950/90 py-1.5 pl-4 pr-1.5 text-sm text-white shadow-[var(--shadow-lift)] backdrop-blur"
            role="status"
          >
            <PhoneIncoming className="h-4 w-4 text-brand-teal-light" aria-hidden />
            Call from {fakeCall.caller} in {Math.max(0, Math.ceil((fakeCall.ringAt - now) / 1000))} s
            <button type="button" onClick={endFakeCall} aria-label="Cancel fake call" className="rounded-full p-1.5 hover:bg-white/15">
              <X className="h-4 w-4" aria-hidden />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Incoming / in-call screens: deliberately look like a phone, not like WAYRA. */}
      <AnimatePresence>
        {(fakeCall.phase === "ringing" || fakeCall.phase === "incall") && (
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label={fakeCall.phase === "ringing" ? `Incoming call from ${fakeCall.caller}` : `On a call with ${fakeCall.caller}`}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[3000] flex flex-col items-center bg-[radial-gradient(120%_80%_at_50%_0%,#3a3f58_0%,#16182a_55%,#0b0c16_100%)] px-6 pb-[max(2.5rem,env(safe-area-inset-bottom))] pt-[max(4rem,env(safe-area-inset-top))] font-sans text-white"
          >
            <p className="text-sm tracking-wide text-white/60">{fakeCall.phase === "ringing" ? "mobile" : mmss(now - (fakeCall.answeredAt ?? now))}</p>
            <h2 className="mt-2 text-center font-sans text-4xl font-light tracking-normal">{fakeCall.caller}</h2>
            <p className="mt-1 text-sm text-white/60">{fakeCall.phase === "ringing" ? "Incoming call…" : "Connected"}</p>

            <div className="relative mt-14 flex h-36 w-36 items-center justify-center">
              {fakeCall.phase === "ringing" && (
                <>
                  <span className="absolute inset-0 animate-pulse-ring rounded-full bg-white/15" />
                  <span className="absolute inset-0 animate-pulse-ring rounded-full bg-white/10 [animation-delay:0.8s]" />
                </>
              )}
              <span className="relative flex h-36 w-36 items-center justify-center rounded-full bg-gradient-to-br from-slate-400 to-slate-600 text-5xl font-medium shadow-2xl">
                {initials(fakeCall.caller)}
              </span>
            </div>

            {fakeCall.phase === "ringing" ? (
              <div className="mt-auto grid w-full max-w-xs grid-cols-2 gap-10">
                <button type="button" onClick={endFakeCall} className="flex flex-col items-center gap-2 text-sm">
                  <span className="flex h-[4.5rem] w-[4.5rem] items-center justify-center rounded-full bg-[#ff3b30] shadow-lg transition active:scale-95">
                    <PhoneOff className="h-8 w-8" aria-hidden />
                  </span>
                  Decline
                </button>
                <button type="button" onClick={acceptFakeCall} className="flex flex-col items-center gap-2 text-sm" autoFocus>
                  <span className="flex h-[4.5rem] w-[4.5rem] animate-bounce items-center justify-center rounded-full bg-[#34c759] shadow-lg transition active:scale-95">
                    <Phone className="h-8 w-8" aria-hidden />
                  </span>
                  Accept
                </button>
              </div>
            ) : (
              <>
                <div className="mt-auto grid w-full max-w-xs grid-cols-3 gap-x-6 gap-y-5" aria-hidden>
                  {[
                    { i: MicOff, l: "mute" },
                    { i: Grid3x3, l: "keypad" },
                    { i: Volume2, l: "speaker" },
                    { i: UserPlus, l: "add call" },
                    { i: Video, l: "video" },
                    { i: Phone, l: "contacts" },
                  ].map(({ i: Icon, l }) => (
                    <span key={l} className="flex flex-col items-center gap-1.5 text-xs text-white/80">
                      <span className="flex h-16 w-16 items-center justify-center rounded-full bg-white/12 backdrop-blur">
                        <Icon className="h-7 w-7" />
                      </span>
                      {l}
                    </span>
                  ))}
                </div>
                <button type="button" onClick={endFakeCall} aria-label="End call" className="mt-10" autoFocus>
                  <span className="flex h-[4.5rem] w-[4.5rem] items-center justify-center rounded-full bg-[#ff3b30] shadow-lg transition active:scale-95">
                    <PhoneOff className="h-8 w-8" aria-hidden />
                  </span>
                </button>
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
