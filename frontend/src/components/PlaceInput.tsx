import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { searchPlaces, type Place } from "../lib/api";

const DEBOUNCE_MS = 400;
const MIN_CHARS = 3;

type Props = {
  label: string;
  placeholder: string;
  value: Place | null;
  onChange: (place: Place | null) => void;
  /** Optional button rendered inside the input row (e.g. "Use my location"). */
  action?: ReactNode;
  dotClass: string;
};

/** Text input with debounced Chicago-only place autocomplete. */
export default function PlaceInput({ label, placeholder, value, onChange, action, dotClass }: Props) {
  const id = useId();
  const listId = `${id}-list`;
  const [text, setText] = useState(value?.name ?? "");
  const [results, setResults] = useState<Place[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [status, setStatus] = useState<"idle" | "loading" | "error" | "empty">("idle");
  const [error, setError] = useState("");
  const typed = useRef(false);

  // Show the chosen place's name when it is set (from the list or "Use my location").
  // A null value is ignored so clearing the selection while typing keeps the typed text.
  useEffect(() => {
    if (!value) return;
    typed.current = false;
    setText(value.name);
  }, [value]);

  useEffect(() => {
    if (!typed.current) return;
    const q = text.trim();
    if (q.length < MIN_CHARS) {
      setResults([]);
      setStatus("idle");
      return;
    }
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      setStatus("loading");
      searchPlaces(q, ctrl.signal)
        .then((places) => {
          setResults(places);
          setActive(-1);
          setStatus(places.length ? "idle" : "empty");
        })
        .catch((err: unknown) => {
          if (err instanceof DOMException && err.name === "AbortError") return;
          setResults([]);
          setError(err instanceof Error ? err.message : "Search failed");
          setStatus("error");
        });
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [text]);

  function choose(place: Place) {
    onChange(place);
    setOpen(false);
    setResults([]);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open || results.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => (i + 1) % results.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => (i <= 0 ? results.length - 1 : i - 1));
    } else if (e.key === "Enter" && active >= 0) {
      e.preventDefault();
      choose(results[active]);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  const showList = open && typed.current && text.trim().length >= MIN_CHARS;

  return (
    <div className="relative">
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <div className="flex items-center gap-2 rounded-xl border border-line bg-white px-3 transition focus-within:border-brand-teal focus-within:ring-4 focus-within:ring-brand-teal/15">
        <span aria-hidden className={`h-3 w-3 shrink-0 rounded-full ${dotClass}`} />
        <span className="w-10 shrink-0 text-[11px] font-semibold uppercase tracking-wide text-ink-soft">{label}</span>
        <input
          id={id}
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
          autoComplete="off"
          className="min-w-0 flex-1 bg-transparent py-2.5 text-base text-ink outline-none placeholder:text-slate-400 focus-visible:outline-none"
          placeholder={placeholder}
          value={text}
          onChange={(e) => {
            typed.current = true;
            setText(e.target.value);
            setOpen(true);
            if (value) onChange(null);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={onKeyDown}
        />
        {text && (
          <button
            type="button"
            aria-label={`Clear ${label}`}
            className="shrink-0 px-1 text-lg leading-none text-slate-400 hover:text-slate-600"
            onClick={() => {
              setText("");
              setResults([]);
              onChange(null);
            }}
          >
            ×
          </button>
        )}
        {action}
      </div>
      {showList && (
        <ul
          id={listId}
          role="listbox"
          className="absolute inset-x-0 top-full z-[1100] mt-1.5 max-h-64 overflow-auto rounded-xl border border-line bg-white p-1 shadow-[var(--shadow-lift)]"
        >
          {status === "loading" && <li className="px-3 py-2 text-sm text-slate-500">Searching…</li>}
          {status === "empty" && (
            <li className="px-3 py-2 text-sm text-slate-500">No places found in Chicago</li>
          )}
          {status === "error" && <li className="px-3 py-2 text-sm text-red-600">{error}</li>}
          {results.map((p, i) => (
            <li
              key={`${p.lat},${p.lon},${i}`}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              className={`cursor-pointer rounded-lg px-3 py-2 text-sm text-ink ${i === active ? "bg-brand-50" : "hover:bg-brand-50/60"}`}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => choose(p)}
            >
              {p.name}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
