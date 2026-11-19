import { Moon } from "lucide-react";

/** Shown whenever night-safe routing applies (auto after Chicago sunset, or switched on). */
export default function NightModeBadge({ active, source, sunset }: { active: boolean; source: "auto" | "on"; sunset?: string }) {
  if (!active) return null;
  return (
    <p
      role="status"
      className="inline-flex items-center gap-1.5 rounded-full bg-gradient-to-r from-brand-800 to-brand-600 px-3 py-1.5 text-xs font-semibold text-white shadow-[var(--shadow-card)]"
      title={source === "auto" ? `On automatically after Chicago sunset${sunset ? ` (${sunset})` : ""}` : "Switched on manually"}
    >
      <Moon className="h-3.5 w-3.5 text-brand-teal-light" aria-hidden /> Night-safe mode active
      <span className="font-normal text-brand-teal-light">{source === "auto" ? "· auto" : "· on"}</span>
    </p>
  );
}
