/**
 * Voice SOS: continuous Web Speech API listening for "help help" or "wayra help".
 * Works in Chrome and Edge (webkitSpeechRecognition). Recognition runs in the browser vendor's
 * cloud service in Chrome, so it needs a connection. The toggle is remembered per browser.
 */
import { useCallback, useEffect, useRef, useState } from "react";

type SpeechAlt = { transcript: string };
type SpeechResultList = { length: number; [i: number]: { isFinal: boolean; 0: SpeechAlt } };
type SpeechEvent = { resultIndex: number; results: SpeechResultList };
type SpeechErrorEvent = { error: string };
interface Recognition {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((e: SpeechEvent) => void) | null;
  onerror: ((e: SpeechErrorEvent) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type RecognitionCtor = new () => Recognition;

function recognitionCtor(): RecognitionCtor | null {
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export const voiceSupported = (): boolean => typeof window !== "undefined" && recognitionCtor() !== null;

// "wayra" is a new word for recognisers, so accept common mishearings too.
const WAKE = "(?:wayra|way ra|wayrah|waira|wyra|weyra|vayra|vaira|wire a|why ra|vera|wera|baira|bayra)";
const TRIGGER = new RegExp(`\\b(?:help[\\s,.!]+help|${WAKE}[\\s,.!]+help)\\b`, "i");

/** True if a transcript contains one of the trigger phrases. Exported for tests/explanations. */
export function isTriggerPhrase(text: string): boolean {
  return TRIGGER.test(text.toLowerCase().replace(/[^a-z\s,.!]/g, " ").replace(/\s+/g, " "));
}

export type VoiceState = {
  supported: boolean;
  enabled: boolean;
  listening: boolean;
  error: string | null;
  heard: string | null;
};

const KEY = "wayra.voiceSOS";

/** Returns [state, setEnabled]. `active` pauses listening (signed out, or an SOS is in progress). */
export function useVoiceSOS(active: boolean, onTrigger: () => void): [VoiceState, (on: boolean) => void] {
  const supported = voiceSupported();
  const [enabled, setEnabledState] = useState<boolean>(() => {
    try {
      return supported && localStorage.getItem(KEY) === "1";
    } catch {
      return false;
    }
  });
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [heard, setHeard] = useState<string | null>(null);
  const trigger = useRef(onTrigger);
  trigger.current = onTrigger;

  const setEnabled = useCallback(
    (on: boolean) => {
      if (on && !supported) {
        setError("Voice SOS needs Chrome or Edge (the Web Speech API isn't available in this browser).");
        return;
      }
      setError(null);
      setEnabledState(on);
      try {
        localStorage.setItem(KEY, on ? "1" : "0");
      } catch {
        /* ignore */
      }
    },
    [supported],
  );

  useEffect(() => {
    const Ctor = recognitionCtor();
    if (!enabled || !active || !Ctor) {
      setListening(false);
      return;
    }
    let stopped = false;
    let restart: number | undefined;
    const rec = new Ctor();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = navigator.language || "en-US";
    rec.onstart = () => setListening(true);
    rec.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const text = e.results[i][0].transcript;
        setHeard(text.trim().slice(-60));
        if (isTriggerPhrase(text)) {
          stopped = true;
          rec.abort();
          setListening(false);
          trigger.current();
          return;
        }
      }
    };
    rec.onerror = (e) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        stopped = true;
        setError("Microphone access was blocked. Allow the microphone for this site to use Voice SOS.");
        setEnabledState(false);
      } else if (e.error === "network") {
        setError("Voice SOS needs an internet connection in this browser.");
      }
    };
    rec.onend = () => {
      setListening(false);
      if (!stopped) restart = window.setTimeout(() => {
        try {
          rec.start();
        } catch {
          /* already started */
        }
      }, 400);
    };
    try {
      rec.start();
    } catch {
      /* ignore */
    }
    return () => {
      stopped = true;
      window.clearTimeout(restart);
      rec.onend = null;
      rec.abort();
      setListening(false);
    };
  }, [enabled, active]);

  return [{ supported, enabled, listening, error, heard }, setEnabled];
}
