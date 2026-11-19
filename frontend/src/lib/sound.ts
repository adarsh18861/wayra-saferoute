/**
 * Sounds generated with the Web Audio API (no audio files, nothing copyrighted).
 * Browsers only allow audio after a user gesture: call unlockAudio() from a click handler first.
 */
type Ctor = typeof AudioContext;

let ctx: AudioContext | null = null;

export function audioContext(): AudioContext | null {
  if (ctx) return ctx;
  const C: Ctor | undefined =
    window.AudioContext ?? (window as unknown as { webkitAudioContext?: Ctor }).webkitAudioContext;
  if (!C) return null;
  ctx = new C();
  return ctx;
}

/** Call inside a click/tap handler so later sounds are allowed to play. */
export function unlockAudio(): boolean {
  const c = audioContext();
  if (!c) return false;
  if (c.state === "suspended") void c.resume();
  return true;
}

export function audioUnlocked(): boolean {
  return ctx?.state === "running";
}

function tone(c: AudioContext, freq: number, start: number, dur: number, gain = 0.2, type: OscillatorType = "sine"): void {
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, start);
  g.gain.setValueAtTime(0.0001, start);
  g.gain.exponentialRampToValueAtTime(gain, start + 0.015);
  g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  o.connect(g).connect(c.destination);
  o.start(start);
  o.stop(start + dur + 0.05);
}

/** Two-note chime for ordinary alerts. */
export function playChime(): void {
  const c = audioContext();
  if (!c || c.state !== "running") return;
  const t = c.currentTime;
  tone(c, 880, t, 0.35, 0.18);
  tone(c, 1318.5, t + 0.16, 0.5, 0.15);
}

/** Urgent rising siren for an SOS (about 3 s). */
export function playSiren(seconds = 3): void {
  const c = audioContext();
  if (!c || c.state !== "running") return;
  const t = c.currentTime;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = "sawtooth";
  for (let i = 0; i < seconds * 2; i++) {
    o.frequency.setValueAtTime(700, t + i * 0.5);
    o.frequency.linearRampToValueAtTime(1300, t + i * 0.5 + 0.45);
  }
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.12, t + 0.05);
  g.gain.setValueAtTime(0.12, t + seconds - 0.1);
  g.gain.exponentialRampToValueAtTime(0.0001, t + seconds);
  o.connect(g).connect(c.destination);
  o.start(t);
  o.stop(t + seconds + 0.05);
}

/** Short tick for countdowns. */
export function playTick(high = false): void {
  const c = audioContext();
  if (!c || c.state !== "running") return;
  tone(c, high ? 1200 : 900, c.currentTime, 0.12, 0.12, "square");
}

/**
 * Phone ringtone: a bright marimba-like arpeggio, twice, then a pause; repeats until stopped.
 * Returns a stop function.
 */
export function startRingtone(): () => void {
  const c = audioContext();
  if (!c) return () => {};
  if (c.state === "suspended") void c.resume();
  const notes = [659.25, 830.61, 987.77, 1318.5, 987.77, 830.61]; // E5 G#5 B5 E6 B5 G#5
  const play = () => {
    const t = c.currentTime + 0.02;
    for (let rep = 0; rep < 2; rep++) {
      notes.forEach((f, i) => {
        const s = t + rep * 0.9 + i * 0.13;
        tone(c, f, s, 0.32, 0.16, "sine");
        tone(c, f * 2, s, 0.12, 0.04, "triangle");
      });
    }
  };
  play();
  const id = window.setInterval(play, 3000);
  return () => window.clearInterval(id);
}

export function vibrate(pattern: number | number[]): void {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    /* not supported */
  }
}
