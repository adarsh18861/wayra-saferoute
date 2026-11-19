import { Flag } from "lucide-react";
import { useState } from "react";
import { addReport, type IncidentReport, type ReportCategory } from "../lib/api";
import Modal from "./ui/Modal";

export const REPORT_LABEL: Record<ReportCategory, string> = {
  harassment: "Harassment",
  followed: "Being followed",
  suspicious: "Suspicious activity",
  poor_lighting: "Poor lighting",
  unsafe_crowd: "Unsafe crowd",
  other: "Other",
};

type Props = {
  point: { lat: number; lng: number; label: string } | null;
  onClose: () => void;
  onSaved: (r: IncidentReport) => void;
};

/** "Report unsafe spot": category + optional note at a map point. Raises nearby street risk for 2 h. */
export default function ReportIncident({ point, onClose, onSaved }: Props) {
  const [category, setCategory] = useState<ReportCategory>("harassment");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!point) return;
    setSaving(true);
    setError(null);
    try {
      const r = await addReport({ category, note: note.trim(), lat: point.lat, lng: point.lng });
      setNote("");
      onSaved(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save the report.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open={point !== null} onClose={onClose} title="Report unsafe spot" icon={<Flag className="h-5 w-5" aria-hidden />}>
      <p className="-mt-2 mb-4 text-sm text-ink-soft">
        {point?.label}. Streets within 150 m count as riskier for the next 2 hours (fading out), and active trips nearby are
        offered a safer route.
      </p>
      <fieldset>
        <legend className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-soft">What happened</legend>
        <div className="flex flex-wrap gap-2">
          {(Object.keys(REPORT_LABEL) as ReportCategory[]).map((c) => (
            <button
              key={c}
              type="button"
              aria-pressed={category === c}
              onClick={() => setCategory(c)}
              className={`rounded-full px-3 py-1.5 text-sm font-semibold ring-1 transition ${
                category === c ? "bg-brand-800 text-white ring-brand-800" : "bg-white text-ink ring-line hover:ring-brand-300"
              }`}
            >
              {REPORT_LABEL[c]}
            </button>
          ))}
        </div>
      </fieldset>
      <label className="mt-4 block text-xs font-semibold uppercase tracking-wide text-ink-soft">
        Note <span className="font-normal normal-case">(optional, no names please)</span>
        <textarea
          value={note}
          maxLength={300}
          onChange={(e) => setNote(e.target.value)}
          rows={3}
          className="mt-1.5 w-full rounded-xl border border-line px-3 py-2 text-sm normal-case tracking-normal text-ink focus:border-brand-teal focus:outline-none focus:ring-4 focus:ring-brand-teal/15"
        />
      </label>
      {error && <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
      <button
        type="button"
        disabled={saving}
        onClick={() => void submit()}
        className="mt-4 inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-brand-800 font-semibold text-white transition hover:bg-brand-700 disabled:opacity-60"
      >
        <Flag className="h-4 w-4" aria-hidden />
        {saving ? "Saving…" : "Submit report"}
      </button>
    </Modal>
  );
}
