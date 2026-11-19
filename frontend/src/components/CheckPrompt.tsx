import { ShieldQuestion } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { useSafety } from "../lib/safety";
import { playTick } from "../lib/sound";

/** "Are you OK? Alerting contacts in 15 s" — shown when the server detects a deviation. */
export default function CheckPrompt() {
  const { check, answerCheck, startSOS, contacts } = useSafety();
  const [left, setLeft] = useState(15);
  const okRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!check) return;
    okRef.current?.focus();
    const tick = () => {
      const s = Math.max(0, Math.ceil((check.deadline - Date.now()) / 1000));
      setLeft((prev) => {
        if (s !== prev && s > 0 && s <= 5) playTick(s <= 2);
        return s;
      });
    };
    tick();
    const id = window.setInterval(tick, 250);
    return () => window.clearInterval(id);
  }, [check]);

  const n = contacts?.length ?? 0;
  const who = n === 0 ? "the trip log" : n === 1 ? "your contact" : `your ${n} contacts`;
  const why =
    check?.reason === "off_route"
      ? `You seem to be about ${Math.round(check.detail ?? 100)} m off your planned route.`
      : "You haven't moved for a while during your trip.";

  return (
    <AnimatePresence>
      {check && (
        <motion.div
          className="fixed inset-0 z-[1900] flex items-end justify-center bg-brand-950/55 p-3 backdrop-blur-sm sm:items-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <motion.div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="check-title"
            aria-describedby="check-desc"
            initial={{ y: 30, scale: 0.97 }}
            animate={{ y: 0, scale: 1 }}
            exit={{ y: 30, scale: 0.97 }}
            className="w-full max-w-sm overflow-hidden rounded-3xl bg-white shadow-[var(--shadow-lift)]"
          >
            <div className="h-1.5 bg-brand-100">
              <div
                className="h-full bg-brand-700 transition-[width] duration-300 ease-linear"
                style={{ width: `${Math.min(100, (left / 15) * 100)}%` }}
              />
            </div>
            <div className="p-6 text-center">
              <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-50 text-brand-700">
                <ShieldQuestion className="h-7 w-7" aria-hidden />
              </span>
              <h2 id="check-title" className="mt-4 text-2xl font-extrabold text-ink">
                Are you OK?
              </h2>
              <p id="check-desc" className="mt-1.5 text-sm text-ink-soft">
                {why} Alerting {who} in <span className="font-bold text-ink">{left} s</span>.
              </p>
              <button
                ref={okRef}
                type="button"
                onClick={answerCheck}
                className="mt-6 h-14 w-full rounded-2xl bg-brand-800 text-lg font-bold text-white shadow-[var(--shadow-card)] transition hover:bg-brand-700 active:scale-[0.98]"
              >
                I'm OK — cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  answerCheck();
                  startSOS("button");
                }}
                className="mt-2 h-12 w-full rounded-2xl font-semibold text-red-700 ring-1 ring-red-200 transition hover:bg-red-50"
              >
                I need help — send SOS
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
