import {
  ArrowRight,
  AtSign,
  Backpack,
  Brain,
  BriefcaseBusiness,
  Database,
  GraduationCap,
  Layers,
  Menu,
  MessageSquareWarning,
  Mic,
  Moon,
  PhoneIncoming,
  Route,
  Share2,
  ShieldCheck,
  Siren,
  Sparkles,
  X,
  type LucideIcon,
} from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useState } from "react";
import { Link } from "react-router";
import PhoneMock from "../components/landing/PhoneMock";
import { LinkButton } from "../components/ui/Button";
import Logo from "../components/ui/Logo";
import { Counter, Reveal } from "../components/ui/Reveal";
import { getModelSummary, type ModelSummary } from "../lib/api";
import { useAuth } from "../lib/auth";

const NAV = [
  { href: "#features", label: "Features" },
  { href: "#how", label: "How it works" },
  { href: "#model", label: "AI Model" },
  { href: "#safety", label: "Safety Tools" },
];

// ------------------------------------------------------------------ navbar
function LandingNav() {
  const { user, loading } = useAuth();
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const solid = scrolled || open;
  return (
    <header
      className={`fixed inset-x-0 top-0 z-50 transition-all duration-300 ${
        solid ? "border-b border-white/10 bg-brand-950/75 shadow-lg backdrop-blur-xl" : "bg-transparent"
      }`}
    >
      <nav aria-label="Main" className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        <Link to="/" aria-label="WAYRA home" className="rounded-lg">
          <Logo tone="light" />
        </Link>
        <ul className="hidden items-center gap-1 md:flex">
          {NAV.map((n) => (
            <li key={n.href}>
              <a href={n.href} className="rounded-lg px-3 py-2 text-sm font-medium text-white/80 transition hover:bg-white/10 hover:text-white">
                {n.label}
              </a>
            </li>
          ))}
        </ul>
        <div className={`hidden items-center gap-2 transition-opacity md:flex ${loading ? "invisible opacity-0" : "opacity-100"}`}>
          {user ? (
            <LinkButton to="/app" variant="teal" size="sm">
              Open App <ArrowRight className="h-4 w-4" aria-hidden />
            </LinkButton>
          ) : (
            <>
              <LinkButton to="/login" variant="ghost-light" size="sm">
                Log in
              </LinkButton>
              <LinkButton to="/register" variant="teal" size="sm">
                Sign up
              </LinkButton>
            </>
          )}
        </div>
        <button
          type="button"
          className="flex h-10 w-10 items-center justify-center rounded-xl text-white hover:bg-white/10 md:hidden"
          aria-label={open ? "Close menu" : "Open menu"}
          aria-expanded={open}
          aria-controls="mobile-menu"
          onClick={() => setOpen((o) => !o)}
        >
          {open ? <X className="h-6 w-6" aria-hidden /> : <Menu className="h-6 w-6" aria-hidden />}
        </button>
      </nav>
      <AnimatePresence>
        {open && (
          <motion.div
            id="mobile-menu"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden border-t border-white/10 md:hidden"
          >
            <ul className="space-y-1 px-4 py-3">
              {NAV.map((n) => (
                <li key={n.href}>
                  <a href={n.href} onClick={() => setOpen(false)} className="block rounded-xl px-3 py-3 text-base font-medium text-white/90 hover:bg-white/10">
                    {n.label}
                  </a>
                </li>
              ))}
            </ul>
            <div className="flex gap-2 px-4 pb-4">
              {user ? (
                <LinkButton to="/app" variant="teal" className="flex-1">
                  Open App
                </LinkButton>
              ) : (
                <>
                  <LinkButton to="/login" variant="outline-light" className="flex-1">
                    Log in
                  </LinkButton>
                  <LinkButton to="/register" variant="teal" className="flex-1">
                    Sign up
                  </LinkButton>
                </>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  );
}

// ------------------------------------------------------------------ hero
function Hero() {
  const { user } = useAuth();
  const reduce = useReducedMotion();
  const fade = (d: number) =>
    reduce ? {} : { initial: { opacity: 0, y: 16 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.6, delay: d } };
  return (
    <section className="relative overflow-hidden bg-brand-950 text-white">
      {/* background: gradient, street grid, glows */}
      <div aria-hidden className="absolute inset-0 bg-[radial-gradient(120%_80%_at_80%_10%,#4a2d80_0%,#2a1450_40%,#170a31_75%)]" />
      <div
        aria-hidden
        className="absolute inset-0 opacity-[0.07] [background-image:linear-gradient(#fff_1px,transparent_1px),linear-gradient(90deg,#fff_1px,transparent_1px)] [background-size:56px_56px] [mask-image:radial-gradient(70%_60%_at_50%_40%,#000,transparent)]"
      />
      <div aria-hidden className="absolute -left-32 top-40 h-80 w-80 rounded-full bg-brand-teal/20 blur-3xl" />
      <div className="relative mx-auto grid max-w-6xl items-center gap-14 px-4 pb-32 pt-28 sm:px-6 lg:grid-cols-[1.1fr_0.9fr] lg:pb-40 lg:pt-36">
        <div className="text-center lg:text-left">
          <motion.p
            {...fade(0)}
            className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs font-medium text-brand-teal-light backdrop-blur"
          >
            <Sparkles className="h-3.5 w-3.5" aria-hidden /> AI safety routing · Pilot: Chicago
          </motion.p>
          <motion.h1 {...fade(0.08)} className="mt-5 text-4xl font-bold leading-[1.05] sm:text-6xl lg:text-[4.2rem]">
            Navigate Safely,
            <br />
            <span className="bg-gradient-to-r from-brand-teal-light via-brand-teal to-brand-300 bg-clip-text text-transparent">
              Live Fearlessly
            </span>
          </motion.h1>
          <motion.p {...fade(0.16)} className="mx-auto mt-5 max-w-xl text-lg leading-relaxed text-white/75 lg:mx-0">
            Most maps find the fastest way. WAYRA finds the <strong className="font-semibold text-white">safest</strong> walking
            route, scoring every street with an AI model trained on real crime data, lighting and activity.
          </motion.p>
          <motion.div {...fade(0.24)} className="mt-8 flex flex-col items-center gap-3 sm:flex-row sm:justify-center lg:justify-start">
            <LinkButton to={user ? "/app" : "/register"} variant="teal" size="lg" className="w-full sm:w-auto">
              Find a safe route <ArrowRight className="h-5 w-5" aria-hidden />
            </LinkButton>
            <a
              href="#how"
              className="inline-flex h-13 w-full items-center justify-center gap-2 rounded-xl px-6 font-semibold text-white ring-1 ring-white/25 transition hover:-translate-y-px hover:bg-white/10 active:scale-[0.98] sm:w-auto"
            >
              See how it works
            </a>
          </motion.div>
          <motion.ul {...fade(0.32)} className="mt-8 flex flex-wrap justify-center gap-x-5 gap-y-2 text-sm text-white/65 lg:justify-start">
            {["Real Chicago crime data", "Tested on unseen months", "Night-safe after sunset"].map((t) => (
              <li key={t} className="flex items-center gap-1.5">
                <ShieldCheck className="h-4 w-4 text-brand-teal-light" aria-hidden /> {t}
              </li>
            ))}
          </motion.ul>
        </div>
        <motion.div
          initial={reduce ? false : { opacity: 0, y: 30, rotate: 2 }}
          animate={{ opacity: 1, y: 0, rotate: 0 }}
          transition={{ duration: 0.8, delay: 0.2, ease: [0.22, 1, 0.36, 1] }}
        >
          <PhoneMock />
        </motion.div>
      </div>
    </section>
  );
}

// ------------------------------------------------------------------ problem strip
const STATS = [
  { value: 84, fmt: (v: number) => `${Math.round(v)}%`, text: "of women feel unsafe walking alone after dark" },
  { value: 3, fmt: (v: number) => `1 in ${Math.max(1, Math.round(v))}`, text: "women experience violence in their lifetime" },
  { value: 65, fmt: (v: number) => `${Math.round(v)}%`, text: "avoid certain routes or areas out of fear" },
];

function ProblemStrip() {
  return (
    <section aria-labelledby="problem-title" className="relative z-10 mx-auto -mt-20 max-w-6xl px-4 sm:px-6">
      <h2 id="problem-title" className="sr-only">
        The problem
      </h2>
      <div className="grid gap-4 sm:grid-cols-3">
        {STATS.map((s, i) => (
          <Reveal key={s.text} delay={i * 0.08}>
            <div className="h-full rounded-2xl bg-white p-6 shadow-[var(--shadow-lift)] ring-1 ring-line transition hover:-translate-y-1">
              <Counter value={s.value} format={s.fmt} className="font-display text-4xl font-bold text-brand-800 sm:text-5xl" />
              <p className="mt-2 text-sm leading-relaxed text-ink-soft">{s.text}</p>
            </div>
          </Reveal>
        ))}
      </div>
      <p className="mt-3 text-center text-xs text-ink-soft sm:text-right">Source: WAYRA pitch research (survey and published studies).</p>
    </section>
  );
}

// ------------------------------------------------------------------ features
type Feature = { icon: LucideIcon; title: string; text: string; status: "live" | "preview" | "next" };

const NAVIGATE: Feature[] = [
  { icon: Route, title: "Safest-route navigation", text: "Compare Safest, Balanced and Fastest walks side by side, with the time cost of every safety gain.", status: "live" },
  { icon: Layers, title: "AI risk heatmap", text: "See relative street risk across Chicago for any 2-hour window, or jump to the next two hours.", status: "live" },
  { icon: Moon, title: "Night-safe mode", text: "Turns on automatically after sunset, weighting risk more and steering towards lit main roads.", status: "live" },
  { icon: Share2, title: "Live trip sharing", text: "Trusted contacts follow your walk live and are alerted if you go off route, stop for too long, or arrive safely.", status: "live" },
];
const TOOLS: Feature[] = [
  { icon: Siren, title: "One-tap SOS", text: "Send your live location to trusted contacts with a 5-second cancel window and a direct 911 button.", status: "live" },
  { icon: Mic, title: "Voice SOS", text: "Say “help help” or “WAYRA help” to start an SOS hands-free (Chrome and Edge).", status: "live" },
  { icon: PhoneIncoming, title: "Fake call", text: "A realistic incoming call on demand, to step out of an uncomfortable situation.", status: "live" },
  { icon: MessageSquareWarning, title: "Offline SMS alerts", text: "No signal for data? SOS falls back to a pre-filled SMS with your last known location.", status: "live" },
];

const STATUS_LABEL = { live: "Live in pilot", preview: "Preview", next: "Coming next" } as const;

function FeatureCard({ f, dark = false }: { f: Feature; dark?: boolean }) {
  const Icon = f.icon;
  return (
    <div
      className={`group h-full rounded-2xl p-6 transition duration-300 hover:-translate-y-1 ${
        dark
          ? "bg-white/[0.06] ring-1 ring-white/10 hover:bg-white/[0.09]"
          : "bg-white shadow-[var(--shadow-card)] ring-1 ring-line hover:shadow-[var(--shadow-lift)]"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <span
          className={`flex h-12 w-12 items-center justify-center rounded-xl transition group-hover:scale-105 ${
            dark ? "bg-brand-teal/15 text-brand-teal-light" : "bg-brand-50 text-brand-700"
          }`}
        >
          <Icon className="h-6 w-6" aria-hidden />
        </span>
        <span
          className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${
            f.status === "live"
              ? dark
                ? "bg-brand-teal/20 text-brand-teal-light"
                : "bg-brand-teal/10 text-brand-teal-dark"
              : dark
                ? "bg-white/10 text-white/70"
                : "bg-brand-50 text-brand-600"
          }`}
        >
          {STATUS_LABEL[f.status]}
        </span>
      </div>
      <h3 className={`mt-5 text-lg font-semibold ${dark ? "text-white" : "text-ink"}`}>{f.title}</h3>
      <p className={`mt-2 text-sm leading-relaxed ${dark ? "text-white/70" : "text-ink-soft"}`}>{f.text}</p>
    </div>
  );
}

function SectionHead({ eyebrow, title, text, dark = false }: { eyebrow: string; title: string; text?: string; dark?: boolean }) {
  return (
    <Reveal className="mx-auto max-w-2xl text-center">
      <p className={`text-sm font-semibold uppercase tracking-[0.18em] ${dark ? "text-brand-teal-light" : "text-brand-teal-dark"}`}>{eyebrow}</p>
      <h2 className={`mt-3 text-3xl font-bold sm:text-4xl ${dark ? "text-white" : "text-ink"}`}>{title}</h2>
      {text && <p className={`mt-4 text-base leading-relaxed ${dark ? "text-white/70" : "text-ink-soft"}`}>{text}</p>}
    </Reveal>
  );
}

function Features() {
  return (
    <section id="features" className="mx-auto max-w-6xl px-4 py-24 sm:px-6">
      <SectionHead
        eyebrow="Features"
        title="Built around the walk home"
        text="Everything WAYRA does starts from one question: which way is safest right now? Then it backs you up if something goes wrong."
      />
      <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {NAVIGATE.map((f, i) => (
          <Reveal key={f.title} delay={i * 0.06}>
            <FeatureCard f={f} />
          </Reveal>
        ))}
      </div>
    </section>
  );
}

function SafetyTools() {
  return (
    <section id="safety" className="relative overflow-hidden bg-brand-950 py-24 text-white">
      <div aria-hidden className="absolute inset-0 bg-[radial-gradient(60%_60%_at_20%_0%,#3b1f6b_0%,transparent_70%)]" />
      <div className="relative mx-auto max-w-6xl px-4 sm:px-6">
        <SectionHead
          dark
          eyebrow="Safety tools"
          title="Help is always one tap away"
          text="Escape and alert tools for the moments a route can't prevent. Messaging is simulated during the pilot, and WAYRA never dials anyone without you."
        />
        <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {TOOLS.map((f, i) => (
            <Reveal key={f.title} delay={i * 0.06}>
              <FeatureCard f={f} dark />
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

// ------------------------------------------------------------------ how it works
const STEPS: { icon: LucideIcon; title: string; text: string }[] = [
  { icon: Database, title: "Crime data", text: "Public Chicago crime records since 2022, filtered to street incidents and weighted by severity, plus lighting and activity from OpenStreetMap." },
  { icon: Brain, title: "AI safety score", text: "A LightGBM model predicts risk for every ~0.1 km² hexagon and 2-hour window, then scores each of 1.1 M street segments." },
  { icon: Route, title: "Colour-coded route", text: "The router trades a little distance for safer streets and shows every segment in green, amber or red." },
];

function HowItWorks() {
  return (
    <section id="how" className="bg-white py-24">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <SectionHead eyebrow="How it works" title="From open data to a safer walk" />
        <div className="relative mt-14">
          {/* connecting line */}
          <div aria-hidden className="absolute left-7 top-7 h-[calc(100%-3.5rem)] w-0.5 bg-gradient-to-b from-brand-300 via-brand-teal to-brand-300 md:left-[16.66%] md:right-[16.66%] md:top-7 md:h-0.5 md:w-auto md:bg-gradient-to-r" />
        <ol className="relative grid gap-10 md:grid-cols-3 md:gap-8">
          {STEPS.map((s, i) => {
            const Icon = s.icon;
            return (
              <li key={s.title} className="relative">
                <Reveal delay={i * 0.12} className="flex gap-5 md:flex-col md:items-center md:text-center">
                  <span className="relative z-10 flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-brand-800 text-white shadow-[var(--shadow-lift)] ring-4 ring-white">
                    <Icon className="h-6 w-6" aria-hidden />
                    <span className="absolute -right-2 -top-2 flex h-6 w-6 items-center justify-center rounded-full bg-brand-teal font-display text-xs font-bold text-brand-950 ring-2 ring-white">
                      {i + 1}
                    </span>
                  </span>
                  <div>
                    <h3 className="text-xl font-semibold text-ink md:mt-5">{s.title}</h3>
                    <p className="mt-2 text-sm leading-relaxed text-ink-soft">{s.text}</p>
                    {i === 2 && (
                      <div className="mt-4 flex h-2 w-40 gap-[3px] md:mx-auto" role="img" aria-label="Route segments: green lower risk, amber moderate, red higher">
                        <span className="h-full w-[55%] rounded-l-full bg-safe" />
                        <span className="h-full w-[30%] bg-caution" />
                        <span className="h-full w-[15%] rounded-r-full bg-danger" />
                      </div>
                    )}
                  </div>
                </Reveal>
              </li>
            );
          })}
        </ol>
        </div>
      </div>
    </section>
  );
}

// ------------------------------------------------------------------ AI model
function monthRange(r: string | null): string | null {
  if (!r) return null;
  const f = (ym: string) => {
    const [y, m] = ym.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
  };
  const [a, b] = r.split("..");
  return b ? `${f(a)} – ${f(b)}` : f(a);
}

function CompareBar({ model, base, max = 1 }: { model: number; base: number; max?: number }) {
  return (
    <div className="mt-5 space-y-2 text-xs">
      {[
        { l: "WAYRA model", v: model, c: "bg-gradient-to-r from-brand-600 to-brand-teal" },
        { l: "Baseline", v: base, c: "bg-brand-200" },
      ].map((r) => (
        <div key={r.l}>
          <div className="mb-1 flex justify-between text-ink-soft">
            <span>{r.l}</span>
            <span className="tabular-nums">{max === 1 ? r.v.toFixed(2) : `${Math.round(r.v * 100)}%`}</span>
          </div>
          <div className="h-2 rounded-full bg-brand-50">
            <motion.div
              className={`h-full rounded-full ${r.c}`}
              initial={{ width: 0 }}
              whileInView={{ width: `${(r.v / (max === 1 ? 1 : max)) * 100}%` }}
              viewport={{ once: true }}
              transition={{ duration: 1.2, ease: [0.16, 1, 0.3, 1] }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

function ModelSection() {
  const { user } = useAuth();
  const [m, setM] = useState<ModelSummary | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    getModelSummary()
      .then(setM)
      .catch(() => setFailed(true));
  }, []);
  const ready = m && m.roc_auc !== null && m.roc_auc_baseline !== null && m.hit_rate_top10pct !== null && m.hit_rate_top10pct_baseline !== null;
  return (
    <section id="model" className="mx-auto max-w-6xl px-4 py-24 sm:px-6">
      <SectionHead
        eyebrow="AI model"
        title="Measured, not marketed"
        text="These numbers come live from our latest training run, scored on recent months the model never saw. No hand-picked demos."
      />
      <div className="mt-12 grid gap-5 lg:grid-cols-3">
        {!ready && !failed &&
          [0, 1, 2].map((i) => <div key={i} className="h-56 animate-pulse rounded-2xl bg-white ring-1 ring-line" aria-hidden />)}
        {failed && !ready && (
          <p role="status" className="rounded-2xl bg-white p-6 text-center text-sm text-ink-soft ring-1 ring-line lg:col-span-3">
            Live model metrics appear here when the WAYRA server is running.
          </p>
        )}
        {ready && m && (
          <>
            <Reveal>
              <div className="h-full rounded-2xl bg-white p-6 shadow-[var(--shadow-card)] ring-1 ring-line">
                <p className="text-sm font-semibold text-ink-soft">Ranking accuracy (ROC-AUC)</p>
                <Counter value={m.roc_auc!} format={(v) => v.toFixed(2)} className="mt-2 block font-display text-5xl font-bold text-brand-800" />
                <p className="mt-1 text-sm text-ink-soft">vs {m.roc_auc_baseline!.toFixed(2)} for a past-frequency baseline</p>
                <CompareBar model={m.roc_auc!} base={m.roc_auc_baseline!} />
              </div>
            </Reveal>
            <Reveal delay={0.08}>
              <div className="h-full rounded-2xl bg-white p-6 shadow-[var(--shadow-card)] ring-1 ring-line">
                <p className="text-sm font-semibold text-ink-soft">Incidents in the top 10% riskiest areas</p>
                <Counter value={m.hit_rate_top10pct! * 100} format={(v) => `${Math.round(v)}%`} className="mt-2 block font-display text-5xl font-bold text-brand-800" />
                <p className="mt-1 text-sm text-ink-soft">of all test-period incidents, vs {Math.round(m.hit_rate_top10pct_baseline! * 100)}% for the baseline</p>
                <CompareBar model={m.hit_rate_top10pct!} base={m.hit_rate_top10pct_baseline!} max={0.6} />
              </div>
            </Reveal>
            <Reveal delay={0.16}>
              <div className="flex h-full flex-col rounded-2xl bg-gradient-to-br from-brand-800 to-brand-950 p-6 text-white shadow-[var(--shadow-lift)]">
                <p className="text-sm font-semibold text-brand-teal-light">Honest by design</p>
                <ul className="mt-3 flex-1 space-y-2.5 text-sm text-white/80">
                  {monthRange(m.test_months) && <li>Tested on {monthRange(m.test_months)}, after training ended.</li>}
                  {m.n_cells && <li>{m.n_cells.toLocaleString()} hexagons across Chicago, 12 time windows each.</li>}
                  <li>Lighting and crowds are estimates from OpenStreetMap, and we say so in the app.</li>
                </ul>
                <Link to={user ? "/model" : "/register"} className="mt-5 inline-flex items-center gap-1.5 text-sm font-semibold text-brand-teal-light hover:text-white">
                  {user ? "Read the full model card" : "Sign up to read the full model card"} <ArrowRight className="h-4 w-4" aria-hidden />
                </Link>
              </div>
            </Reveal>
          </>
        )}
      </div>
    </section>
  );
}

// ------------------------------------------------------------------ audience
const AUDIENCE: { icon: LucideIcon; title: string; text: string }[] = [
  { icon: GraduationCap, title: "College students", text: "Late labs, library nights and the walk back to the dorm or the train." },
  { icon: BriefcaseBusiness, title: "Working professionals", text: "Evening shifts and late commutes, with a route that adapts after sunset." },
  { icon: Backpack, title: "Solo travellers", text: "New city, unfamiliar streets: know which blocks locals would steer you away from." },
];

function Audience() {
  return (
    <section className="bg-white py-24">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <SectionHead eyebrow="Who it's for" title="For anyone who's ever walked a little faster" />
        <div className="mt-12 grid gap-5 md:grid-cols-3">
          {AUDIENCE.map((a, i) => {
            const Icon = a.icon;
            return (
              <Reveal key={a.title} delay={i * 0.08}>
                <div className="h-full rounded-2xl bg-canvas p-7 ring-1 ring-line transition hover:-translate-y-1 hover:shadow-[var(--shadow-card)]">
                  <span className="flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-brand-600 to-brand-800 text-white">
                    <Icon className="h-6 w-6" aria-hidden />
                  </span>
                  <h3 className="mt-5 text-xl font-semibold text-ink">{a.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-ink-soft">{a.text}</p>
                </div>
              </Reveal>
            );
          })}
        </div>
      </div>
    </section>
  );
}

// ------------------------------------------------------------------ CTA + footer
function CtaBand() {
  const { user } = useAuth();
  return (
    <section className="px-4 py-20 sm:px-6">
      <Reveal>
        <div className="relative mx-auto max-w-5xl overflow-hidden rounded-3xl bg-gradient-to-br from-brand-700 via-brand-800 to-brand-950 px-6 py-14 text-center text-white shadow-[var(--shadow-lift)] sm:px-12">
          <div aria-hidden className="absolute -right-20 -top-20 h-64 w-64 rounded-full bg-brand-teal/25 blur-3xl" />
          <h2 className="relative text-3xl font-bold sm:text-4xl">Your walk home deserves a safer route.</h2>
          <p className="relative mx-auto mt-4 max-w-xl text-white/75">Try WAYRA on Chicago's streets today. It takes less than a minute to sign up.</p>
          <div className="relative mt-8 flex flex-col justify-center gap-3 sm:flex-row">
            <LinkButton to={user ? "/app" : "/register"} variant="teal" size="lg">
              {user ? "Open the app" : "Create free account"} <ArrowRight className="h-5 w-5" aria-hidden />
            </LinkButton>
            {!user && (
              <LinkButton to="/login" variant="outline-light" size="lg">
                Log in
              </LinkButton>
            )}
          </div>
        </div>
      </Reveal>
    </section>
  );
}

function Footer() {
  return (
    <footer className="border-t border-line bg-white">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-10 sm:px-6 md:flex-row md:items-center md:justify-between">
        <div>
          <Logo sub="Navigate Safely, Live Fearlessly" />
          <p className="mt-4 max-w-md text-xs leading-relaxed text-ink-soft">
            Pilot: Chicago · Data from the City of Chicago Open Data Portal &amp; OpenStreetMap contributors. Risk scores are
            relative estimates, not guarantees. In an emergency, call 911.
          </p>
        </div>
        <div className="flex flex-col gap-3 text-sm md:items-end">
          <ul className="flex flex-wrap gap-x-5 gap-y-2 text-ink-soft">
            {NAV.map((n) => (
              <li key={n.href}>
                <a href={n.href} className="hover:text-brand-700">
                  {n.label}
                </a>
              </li>
            ))}
          </ul>
          <p className="inline-flex items-center gap-1.5 font-medium text-brand-700">
            <AtSign className="h-4 w-4" aria-hidden /> wayra.saferoute
          </p>
          <p className="text-xs text-ink-soft">© {new Date().getFullYear()} WAYRA</p>
        </div>
      </div>
    </footer>
  );
}

export default function LandingPage() {
  return (
    <div className="min-h-full bg-canvas">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[60] focus:rounded-lg focus:bg-white focus:px-4 focus:py-2 focus:text-brand-800">
        Skip to content
      </a>
      <LandingNav />
      <main id="main">
        <Hero />
        <ProblemStrip />
        <Features />
        <HowItWorks />
        <ModelSection />
        <SafetyTools />
        <Audience />
        <CtaBand />
      </main>
      <Footer />
    </div>
  );
}
