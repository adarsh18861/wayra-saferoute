import { useId } from "react";

/** WAYRA mark: a rounded tile with a safe path from A (white) to B (teal). */
export function LogoMark({ className = "h-9 w-9" }: { className?: string }) {
  const id = useId().replace(/:/g, "");
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={`${id}-bg`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#7550b8" />
          <stop offset="1" stopColor="#2a1450" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="9" fill={`url(#${id}-bg)`} />
      <path d="M9.5 22.5c0-6 4-6.5 6.5-6.5s6.5-.5 6.5-6.5" fill="none" stroke="#5eead4" strokeWidth="3" strokeLinecap="round" />
      <circle cx="9.5" cy="22.5" r="2.6" fill="#fff" />
      <circle cx="22.5" cy="9.5" r="2.6" fill="#14b8a6" stroke="#fff" strokeWidth="1.2" />
    </svg>
  );
}

/** Mark + wordmark. `tone` picks the wordmark colour for dark or light backgrounds. */
export default function Logo({ tone = "dark", sub }: { tone?: "dark" | "light"; sub?: string }) {
  return (
    <span className="inline-flex items-center gap-2.5">
      <LogoMark />
      <span className="leading-none">
        <span className={`font-display text-xl font-bold tracking-[0.08em] ${tone === "light" ? "text-white" : "text-brand-900"}`}>
          WAYRA
        </span>
        {sub && (
          <span className={`mt-0.5 block text-[11px] font-medium ${tone === "light" ? "text-brand-teal-light" : "text-brand-teal-dark"}`}>
            {sub}
          </span>
        )}
      </span>
    </span>
  );
}
