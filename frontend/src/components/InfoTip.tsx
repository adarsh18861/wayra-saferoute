import { useEffect, useId, useRef, useState, type ReactNode } from "react";

/** Small "i" button with a popover. Opens on click/tap; Esc or an outside tap closes it. */
export default function InfoTip({ label, children, align = "left" }: { label: string; children: ReactNode; align?: "left" | "right" }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return (
    <span ref={ref} className="relative inline-flex">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1.5 rounded-full text-xs font-medium text-brand-purple-light hover:text-brand-purple focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-teal"
      >
        <span aria-hidden className="flex h-4 w-4 items-center justify-center rounded-full bg-brand-purple-light text-[10px] font-bold text-white">
          i
        </span>
        <span className="underline decoration-dotted underline-offset-2">{label}</span>
      </button>
      {open && (
        <span
          id={id}
          role="tooltip"
          className={`absolute bottom-full z-[1300] mb-2 w-72 max-w-[80vw] rounded-xl bg-slate-900 p-3 text-xs leading-relaxed text-white shadow-xl ${
            align === "left" ? "left-0" : "right-0"
          }`}
        >
          {children}
        </span>
      )}
    </span>
  );
}
