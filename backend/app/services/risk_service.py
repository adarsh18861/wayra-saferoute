"""Cell risk heatmap (H3 polygons with relative risk) and the model card (metrics.json)."""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import h3
import numpy as np
import pandas as pd
from scipy.stats import rankdata

N_BUCKETS = 12


class RiskService:
    def __init__(self, cells: list[str], risk: np.ndarray, forecast_month: str | None = None) -> None:
        """risk: (cells, 12) calibrated probabilities."""
        self.cells = cells
        self.risk = np.asarray(risk, np.float32)
        self.forecast_month = forecast_month
        flat = self.risk.ravel()
        rel = (rankdata(flat, method="average") - 1) / max(flat.size - 1, 1)
        self.rel = rel.reshape(self.risk.shape).astype(np.float32)
        self._rings = [[[lng, lat] for lat, lng in h3.cell_to_boundary(c)] for c in cells]
        for ring in self._rings:
            ring.append(ring[0])
        self._cache: dict[int, dict[str, Any]] = {}

    @classmethod
    def from_file(cls, path: Path) -> RiskService:
        df = pd.read_parquet(path)
        cols = [f"risk_{b:02d}" for b in range(N_BUCKETS)]
        fm = str(df["forecast_month"].iloc[0]) if "forecast_month" in df and len(df) else None
        return cls(df["h3"].astype(str).tolist(), df[cols].to_numpy(np.float32), fm)

    def heatmap(self, bucket: int) -> dict[str, Any]:
        if bucket not in self._cache:
            feats = [
                {
                    "type": "Feature",
                    "geometry": {"type": "Polygon", "coordinates": [ring]},
                    "properties": {"h3": c, "rel_risk": round(float(self.rel[i, bucket]), 3),
                                   "risk": round(float(self.risk[i, bucket]), 4)},
                }
                for i, (c, ring) in enumerate(zip(self.cells, self._rings))
            ]
            self._cache[bucket] = {"type": "FeatureCollection", "bucket": bucket,
                                   "forecast_month": self.forecast_month, "features": feats}
        return self._cache[bucket]


def load_model_card(path: Path) -> dict[str, Any] | None:
    if not path.exists():
        return None
    with open(path, encoding="utf-8") as f:
        return json.load(f)
