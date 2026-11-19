import { X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useId, useRef, type ReactNode } from "react";

type Props = {
  open: boolean;
  onClose: () => void;
  title: string;
  icon?: ReactNode;
  children: ReactNode;
  /** Wider panel for forms. */
  size?: "sm" | "md";
};

/** Bottom sheet on phones, centred dialog on larger screens. Escape / backdrop closes; focus is trapped loosely. */
export default function Modal({ open, onClose, title, icon, children, size = "sm" }: Props) {
  const id = useId();
  const panel = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const t = window.setTimeout(() => {
      const first = panel.current?.querySelector<HTMLElement>("[data-autofocus], input, button:not([data-close])");
      (first ?? panel.current)?.focus();
    }, 30);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close.current();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      window.clearTimeout(t);
      document.removeEventListener("keydown", onKey);
      prev?.focus?.();
    };
  }, [open]);
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[1600] flex items-end justify-center bg-brand-950/45 p-0 backdrop-blur-[2px] sm:items-center sm:p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onPointerDown={(e) => e.target === e.currentTarget && onClose()}
        >
          <motion.div
            ref={panel}
            role="dialog"
            aria-modal="true"
            aria-labelledby={id}
            tabIndex={-1}
            initial={{ y: 40, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 40, opacity: 0 }}
            transition={{ type: "spring", damping: 28, stiffness: 320 }}
            className={`max-h-[92dvh] w-full overflow-y-auto rounded-t-3xl bg-white p-5 shadow-[var(--shadow-lift)] outline-none sm:rounded-3xl ${size === "md" ? "sm:max-w-lg" : "sm:max-w-sm"}`}
          >
            <div className="mb-4 flex items-start gap-3">
              {icon && <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-brand-50 text-brand-700">{icon}</span>}
              <h2 id={id} className="flex-1 pt-1.5 text-lg font-bold text-ink">
                {title}
              </h2>
              <button
                type="button"
                data-close
                onClick={onClose}
                aria-label="Close"
                className="-mr-1 -mt-1 rounded-full p-2 text-ink-soft transition hover:bg-brand-50 hover:text-ink"
              >
                <X className="h-5 w-5" aria-hidden />
              </button>
            </div>
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
