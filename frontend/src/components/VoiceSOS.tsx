import { Mic, MicOff } from "lucide-react";
import { useSafety } from "../lib/safety";

/** Compact on/off switch for Voice SOS with a live "listening" indicator. */
export function VoiceToggle({ compact = false }: { compact?: boolean }) {
  const { voice, setVoiceEnabled } = useSafety();
  const on = voice.enabled;
  return (
    <div>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        onClick={() => setVoiceEnabled(!on)}
        title={voice.supported ? 'Say "help help" or "WAYRA help" to start an SOS' : "Needs Chrome or Edge"}
        className={`inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold ring-1 transition ${
          on ? "bg-brand-800 text-white ring-brand-800" : "bg-white text-ink ring-line hover:ring-brand-300"
        } ${!voice.supported ? "opacity-70" : ""}`}
      >
        {on ? <Mic className="h-4 w-4" aria-hidden /> : <MicOff className="h-4 w-4" aria-hidden />}
        {compact ? "Voice" : "Voice SOS"}
        {on && voice.listening && (
          <span className="relative flex h-2 w-2" aria-hidden>
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand-teal-light" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-brand-teal-light" />
          </span>
        )}
      </button>
      {voice.error && <p className="mt-1.5 max-w-xs text-xs text-red-700">{voice.error}</p>}
      {!voice.supported && !voice.error && !compact && (
        <p className="mt-1.5 max-w-xs text-xs text-ink-soft">Voice SOS works in Chrome and Edge. This browser has no speech recognition.</p>
      )}
    </div>
  );
}

/** Navbar pill while Voice SOS is listening, so it's never on silently. */
export function VoiceListeningPill() {
  const { voice, setVoiceEnabled } = useSafety();
  if (!voice.enabled) return null;
  return (
    <button
      type="button"
      onClick={() => setVoiceEnabled(false)}
      title={voice.heard ? `Heard: “${voice.heard}”. Click to turn Voice SOS off.` : 'Listening for "help help" or "WAYRA help". Click to turn off.'}
      className="inline-flex items-center gap-1.5 rounded-full bg-brand-50 px-2.5 py-1 text-xs font-semibold text-brand-800 ring-1 ring-brand-200 transition hover:bg-brand-100"
    >
      <span className="relative flex h-2 w-2" aria-hidden>
        {voice.listening && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand-teal" />}
        <span className={`relative inline-flex h-2 w-2 rounded-full ${voice.listening ? "bg-brand-teal" : "bg-ink-soft/50"}`} />
      </span>
      <Mic className="h-3.5 w-3.5" aria-hidden />
      <span className="hidden sm:inline">{voice.listening ? "Listening" : "Voice SOS"}</span>
      <span className="sr-only">{voice.listening ? "Voice SOS is listening. Activate to turn off." : "Voice SOS paused. Activate to turn off."}</span>
    </button>
  );
}
