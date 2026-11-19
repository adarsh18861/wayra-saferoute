import { Moon, Navigation, ShieldCheck } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";

// City grid: streets at these x / y positions (SVG units, viewBox 300 x 560).
const XS = [30, 90, 150, 210, 270];
const YS = [80, 150, 220, 290, 360, 430, 500];
const FASTEST = "M30 500 L30 360 L150 360 L150 220 L210 220 L210 80 L270 80";
const SAFEST = "M30 500 L90 500 L90 430 L210 430 L210 290 L270 290 L270 80";

function Blocks() {
  const out = [];
  for (let i = 0; i < XS.length - 1; i++) {
    for (let j = 0; j < YS.length - 1; j++) {
      const x = XS[i] + 7;
      const y = YS[j] + 7;
      const w = XS[i + 1] - XS[i] - 14;
      const h = YS[j + 1] - YS[j] - 14;
      // a "park" block and a "plaza" block for some variety
      const fill = i === 1 && j === 1 ? "#e2ebe8" : i === 2 && j === 4 ? "#ece6f6" : "#ffffff";
      out.push(<rect key={`${i}-${j}`} x={x} y={y} width={w} height={h} rx={6} fill={fill} stroke="#e4def0" />);
    }
  }
  return <>{out}</>;
}

/** Stylised, animated app preview for the hero: no screenshots, no stock photos. */
export default function PhoneMock() {
  const reduce = useReducedMotion();
  const draw = (delay: number) =>
    reduce
      ? { initial: false as const }
      : {
          initial: { pathLength: 0 },
          animate: { pathLength: 1 },
          transition: { duration: 1.6, delay, ease: [0.65, 0, 0.35, 1] as const },
        };

  return (
    <div className="relative mx-auto w-[min(300px,78vw)]">
      {/* glow behind the phone */}
      <div aria-hidden className="absolute -inset-10 rounded-full bg-brand-teal/25 blur-3xl" />
      <div
        role="img"
        aria-label="Preview of the WAYRA app: a red fastest route cuts through higher-risk streets while a glowing green safest route takes a slightly longer, safer path."
        className="relative overflow-hidden rounded-[2.6rem] border-[10px] border-brand-950 bg-brand-950 shadow-[0_40px_80px_-20px_rgba(0,0,0,0.6)] ring-1 ring-white/15"
      >
        <div className="relative aspect-[300/560] overflow-hidden rounded-[1.9rem] bg-[#f4f1fa]">
          <svg viewBox="0 0 300 560" className="absolute inset-0 h-full w-full" aria-hidden="true">
            <defs>
              <filter id="mock-glow" x="-30%" y="-30%" width="160%" height="160%">
                <feGaussianBlur stdDeviation="5" />
              </filter>
            </defs>
            <rect width="300" height="560" fill="#efebf6" />
            {/* lake on the right */}
            <path d="M284 0 C 270 120, 296 220, 280 320 S 290 480, 286 560 L300 560 L300 0 Z" fill="#cfe3f3" />
            <Blocks />
            {/* fastest: red, dashed */}
            <motion.path d={FASTEST} fill="none" stroke="#dc2626" strokeWidth={5} strokeLinecap="round" strokeLinejoin="round" strokeDasharray="2 9" opacity={0.85} {...draw(0.3)} />
            {/* safest: glowing green */}
            <motion.path d={SAFEST} fill="none" stroke="#16a34a" strokeWidth={14} strokeLinecap="round" strokeLinejoin="round" opacity={0.45} filter="url(#mock-glow)" {...draw(1.1)} />
            <motion.path d={SAFEST} fill="none" stroke="#ffffff" strokeWidth={9} strokeLinecap="round" strokeLinejoin="round" {...draw(1.1)} />
            <motion.path d={SAFEST} fill="none" stroke="#16a34a" strokeWidth={5.5} strokeLinecap="round" strokeLinejoin="round" {...draw(1.1)} />
            {!reduce && (
              <circle r="6" fill="#ffffff" stroke="#14b8a6" strokeWidth="3">
                <animateMotion dur="7s" begin="2.8s" repeatCount="indefinite" path={SAFEST} />
              </circle>
            )}
            {/* A and B */}
            <circle cx="30" cy="500" r="11" fill="#0f766e" stroke="#fff" strokeWidth="3" />
            <text x="30" y="504" textAnchor="middle" fontSize="11" fontWeight="700" fill="#fff" fontFamily="system-ui">A</text>
            <circle cx="270" cy="80" r="11" fill="#3b1f6b" stroke="#fff" strokeWidth="3" />
            <text x="270" y="84" textAnchor="middle" fontSize="11" fontWeight="700" fill="#fff" fontFamily="system-ui">B</text>
          </svg>

          {/* search pill */}
          <div className="absolute inset-x-3 top-3 flex items-center gap-2 rounded-2xl bg-white/95 px-3 py-2.5 shadow-[var(--shadow-card)]">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand-800 text-white">
              <Navigation className="h-3.5 w-3.5" aria-hidden />
            </span>
            <span className="min-w-0 text-[11px] leading-tight">
              <span className="block font-semibold text-ink">Union Station → Navy Pier</span>
              <span className="text-ink-soft">Leaving now · walking</span>
            </span>
          </div>

          {/* bottom sheet */}
          <div className="absolute inset-x-3 bottom-3 rounded-2xl bg-white/95 p-2.5 shadow-[var(--shadow-card)]">
            <div className="grid grid-cols-3 gap-1.5 text-[10px]">
              {[
                { l: "Safest", s: "Safest", c: "bg-emerald-700", on: true },
                { l: "Balanced", s: "Balanced", c: "bg-amber-700", on: false },
                { l: "Fastest", s: "Fastest", c: "bg-red-700", on: false },
              ].map((r) => (
                <div key={r.l} className={`rounded-lg border p-1.5 ${r.on ? "border-brand-700 bg-brand-50" : "border-line"}`}>
                  <span className="block font-semibold text-ink">{r.l}</span>
                  <span className={`mt-1 block h-1.5 w-full rounded-full ${r.c}`} />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* floating safety badge */}
      <motion.div
        initial={reduce ? false : { opacity: 0, y: 12, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ delay: 2.4, duration: 0.5 }}
        className="absolute -right-6 top-[38%] sm:-right-14"
      >
        <div className="animate-float flex items-center gap-2.5 rounded-2xl bg-white px-3.5 py-2.5 shadow-[var(--shadow-lift)] ring-1 ring-black/5">
          <span className="relative flex h-10 w-10 items-center justify-center rounded-full bg-emerald-700 font-display text-base font-bold text-white">
            <span aria-hidden className="absolute inset-0 rounded-full bg-emerald-600 animate-pulse-ring" />
            <ShieldCheck className="relative h-5 w-5" aria-hidden />
          </span>
          <span className="text-xs leading-tight">
            <span className="block font-semibold text-ink">Safest route</span>
            <span className="text-ink-soft">fewer high-risk streets</span>
          </span>
        </div>
      </motion.div>

      {/* floating night chip */}
      <motion.div
        initial={reduce ? false : { opacity: 0, x: -12 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ delay: 2.8, duration: 0.5 }}
        className="absolute -left-5 bottom-[26%] sm:-left-12"
      >
        <div className="flex items-center gap-1.5 rounded-full bg-brand-800 px-3 py-1.5 text-[11px] font-semibold text-white shadow-[var(--shadow-lift)] ring-1 ring-white/20">
          <Moon className="h-3.5 w-3.5 text-brand-teal-light" aria-hidden /> Night-safe mode
        </div>
      </motion.div>
    </div>
  );
}
