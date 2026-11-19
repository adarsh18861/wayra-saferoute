import { useEffect, useState } from "react";
import { Link } from "react-router";
import { SafetyScoreExplainer } from "../components/SafetyLegend";
import { friendlyError, getModelCard, type FriendlyError, type MetricSet, type ModelCard } from "../lib/api";

/** Plain-words names for the model's features (ml/03_features.py). */
const FEATURE_LABELS: Record<string, string> = {
  cell_cnt_l12: "Incidents in the area, past 12 months",
  cell_sev_l12: "Severity of incidents in the area, past 12 months",
  cnt_l12: "Incidents in the area at this time of day, past 12 months",
  sev_l12: "Severity at this time of day, past 12 months",
  bucket: "Time of day",
  moy: "Month of the year",
  nb_cell_cnt_l12: "Incidents in neighbouring areas, past 12 months",
  nb_cnt_l12: "Neighbouring areas at this time of day, past 12 months",
  nb_sev_l12: "Severity in neighbouring areas, past 12 months",
  pois: "Shops, transit and venues nearby (crowd estimate)",
  night_pois: "Night-time venues nearby",
  dark_share_l12: "Share of past incidents after dark",
  cell_cnt_l1: "Incidents in the area, last month",
  police_km: "Distance to the nearest police station",
  lamps: "Mapped street lamps",
  cnt_l3: "Incidents at this time of day, past 3 months",
  sev_l3: "Severity at this time of day, past 3 months",
  nb_sev_l3: "Severity in neighbouring areas, past 3 months",
};

function featureLabel(key: string): string {
  return FEATURE_LABELS[key] ?? key.replace(/_/g, " ");
}

const METRICS: { key: keyof MetricSet; name: string; help: string; pct?: boolean }[] = [
  {
    key: "roc_auc",
    name: "ROC-AUC",
    help: "How often a place-and-time that did have an incident is ranked above one that didn't. 0.5 = coin toss, 1.0 = perfect.",
  },
  {
    key: "pr_auc",
    name: "PR-AUC",
    help: "Precision across all alert thresholds. Incidents are rare (about 3% of place-times), so this number is naturally low; higher is better.",
  },
  {
    key: "hit_rate_top10pct",
    name: "Hit rate, top 10%",
    pct: true,
    help: "Share of the test period's incidents that happened in the 10% of areas the model ranked riskiest for that month and time of day.",
  },
];

function fmt(v: number | undefined, pct?: boolean): string {
  if (v === undefined || Number.isNaN(v)) return "–";
  return pct ? `${(v * 100).toFixed(1)}%` : v.toFixed(3);
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
      <h2 className="mb-3 text-lg font-semibold text-brand-purple">{title}</h2>
      {children}
    </section>
  );
}

/** Horizontal bar chart of feature-importance share (single series, sorted, direct value labels). */
function ImportanceChart({ shares }: { shares: Record<string, number> }) {
  const rows = Object.entries(shares)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);
  const max = rows[0]?.[1] ?? 1;
  const rest = Object.values(shares).reduce((s, v) => s + v, 0) - rows.reduce((s, [, v]) => s + v, 0);
  return (
    <figure>
      <ul className="space-y-2" aria-label="Feature importance, share of total gain">
        {rows.map(([k, v]) => (
          <li key={k} className="group" title={`${featureLabel(k)}: ${(v * 100).toFixed(1)}% of the model's total gain`}>
            <div className="mb-0.5 flex items-baseline justify-between gap-2 text-sm">
              <span className="text-slate-800">{featureLabel(k)}</span>
              <span className="shrink-0 tabular-nums text-slate-600">{(v * 100).toFixed(1)}%</span>
            </div>
            <div className="h-2.5 w-full rounded-r bg-slate-100">
              <div
                className="h-full rounded-r bg-brand-purple-light transition group-hover:bg-brand-purple"
                style={{ width: `${Math.max(1, (v / max) * 100)}%` }}
              />
            </div>
          </li>
        ))}
      </ul>
      <figcaption className="mt-3 text-xs text-slate-600">
        Share of LightGBM split gain (top 10 of {Object.keys(shares).length} features
        {rest > 0.0005 ? `; the rest add up to ${(rest * 100).toFixed(1)}%` : ""}). Gain shows what the model leans on,
        not cause and effect.
      </figcaption>
    </figure>
  );
}

function monthRange(r: string | undefined): string {
  if (!r) return "";
  const fmtM = (ym: string) => {
    const [y, m] = ym.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
  };
  const [a, b] = r.split("..");
  return b ? `${fmtM(a)} – ${fmtM(b)}` : fmtM(a);
}

export default function ModelCardPage() {
  const [card, setCard] = useState<ModelCard | null>(null);
  const [error, setError] = useState<FriendlyError | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    getModelCard()
      .then((c) => !cancelled && setCard(c))
      .catch((err: unknown) => !cancelled && setError(friendlyError(err, "model card")));
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  const m = card?.test.model;
  const b = card?.test.baseline;

  return (
    <div className="min-h-full bg-slate-50 pb-28">
      <div className="bg-gradient-to-b from-brand-purple to-brand-purple-light px-4 pb-10 pt-8 text-white">
        <div className="mx-auto max-w-3xl">
          <p className="text-xs font-semibold uppercase tracking-widest text-brand-teal-light">Model card</p>
          <h1 className="mt-1 text-2xl font-bold sm:text-3xl">How WAYRA scores street safety</h1>
          <p className="mt-2 max-w-2xl text-sm text-white/85">
            What the AI risk model learns from, how well it does on months it never saw, and where it falls short. Every
            number on this page comes from the latest training run, not from marketing material.
          </p>
        </div>
      </div>

      <div className="mx-auto -mt-6 max-w-3xl space-y-4 px-4">
        <Section title="In plain words">
          <ul className="space-y-2 text-sm leading-relaxed text-slate-700">
            <li>
              <strong className="text-slate-900">Data.</strong> Chicago's public crime records (City of Chicago, "Crimes – 2001 to
              Present", from 2022 on), filtered to street-safety incidents that happened in public places: assault, battery,
              robbery, sexual offences, stalking, kidnapping, homicide, weapons, and theft from a person. Domestic incidents are left
              out. Each type is weighted by severity.
            </li>
            <li>
              <strong className="text-slate-900">Environment.</strong> OpenStreetMap street lamps and lit-road tags, nearby shops,
              transit and venues (a stand-in for how busy a street is), and distance to police stations.
            </li>
            <li>
              <strong className="text-slate-900">Model.</strong> The city is split into hexagons of about 0.1 km² and the day into
              twelve 2-hour windows. A LightGBM model predicts the chance of at least one incident in each hexagon and window next
              month. It is trained on older months and tested on the most recent ones, so it is always predicting the future.
            </li>
            <li>
              <strong className="text-slate-900">Routes.</strong> Each street takes its hexagon's risk, ranked against every street in
              the city at every time of day. The Safest route trades a little distance for lower-risk streets; Night-safe mode also
              avoids streets likely to be unlit.
            </li>
          </ul>
          <div className="mt-4 rounded-xl bg-slate-900 p-4 text-sm text-white">
            <SafetyScoreExplainer />
          </div>
        </Section>

        <Section title="How well it works (held-out test months)">
          {!card && !error && (
            <div role="status" aria-label="Loading metrics" className="space-y-2">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-10 animate-pulse rounded-lg bg-slate-100" />
              ))}
            </div>
          )}
          {error && (
            <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-900">
              <p className="font-semibold">{error.title}</p>
              <p className="mt-0.5">{error.text}</p>
              <button type="button" onClick={() => setAttempt((a) => a + 1)} className="mt-2 rounded-lg bg-red-700 px-3 py-1.5 text-xs font-semibold text-white">
                Try again
              </button>
            </div>
          )}
          {m && b && (
            <>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[28rem] text-left text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                      <th className="py-2 pr-3 font-semibold">Metric</th>
                      <th className="whitespace-nowrap px-3 py-2 text-right font-semibold">AI model</th>
                      <th className="px-3 py-2 text-right font-semibold">Baseline</th>
                      <th className="py-2 pl-3 text-right font-semibold">Difference</th>
                    </tr>
                  </thead>
                  <tbody>
                    {METRICS.map((x) => {
                      const mv = m[x.key];
                      const bv = b[x.key];
                      const diff = mv !== undefined && bv !== undefined ? mv - bv : undefined;
                      return (
                        <tr key={x.key} className="border-b border-slate-100 align-top last:border-0">
                          <td className="py-2.5 pr-3">
                            <span className="font-semibold text-slate-900">{x.name}</span>
                            <span className="mt-0.5 block text-xs text-slate-600">{x.help}</span>
                          </td>
                          <td className="px-3 py-2.5 text-right font-bold tabular-nums text-brand-purple">{fmt(mv, x.pct)}</td>
                          <td className="px-3 py-2.5 text-right tabular-nums text-slate-700">{fmt(bv, x.pct)}</td>
                          <td className="py-2.5 pl-3 text-right tabular-nums text-slate-700">
                            {diff === undefined ? "–" : `${diff >= 0 ? "+" : "−"}${x.pct ? `${Math.abs(diff * 100).toFixed(1)} pts` : Math.abs(diff).toFixed(3)}`}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p className="mt-3 text-xs leading-relaxed text-slate-600">
                <strong>Baseline:</strong> {card?.definitions?.baseline ?? "past incident frequency in the same place and time"}.{" "}
                {card?.split?.test && <>Test months: {monthRange(card.split.test)}. </>}
                {card?.split?.train && <>Trained on {monthRange(card.split.train)}. </>}
                {card?.rows?.test && <>{card.rows.test.toLocaleString()} test place-time windows</>}
                {card?.test_positive_rate !== undefined && <>, {(card.test_positive_rate * 100).toFixed(1)}% had an incident</>}.
                {card?.n_cells && <> {card.n_cells.toLocaleString()} hexagons modelled.</>}
              </p>
            </>
          )}
        </Section>

        {card?.feature_importance_gain_share && (
          <Section title="What the model pays attention to">
            <ImportanceChart shares={card.feature_importance_gain_share} />
          </Section>
        )}

        <Section title="Limitations — please read">
          <ul className="list-disc space-y-2 pl-5 text-sm leading-relaxed text-slate-700">
            <li>
              <strong>Chicago only.</strong> This pilot uses Chicago's open crime data. Other cities need their own data before
              WAYRA can score them.
            </li>
            <li>
              <strong>Lighting data is sparse.</strong> Only about 1–2% of Chicago's walkable streets have mapped lamps or a lit tag in
              OpenStreetMap. For the rest we guess from road type (main roads count as lit), so "unlit" is an estimate.
            </li>
            <li>
              <strong>Crowds are a proxy.</strong> "Busy" means many shops, venues and transit stops nearby, not live foot traffic.
            </li>
            <li>
              <strong>Past data is not a guarantee.</strong> Scores reflect reported incidents. Unreported crime, events and
              today's conditions are not included. Always trust your own judgement and use SOS if you feel unsafe.
            </li>
            <li>
              <strong>Reporting bias.</strong> Areas that are policed more heavily may show more recorded incidents.
            </li>
          </ul>
        </Section>

        <p className="text-center text-sm">
          <Link to="/" className="font-semibold text-brand-teal-dark underline underline-offset-2 hover:text-brand-purple">
            ← Back to the map
          </Link>
        </p>
      </div>
    </div>
  );
}
