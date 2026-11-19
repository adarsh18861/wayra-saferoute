import { CircleAlert, CircleCheck, Info, TriangleAlert, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useSafety, type ToastTone } from "../lib/safety";

const STYLE: Record<ToastTone, { ring: string; icon: typeof Info; iconClass: string }> = {
  info: { ring: "ring-brand-200", icon: Info, iconClass: "bg-brand-50 text-brand-700" },
  success: { ring: "ring-emerald-200", icon: CircleCheck, iconClass: "bg-emerald-50 text-emerald-700" },
  warn: { ring: "ring-amber-200", icon: TriangleAlert, iconClass: "bg-amber-50 text-amber-700" },
  danger: { ring: "ring-red-200", icon: CircleAlert, iconClass: "bg-red-50 text-red-700" },
};

/** Toast stack under the navbar. Polite live region; danger toasts are assertive. */
export default function Toaster() {
  const { toasts, dismissToast } = useSafety();
  return (
    <div className="pointer-events-none fixed inset-x-0 top-[4.5rem] z-[1500] flex flex-col items-center gap-2 px-3" aria-live="polite">
      <AnimatePresence initial={false}>
        {toasts.map((t) => {
          const s = STYLE[t.tone];
          const Icon = s.icon;
          return (
            <motion.div
              key={t.id}
              layout
              role={t.tone === "danger" ? "alert" : "status"}
              initial={{ opacity: 0, y: -12, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -8, scale: 0.97 }}
              className={`pointer-events-auto flex w-full max-w-md items-start gap-3 rounded-2xl bg-white/97 p-3 pr-2 shadow-[var(--shadow-lift)] ring-1 backdrop-blur ${s.ring}`}
            >
              <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl ${s.iconClass}`}>
                <Icon className="h-[18px] w-[18px]" aria-hidden />
              </span>
              <div className="min-w-0 flex-1 pt-0.5">
                <p className="text-sm font-semibold text-ink">{t.title}</p>
                {t.text && <p className="mt-0.5 text-[13px] leading-snug text-ink-soft">{t.text}</p>}
                {t.action && (
                  <button
                    type="button"
                    onClick={() => {
                      t.action?.run();
                      dismissToast(t.id);
                    }}
                    className="mt-2 rounded-lg bg-brand-800 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-brand-700"
                  >
                    {t.action.label}
                  </button>
                )}
              </div>
              <button
                type="button"
                onClick={() => dismissToast(t.id)}
                aria-label="Dismiss"
                className="rounded-full p-1.5 text-ink-soft transition hover:bg-brand-50 hover:text-ink"
              >
                <X className="h-4 w-4" aria-hidden />
              </button>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
