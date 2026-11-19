"""Unit tests for the panel/lag logic (03_features.py), hit rate (04_train.py) and the
edge-risk adjustment (05_score_edges.py) on tiny fake data. No network."""
from __future__ import annotations

import importlib.util
from pathlib import Path

import h3
import numpy as np
import pandas as pd
import pytest

ML = Path(__file__).resolve().parents[1]


def _load(name: str, file: str):
    spec = importlib.util.spec_from_file_location(name, ML / file)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


feat = _load("features03", "03_features.py")
train = _load("train04", "04_train.py")
edges = _load("edges05", "05_score_edges.py")

CELL = h3.latlng_to_cell(41.88, -87.63, 9)
NBR = next(n for n in h3.grid_disk(CELL, 1) if n != CELL)


# ---------------------------------------------------------------- lag helpers
def test_lag_sum_excludes_current_month():
    cube = np.array([[1, 2, 3, 4, 5]], np.float32)[:, :, None]  # 1 cell, 5 months, 1 bucket
    assert feat.lag_sum(cube, 1)[0, :, 0].tolist() == [0, 1, 2, 3, 4]
    assert feat.lag_sum(cube, 3)[0, :, 0].tolist() == [0, 1, 3, 6, 9]
    assert feat.lag_sum(cube, 12)[0, :, 0].tolist() == [0, 1, 3, 6, 10]


def test_ring_sum_ignores_missing_neighbours():
    arr = np.array([1.0, 10.0, 100.0])
    nbr = np.array([[1, -1], [0, 2], [-1, -1]])
    assert feat.ring_sum(arr, nbr).tolist() == [10.0, 101.0, 0.0]


def test_last_complete_month():
    assert str(feat.last_complete_month(pd.Timestamp("2026-11-10"))) == "2026-10"
    assert str(feat.last_complete_month(pd.Timestamp("2026-10-31 23:00"))) == "2026-10"


def test_cell_universe_adds_ring():
    cells = feat.cell_universe(pd.Series([CELL]))
    assert len(cells) == 7 and CELL in cells and NBR in cells


# ---------------------------------------------------------------- panel
@pytest.fixture()
def panel():
    inc = pd.DataFrame({
        "date": pd.to_datetime(["2024-01-05 01:00", "2024-02-10 01:30", "2024-02-11 13:00",
                                "2024-03-01 01:00", "2024-03-20 01:00"]),
        "h3": [CELL, CELL, CELL, NBR, CELL],
        "severity": [7.0, 3.0, 1.0, 5.0, 2.0],
        "after_dark": [True, True, False, True, True],
    })
    cells = sorted({CELL, NBR})
    p = feat.build_panel(inc, cells, pd.Period("2024-01", "M"), pd.Period("2024-03", "M"),
                         n_buckets=12, min_history=0)
    return p, cells.index(CELL), cells.index(NBR)


def row(p, cell, month, bucket):
    r = p[(p.cell_idx == cell) & (p.month == month) & (p.bucket == bucket)]
    assert len(r) == 1
    return r.iloc[0]


def test_panel_shape_and_forecast_month(panel):
    p, _, _ = panel
    assert len(p) == 2 * 4 * 12  # 2 cells x (3 months + forecast) x 12 buckets
    fc = p[p.month == "2024-04"]
    assert len(fc) == 24 and fc["y"].isna().all()


def test_panel_target_and_lags(panel):
    p, c, n = panel
    r = row(p, c, "2024-03", 0)  # bucket 0 = 00:00-01:59
    assert r.y == 1 and r.y_count == 1
    assert r.cnt_l1 == 1 and r.sev_l1 == 3  # Feb bucket 0
    assert r.cnt_l3 == 2 and r.sev_l3 == 10  # Jan + Feb bucket 0 (current month excluded)
    assert r.cell_cnt_l1 == 2  # Feb, all buckets
    assert r.cell_cnt_l12 == 3 and r.dark_share_l12 == pytest.approx(2 / 3)
    assert row(p, c, "2024-02", 6).y == 1  # 13:00 -> bucket 6
    assert row(p, c, "2024-01", 0).cnt_l12 == 0


def test_panel_neighbour_features(panel):
    p, c, n = panel
    assert row(p, c, "2024-04", 0).nb_cnt_l1 == 1  # neighbour's March incident
    assert row(p, n, "2024-03", 0).nb_cnt_l3 == 2  # the centre cell's Jan + Feb incidents
    assert row(p, n, "2024-03", 0).nb_sev_l3 == 10


def test_assign_split():
    m = pd.Series(["2025-06", "2025-07", "2025-12", "2026-01", "2026-11"])
    s = feat.assign_split(m, "2025-06", "2025-12", "2026-11")
    assert s.tolist() == ["train", "valid", "valid", "test", "forecast"]


# ---------------------------------------------------------------- metrics
def test_hit_rate_top():
    # One (month, bucket) group of 10 cells: top 10% = 1 cell.
    df = pd.DataFrame({"month": "2026-01", "bucket": 0, "y_count": [5, 1, 0, 0, 0, 0, 0, 0, 0, 4],
                       "score": [0.9, 0.5, 0, 0, 0, 0, 0, 0, 0, 0.1]})
    assert train.hit_rate_top(df, "score") == pytest.approx(0.5)


# ---------------------------------------------------------------- edge risk
ECFG = {"night_buckets": [0, 11], "unlit_night_penalty": 0.1, "busy_poi_cap": 10, "busy_max_reduction": 0.2}


def test_adjust_edge_risk_night_penalty_only_for_unlit():
    base = np.full((2, 12), 0.5, np.float32)
    r = edges.adjust_edge_risk(base, unlit=np.array([True, False]), poi_count=np.array([0, 0]), ecfg=ECFG)
    assert r[0, 0] == pytest.approx(0.6) and r[0, 11] == pytest.approx(0.6)
    assert r[0, 5] == pytest.approx(0.5)  # day: no penalty
    assert np.allclose(r[1], 0.5)  # lit edge: never penalised


def test_adjust_edge_risk_busy_reduction_and_clip():
    base = np.array([[0.5] * 12, [0.5] * 12, [0.98] * 12], np.float32)
    r = edges.adjust_edge_risk(base, unlit=np.array([False, False, True]), poi_count=np.array([5, 50, 0]),
                               ecfg=ECFG)
    assert r[0, 5] == pytest.approx(0.5 * 0.9)  # half the cap -> half the reduction
    assert r[1, 5] == pytest.approx(0.5 * 0.8)  # capped
    assert r[2, 0] == 1.0  # clipped
    assert r.dtype == np.float32 and r.min() >= 0


def test_base_edge_risk_fallback_to_min():
    cr = pd.DataFrame({"h3": ["a", "b"], **{f"risk_{b:02d}": [0.2, 0.4] for b in range(12)}})
    out = edges.base_edge_risk(np.array(["b", "zzz", "a"]), cr)
    assert out[:, 0].tolist() == pytest.approx([0.4, 0.2, 0.2])


@pytest.mark.parametrize("value,expected", [
    ("yes", True), ("no", False), (None, False), (float("nan"), False),
    (["no", "yes"], True), ("['no', 'yes']", True), ("24/7", True),
])
def test_is_lit(value, expected):
    assert edges.is_lit(value) is expected


# ---------------------------------------------------------------- Phase 4 additions
def test_road_class_lighting_fallback():
    assert edges.road_class_lit("primary") and edges.road_class_lit("tertiary_link")
    assert edges.road_class_lit("['footway', 'secondary']")
    assert not edges.road_class_lit("residential") and not edges.road_class_lit("['service', 'footway']")
    unlit = edges.unlit_mask(
        lit_tag=np.array([True, False, False, False, False]),
        lit_known=np.array([True, True, False, False, False]),  # 2nd edge: explicit lit=no
        lamp_near=np.array([False, False, True, False, False]),
        highway=np.array(["residential", "primary", "footway", "secondary", "path"], object),
    )
    assert unlit.tolist() == [False, True, False, False, True]


def test_relative_risk_joint_percentile():
    risk = np.array([[0.01, 0.10], [0.02, 0.20], [0.03, 0.30]], np.float32)  # col 1 = "night"
    rel = edges.relative_risk(risk)
    assert rel.min() == 0.0 and rel.max() == 1.0
    assert (rel[:, 1] > rel[:, 0].max()).all()  # ranked jointly, night above all day values
    tied = edges.relative_risk(np.array([[0.5, 0.5], [0.5, 0.5]], np.float32))
    assert np.allclose(tied, 0.5)


def test_parse_graphml_tiny(tmp_path):
    xml = """<?xml version='1.0' encoding='utf-8'?>
<graphml xmlns="http://graphml.graphdrawing.org/xmlns">
  <key id="d1" for="edge" attr.name="lit" attr.type="string" />
  <key id="d2" for="edge" attr.name="geometry" attr.type="string" />
  <key id="d3" for="edge" attr.name="length" attr.type="string" />
  <key id="d4" for="edge" attr.name="highway" attr.type="string" />
  <key id="d5" for="node" attr.name="x" attr.type="string" />
  <key id="d6" for="node" attr.name="y" attr.type="string" />
  <graph edgedefault="directed">
    <node id="1"><data key="d6">41.0</data><data key="d5">-87.0</data></node>
    <node id="2"><data key="d6">41.1</data><data key="d5">-87.1</data></node>
    <edge source="1" target="2" id="0"><data key="d3">12.5</data><data key="d4">primary</data></edge>
    <edge source="2" target="1" id="0"><data key="d1">yes</data><data key="d3">13.0</data>
      <data key="d4">['footway', 'service']</data>
      <data key="d2">LINESTRING (-87.0 41.0, -87.05 41.06, -87.1 41.1)</data></edge>
  </graph>
</graphml>"""
    p = tmp_path / "g.graphml"
    p.write_text(xml, encoding="utf-8")
    e, nodes, off, coords = edges.parse_graphml(p)
    assert nodes["osmid"].tolist() == [1, 2]
    assert e[["u", "v"]].values.tolist() == [[1, 2], [2, 1]]
    assert e["lit_tag"].tolist() == [False, True] and e["lit_known"].tolist() == [False, True]
    assert e["highway"].tolist()[0] == "primary"
    assert off.tolist() == [0, 2, 5]
    # second edge geometry was stored 1->2 in the file and is flipped to run u=2 -> v=1
    assert coords[2].tolist() == [41.1, -87.1] and coords[4].tolist() == [41.0, -87.0]
    assert e["lat"].tolist()[0] == pytest.approx(41.05)
