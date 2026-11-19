/** Shown whenever night-safe routing applies (auto after Chicago sunset, or switched on). */
export default function NightModeBadge({ active, source, sunset }: { active: boolean; source: "auto" | "on"; sunset?: string }) {
  if (!active) return null;
  return (
    <p
      role="status"
      className="inline-flex items-center gap-1.5 rounded-full bg-brand-purple px-3 py-1 text-xs font-semibold text-white shadow"
      title={source === "auto" ? `On automatically after Chicago sunset${sunset ? ` (${sunset})` : ""}` : "Switched on manually"}
    >
      <span aria-hidden>🌙</span> Night-safe mode active
      <span className="font-normal text-brand-teal-light">{source === "auto" ? "· auto" : "· on"}</span>
    </p>
  );
}
