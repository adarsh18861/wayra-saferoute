"""Phase 2, step 2: train the LightGBM risk model on the monthly panel.

- Temporal split from ml/config.yaml (train / valid / test); no random split.
- LightGBM with early stopping on validation, then isotonic calibration fitted on validation.
- Baseline = previous-12-month incident count for the same cell + bucket (historical frequency).
- Writes:
    data/models/risk_model.joblib          booster + isotonic calibrator + feature list
    data/processed/cell_risk.parquet       calibrated risk per cell x 12 buckets for the forecast month
    ml/reports/metrics.json                test metrics model vs baseline + feature importances
    ml/reports/feature_importance.png

Usage: python ml/04_train.py
"""
from __future__ import annotations

import json
import sys
import time
from typing import Any

import joblib
import lightgbm as lgb
import numpy as np
import pandas as pd
from sklearn.isotonic import IsotonicRegression
from sklearn.metrics import average_precision_score, brier_score_loss, roc_auc_score

from common import DATA_DIR, ML_DIR, PROCESSED_DIR, load_config

REPORTS_DIR = ML_DIR / "reports"
MODELS_DIR = DATA_DIR / "models"
NON_FEATURES = {"cell_idx", "month", "y", "y_count", "split", "h3", "lat", "lon"}


def hit_rate_top(df: pd.DataFrame, score: str, frac: float = 0.10, seed: int = 0) -> float:
    """Share of incidents (y_count) that fall in the top `frac` of cells ranked by `score`,
    ranking cells separately within each (month, bucket). Ties are broken randomly."""
    d = df[["month", "bucket", "y_count", score]].sample(frac=1.0, random_state=seed)
    rank = d.groupby(["month", "bucket"], sort=False)[score].rank(method="first", ascending=False)
    n = d.groupby(["month", "bucket"], sort=False)[score].transform("size")
    top = rank <= np.ceil(frac * n)
    return float(d.loc[top, "y_count"].sum() / max(d["y_count"].sum(), 1))


def evaluate(df: pd.DataFrame, score: str) -> dict[str, float]:
    return {
        "roc_auc": round(float(roc_auc_score(df["y"], df[score])), 4),
        "pr_auc": round(float(average_precision_score(df["y"], df[score])), 4),
        "hit_rate_top10pct": round(hit_rate_top(df, score), 4),
    }


def plot_importance(imp: pd.Series, path) -> None:
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    top = imp.head(15)[::-1]
    fig, ax = plt.subplots(figsize=(7, 5), dpi=150)
    fig.patch.set_facecolor("#fcfcfb")
    ax.set_facecolor("#fcfcfb")
    ax.barh(top.index, top.values, color="#2a78d6", height=0.6)
    ax.set_title("Risk model: feature importance (share of total gain)", loc="left", color="#0b0b0b", fontsize=11)
    ax.xaxis.set_major_formatter(matplotlib.ticker.PercentFormatter(1.0, decimals=0))
    for s in ("top", "right", "left"):
        ax.spines[s].set_visible(False)
    ax.spines["bottom"].set_color("#898781")
    ax.tick_params(colors="#52514e", labelsize=9, length=0)
    ax.grid(axis="x", color="#e6e5e0", linewidth=0.8)
    ax.set_axisbelow(True)
    fig.tight_layout()
    fig.savefig(path)
    plt.close(fig)


def main() -> int:
    t0 = time.time()
    cfg: dict[str, Any] = load_config()
    mcfg = cfg["model"]
    panel_path = PROCESSED_DIR / "panel.parquet"
    if not panel_path.exists():
        print(f"Missing {panel_path}. Run `python ml/03_features.py` first.", file=sys.stderr)
        return 1
    panel = pd.read_parquet(panel_path)
    cells = pd.read_parquet(PROCESSED_DIR / "cells.parquet")
    panel = panel.merge(cells.drop(columns=["lat", "lon"]), on="cell_idx", how="left")
    features = [c for c in panel.columns if c not in NON_FEATURES]

    tr, va, te, fc = (panel[panel["split"] == s] for s in ("train", "valid", "test", "forecast"))
    print(f"Rows: train {len(tr):,}  valid {len(va):,}  test {len(te):,}  forecast {len(fc):,}  "
          f"features {len(features)}")

    p = dict(mcfg["lightgbm"])
    esr = int(p.pop("early_stopping_rounds"))
    clf = lgb.LGBMClassifier(objective="binary", random_state=42, n_jobs=-1, verbose=-1, **p)
    clf.fit(tr[features], tr["y"], eval_X=(va[features],), eval_y=(va["y"],), eval_metric="average_precision",
            callbacks=[lgb.early_stopping(esr, verbose=False)])
    best_iter = int(clf.best_iteration_ or p["n_estimators"])
    print(f"LightGBM: best iteration {best_iter}  ({time.time() - t0:.0f}s)")

    raw = lambda d: clf.predict_proba(d[features], num_iteration=best_iter)[:, 1]  # noqa: E731
    iso = IsotonicRegression(y_min=0.0, y_max=1.0, out_of_bounds="clip").fit(raw(va), va["y"])

    te = te.copy()
    te["model_raw"] = raw(te)
    te["model"] = iso.predict(te["model_raw"])
    te["baseline"] = te["cnt_l12"] / 12.0  # monthly frequency over the previous 12 months
    results = {"model": evaluate(te, "model"), "model_uncalibrated": evaluate(te, "model_raw"),
               "baseline": evaluate(te, "baseline")}
    results["model"]["brier"] = round(float(brier_score_loss(te["y"], te["model"])), 5)

    gain = pd.Series(clf.booster_.feature_importance("gain"), index=features)
    imp = (gain / gain.sum()).sort_values(ascending=False)
    REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    plot_importance(imp, REPORTS_DIR / "feature_importance.png")

    # Latest risk: score the forecast month (lags up to the last complete month).
    fc = fc.copy()
    fc["risk"] = iso.predict(raw(fc))
    wide = fc.pivot(index="cell_idx", columns="bucket", values="risk")
    wide.columns = [f"risk_{b:02d}" for b in wide.columns]
    cell_risk = cells[["cell_idx", "h3"]].merge(wide.reset_index(), on="cell_idx").drop(columns="cell_idx")
    cell_risk.insert(1, "forecast_month", fc["month"].iloc[0])
    cell_risk.to_parquet(PROCESSED_DIR / "cell_risk.parquet", index=False)

    MODELS_DIR.mkdir(parents=True, exist_ok=True)
    joblib.dump({"booster": clf.booster_.model_to_string(num_iteration=best_iter), "isotonic": iso,
                 "features": features}, MODELS_DIR / "risk_model.joblib")

    metrics = {
        "unit": "H3 res-9 cell x calendar month x 2-hour bucket; target = >=1 relevant incident",
        "split": {"train": f"{tr['month'].min()}..{tr['month'].max()}",
                  "valid": f"{va['month'].min()}..{va['month'].max()}",
                  "test": f"{te['month'].min()}..{te['month'].max()}",
                  "forecast_month": fc["month"].iloc[0]},
        "rows": {"train": len(tr), "valid": len(va), "test": len(te)},
        "test_positive_rate": round(float(te["y"].mean()), 4),
        "n_cells": int(cells.shape[0]),
        "best_iteration": best_iter,
        "test": results,
        "definitions": {
            "baseline": "incidents in the same cell + bucket over the previous 12 months / 12",
            "hit_rate_top10pct": "share of test incidents in the 10% of cells ranked riskiest, "
                                 "ranked separately for each (month, bucket); ties broken randomly",
            "model": "LightGBM, isotonic-calibrated on the validation months",
        },
        "feature_importance_gain_share": {k: round(float(v), 4) for k, v in imp.items()},
        "runtime_seconds": round(time.time() - t0, 1),
    }
    (REPORTS_DIR / "metrics.json").write_text(json.dumps(metrics, indent=2), encoding="utf-8")

    rows = [("ROC-AUC", "roc_auc"), ("PR-AUC", "pr_auc"), ("Hit rate @ top 10%", "hit_rate_top10pct")]
    print(f"\nTest set {metrics['split']['test']}  (positive rate {metrics['test_positive_rate']:.3f})")
    print(f"  {'metric':<20} {'model':>8} {'baseline':>9}")
    for label, key in rows:
        print(f"  {label:<20} {results['model'][key]:>8.4f} {results['baseline'][key]:>9.4f}")
    print("\nTop 10 features (gain share):")
    for k, v in imp.head(10).items():
        print(f"  {k:<18} {v:6.1%}")
    print(f"\nSaved cell_risk {cell_risk.shape}, model, metrics in {time.time() - t0:.0f}s")
    return 0


if __name__ == "__main__":
    sys.exit(main())
