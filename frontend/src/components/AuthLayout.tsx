import type { ReactNode } from "react";

/** Branded, mobile-first wrapper shared by the Login and Register pages. */
export default function AuthLayout({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="min-h-full bg-gradient-to-b from-brand-purple via-brand-purple to-brand-purple-light px-4 py-10">
      <div className="mx-auto w-full max-w-sm">
        <div className="mb-8 text-center text-white">
          <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-teal text-2xl font-bold text-brand-purple shadow-lg">
            W
          </div>
          <h1 className="text-3xl font-bold tracking-widest">WAYRA</h1>
          <p className="mt-1 text-sm text-brand-teal-light">Navigate Safely, Live Fearlessly</p>
        </div>
        <div className="rounded-2xl bg-white p-6 shadow-xl">
          <h2 className="mb-5 text-xl font-semibold text-brand-purple">{title}</h2>
          {children}
        </div>
        <p className="mt-6 text-center text-xs text-white/70">Pilot: Chicago (data-available city)</p>
      </div>
    </div>
  );
}

type FieldProps = {
  label: string;
  error?: string;
} & React.InputHTMLAttributes<HTMLInputElement>;

export function Field({ label, error, id, ...input }: FieldProps) {
  const errorId = error ? `${id}-error` : undefined;
  return (
    <div className="mb-4">
      <label htmlFor={id} className="mb-1 block text-sm font-medium text-slate-700">
        {label}
      </label>
      <input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={errorId}
        className={`w-full rounded-lg border px-3 py-2.5 text-base text-slate-900 outline-none transition focus:ring-2 ${
          error
            ? "border-red-500 focus:ring-red-200"
            : "border-slate-300 focus:border-brand-teal focus:ring-brand-teal/30"
        }`}
        {...input}
      />
      {error && (
        <p id={errorId} className="mt-1 text-sm text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}

export function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div role="alert" className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
      {message}
    </div>
  );
}

export function SubmitButton({ busy, children }: { busy: boolean; children: ReactNode }) {
  return (
    <button
      type="submit"
      disabled={busy}
      className="w-full rounded-lg bg-brand-purple py-3 font-semibold text-white transition hover:bg-brand-purple-light disabled:cursor-wait disabled:opacity-70"
    >
      {busy ? "Please wait…" : children}
    </button>
  );
}
