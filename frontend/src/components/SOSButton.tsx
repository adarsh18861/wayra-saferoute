import { useEffect, useRef, useState } from "react";

/** Always-visible SOS button. Placeholder: alerts to trusted contacts are wired up in the next phase. */
export default function SOSButton() {
  const [open, setOpen] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="SOS emergency"
        className="fixed bottom-5 right-4 z-[1200] flex h-16 w-16 font-display items-center justify-center rounded-full bg-red-600 text-lg font-extrabold tracking-wider text-white shadow-[0_6px_20px_rgba(220,38,38,0.55)] ring-4 ring-white transition hover:bg-red-700 focus:outline-none focus-visible:ring-red-300 active:scale-95"
      >
        <span aria-hidden className="absolute inset-0 rounded-full bg-red-500/60 animate-pulse-ring" />
        <span className="relative">SOS</span>
      </button>
      {open && (
        <div className="fixed inset-0 z-[1400] flex items-end justify-center bg-black/40 p-4 sm:items-center" onClick={() => setOpen(false)}>
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="sos-title"
            className="w-full max-w-sm rounded-3xl bg-white p-6 shadow-[var(--shadow-lift)]"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="sos-title" className="text-lg font-bold text-red-700">
              SOS
            </h2>
            <p className="mt-2 text-sm text-slate-700">
              One-tap SOS to your trusted contacts is coming in the next update. If you are in danger right now, call 911.
            </p>
            <div className="mt-4 flex gap-2">
              <a href="tel:911" className="flex-1 rounded-lg bg-red-600 py-3 text-center font-semibold text-white hover:bg-red-700">
                Call 911
              </a>
              <button
                ref={closeRef}
                type="button"
                onClick={() => setOpen(false)}
                className="flex-1 rounded-lg border border-slate-300 py-3 font-semibold text-slate-700 hover:bg-slate-50"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
