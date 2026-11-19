import { ArrowLeft, CircleAlert, Eye, EyeOff, LoaderCircle, Lock, ShieldCheck, type LucideIcon } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { useState, type InputHTMLAttributes, type ReactNode } from "react";
import { Link } from "react-router";
import Logo from "./ui/Logo";

const TRUST = ["Safest-not-fastest walking routes", "AI risk model tested on unseen months", "Nothing is shared unless you choose to"];

/** Split screen: brand panel (left, desktop) + form card (right). Mobile shows a compact brand header. */
export default function AuthLayout({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  const reduce = useReducedMotion();
  return (
    <div className="flex min-h-full bg-canvas">
      {/* brand panel */}
      <aside className="relative hidden w-[46%] max-w-2xl overflow-hidden bg-brand-950 text-white lg:flex lg:flex-col lg:justify-between lg:p-12">
        <div aria-hidden className="absolute inset-0 bg-[radial-gradient(110%_80%_at_0%_0%,#4a2d80_0%,#2a1450_45%,#170a31_80%)]" />
        <div
          aria-hidden
          className="absolute inset-0 opacity-[0.08] [background-image:linear-gradient(#fff_1px,transparent_1px),linear-gradient(90deg,#fff_1px,transparent_1px)] [background-size:48px_48px] [mask-image:radial-gradient(80%_70%_at_30%_40%,#000,transparent)]"
        />
        <div aria-hidden className="absolute -bottom-24 -right-24 h-96 w-96 rounded-full bg-brand-teal/20 blur-3xl" />
        {/* decorative safe path */}
        <svg aria-hidden viewBox="0 0 400 300" className="absolute bottom-14 right-0 w-[62%] opacity-50">
          <path d="M20 260 L120 260 L120 180 L240 180 L240 90 L380 90" fill="none" stroke="#dc2626" strokeWidth="4" strokeDasharray="2 10" strokeLinecap="round" opacity="0.6" />
          <path d="M20 260 L60 260 L60 220 L300 220 L300 140 L380 140 L380 90" fill="none" stroke="#5eead4" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
          <circle cx="20" cy="260" r="8" fill="#fff" />
          <circle cx="380" cy="90" r="8" fill="#14b8a6" stroke="#fff" strokeWidth="3" />
        </svg>

        <Link to="/" className="relative w-fit rounded-lg" aria-label="WAYRA home">
          <Logo tone="light" sub="SafeRoute · Pilot: Chicago" />
        </Link>
        <div className="relative max-w-md">
          <h2 className="text-4xl font-bold leading-tight">
            Navigate Safely,
            <br />
            <span className="text-brand-teal-light">Live Fearlessly.</span>
          </h2>
          <p className="mt-4 text-white/75">
            Walking routes that put your safety first, scored street by street from real crime data, lighting and activity.
          </p>
          <ul className="mt-8 space-y-3">
            {TRUST.map((t) => (
              <li key={t} className="flex items-center gap-3 text-sm text-white/85">
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-brand-teal/15">
                  <ShieldCheck className="h-4 w-4 text-brand-teal-light" aria-hidden />
                </span>
                {t}
              </li>
            ))}
          </ul>
        </div>
        <p className="relative flex items-center gap-2 text-xs text-white/60">
          <Lock className="h-3.5 w-3.5" aria-hidden /> Passwords are hashed with bcrypt and never stored in plain text.
        </p>
      </aside>

      {/* form side */}
      <main className="flex flex-1 flex-col px-4 py-6 sm:px-8">
        <div className="flex items-center justify-between">
          <Link to="/" className="inline-flex items-center gap-1.5 rounded-lg text-sm font-medium text-ink-soft transition hover:text-brand-700">
            <ArrowLeft className="h-4 w-4" aria-hidden /> Back to home
          </Link>
          <Link to="/" className="rounded-lg lg:hidden" aria-label="WAYRA home">
            <Logo />
          </Link>
        </div>
        <div className="flex flex-1 items-center justify-center py-8">
          <motion.div
            initial={reduce ? false : { opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
            className="w-full max-w-md rounded-3xl bg-white p-6 shadow-[var(--shadow-lift)] ring-1 ring-line sm:p-9"
          >
            <h1 className="text-3xl font-bold text-ink">{title}</h1>
            {subtitle && <p className="mt-2 text-sm text-ink-soft">{subtitle}</p>}
            <div className="mt-7">{children}</div>
          </motion.div>
        </div>
        <p className="text-center text-xs text-ink-soft">Pilot: Chicago (data-available city)</p>
      </main>
    </div>
  );
}

type FieldProps = {
  label: string;
  error?: string;
  icon?: LucideIcon;
  hint?: ReactNode;
  /** Optional control rendered inside the input on the right (e.g. show/hide). */
  trailing?: ReactNode;
} & InputHTMLAttributes<HTMLInputElement>;

export function Field({ label, error, id, icon: Icon, hint, trailing, ...input }: FieldProps) {
  const errorId = error ? `${id}-error` : undefined;
  const hintId = hint ? `${id}-hint` : undefined;
  return (
    <div className="mb-4">
      <label htmlFor={id} className="mb-1.5 block text-sm font-semibold text-ink">
        {label}
      </label>
      <div
        className={`flex items-center gap-2.5 rounded-xl border bg-white px-3.5 transition focus-within:ring-4 ${
          error ? "border-red-400 focus-within:ring-red-100" : "border-line focus-within:border-brand-teal focus-within:ring-brand-teal/15"
        }`}
      >
        {Icon && <Icon className={`h-[18px] w-[18px] shrink-0 ${error ? "text-red-500" : "text-brand-400"}`} aria-hidden />}
        <input
          id={id}
          aria-invalid={error ? true : undefined}
          aria-describedby={[errorId, hintId].filter(Boolean).join(" ") || undefined}
          className="min-w-0 flex-1 bg-transparent py-3 text-base text-ink outline-none placeholder:text-slate-400 focus-visible:outline-none"
          {...input}
        />
        {trailing}
      </div>
      {hint && (
        <div id={hintId} className="mt-1.5">
          {hint}
        </div>
      )}
      {error && (
        <p id={errorId} className="mt-1.5 flex items-center gap-1.5 text-sm text-red-700">
          <CircleAlert className="h-4 w-4 shrink-0" aria-hidden /> {error}
        </p>
      )}
    </div>
  );
}

/** Password input with a show/hide toggle. */
export function PasswordField(props: Omit<FieldProps, "type" | "trailing" | "icon">) {
  const [show, setShow] = useState(false);
  return (
    <Field
      {...props}
      icon={Lock}
      type={show ? "text" : "password"}
      trailing={
        <button
          type="button"
          onClick={() => setShow((s) => !s)}
          aria-label={show ? "Hide password" : "Show password"}
          aria-pressed={show}
          className="-mr-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-ink-soft transition hover:bg-brand-50 hover:text-brand-700"
        >
          {show ? <EyeOff className="h-[18px] w-[18px]" aria-hidden /> : <Eye className="h-[18px] w-[18px]" aria-hidden />}
        </button>
      }
    />
  );
}

/** 0..4 from length and character variety (a hint only; the server enforces 8–72 characters). */
export function passwordStrength(pw: string): number {
  if (!pw) return 0;
  let s = 0;
  if (pw.length >= 8) s++;
  if (pw.length >= 12) s++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) s++;
  if (/\d/.test(pw)) s++;
  if (/[^A-Za-z0-9]/.test(pw)) s++;
  return Math.min(4, s);
}

const STRENGTH = ["Too short", "Weak", "Fair", "Good", "Strong"];

/** Brand-coloured strength meter (green/amber/red stay reserved for safety meaning). */
export function StrengthHint({ password }: { password: string }) {
  const s = password.length < 8 ? 0 : Math.max(1, passwordStrength(password));
  return (
    <div aria-live="polite">
      <div className="flex gap-1" aria-hidden>
        {[1, 2, 3, 4].map((i) => (
          <span key={i} className={`h-1.5 flex-1 rounded-full transition ${i <= s ? (s >= 3 ? "bg-brand-teal" : "bg-brand-500") : "bg-brand-100"}`} />
        ))}
      </div>
      <p className="mt-1 text-xs text-ink-soft">
        {password ? (
          <>
            Strength: <span className="font-semibold text-ink">{STRENGTH[s]}</span>
            {s < 3 && " · try 12+ characters with a mix of letters, numbers and symbols"}
          </>
        ) : (
          "At least 8 characters. Longer is stronger."
        )}
      </p>
    </div>
  );
}

export function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div role="alert" className="mb-5 flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 px-3.5 py-3 text-sm text-red-800">
      <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <span>{message}</span>
    </div>
  );
}

export function SubmitButton({ busy, children }: { busy: boolean; children: ReactNode }) {
  return (
    <button
      type="submit"
      disabled={busy}
      aria-busy={busy}
      className="mt-2 inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-brand-800 font-semibold text-white shadow-[var(--shadow-card)] transition hover:-translate-y-px hover:bg-brand-700 hover:shadow-[var(--shadow-lift)] active:translate-y-0 active:scale-[0.99] disabled:cursor-wait disabled:opacity-80"
    >
      {busy && <LoaderCircle className="h-5 w-5 animate-spin" aria-hidden />}
      {busy ? "Please wait…" : children}
    </button>
  );
}
