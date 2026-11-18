"""Unit tests for ml/02_clean.py on a tiny fake dataframe (no network)."""
from __future__ import annotations

import importlib.util
from pathlib import Path

import h3
import pandas as pd
import pytest

from common import load_config

_spec = importlib.util.spec_from_file_location("clean02", Path(__file__).resolve().parents[1] / "02_clean.py")
clean02 = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(clean02)


@pytest.fixture(scope="module")
def cfg():
    return load_config()


def make_raw() -> pd.DataFrame:
    rows = [
        # id, date, primary_type, description, location_description, domestic, arrest, lat, lon
        ("1", "2023-06-15T23:30:00.000", "ROBBERY", "ARMED - HANDGUN", "STREET", "false", "false", "41.88", "-87.63"),
        ("2", "2023-06-15T12:00:00.000", "THEFT", "POCKET-PICKING", "CTA TRAIN", "false", "false", "41.89", "-87.62"),
        ("3", "2023-06-15T12:00:00.000", "THEFT", "$500 AND UNDER", "STREET", "false", "false", "41.89", "-87.62"),
        ("4", "2023-06-15T12:00:00.000", "BATTERY", "SIMPLE", "APARTMENT", "false", "false", "41.89", "-87.62"),
        ("5", "2023-06-15T12:00:00.000", "BATTERY", "AGGRAVATED: HANDGUN", "SIDEWALK", "true", "false", "41.89", "-87.62"),
        ("6", "2023-06-15T12:00:00.000", "ASSAULT", "SIMPLE", "SIDEWALK", "false", "false", "", ""),
        ("7", "2023-06-15T12:00:00.000", "ASSAULT", "SIMPLE", "SIDEWALK", "false", "false", "36.62", "-91.68"),
        ("8", "2024-01-10T07:00:00.000", "BATTERY", "AGGRAVATED: HANDGUN", "PARKING LOT / GARAGE (NON RESIDENTIAL)",
         "false", "true", "41.80", "-87.70"),
        ("9", "2024-01-10T12:00:00.000", "INTIMIDATION", "INTIMIDATION", "PARK PROPERTY", "false", "false", "41.80", "-87.70"),
        ("10", "2024-01-10T12:00:00.000", "BURGLARY", "FORCIBLE ENTRY", "STREET", "false", "false", "41.80", "-87.70"),
    ]
    cols = ["id", "date", "primary_type", "description", "location_description", "domestic", "arrest",
            "latitude", "longitude"]
    df = pd.DataFrame(rows, columns=cols)
    df["community_area"] = "32"
    df["district"] = "1"
    return df.replace("", pd.NA)


def test_theft_filter_keeps_only_from_person(cfg):
    out = clean02.filter_theft(make_raw(), cfg)
    assert "2" in set(out["id"])       # POCKET-PICKING kept
    assert "3" not in set(out["id"])   # generic theft dropped
    assert "1" in set(out["id"])       # non-theft untouched


def test_theft_filter_matches_from_person_substring(cfg):
    df = pd.DataFrame({"primary_type": ["THEFT"], "description": ["financial id theft: from person"]})
    assert len(clean02.filter_theft(df, cfg)) == 1


def test_public_location_filter_supports_globs(cfg):
    out = clean02.filter_public(make_raw(), cfg)
    ids = set(out["id"])
    assert {"1", "2", "8", "9"} <= ids  # STREET, CTA TRAIN (CTA*), PARKING LOT*, PARK PROPERTY
    assert "4" not in ids                # APARTMENT


def test_matches_patterns_case_insensitive_and_missing():
    s = pd.Series(["cta bus stop", "Street", None, "RESIDENCE"])
    assert clean02.matches_patterns(s, ["CTA*", "STREET"]).tolist() == [True, True, False, False]


def test_domestic_and_type_filters(cfg):
    raw = make_raw()
    assert "5" not in set(clean02.filter_non_domestic(raw)["id"])
    assert "10" not in set(clean02.filter_types(raw, cfg)["id"])


def test_coords_and_bbox(cfg):
    out = clean02.filter_bbox(clean02.filter_coords(make_raw()), cfg)
    ids = set(out["id"])
    assert "6" not in ids  # no coordinates
    assert "7" not in ids  # outside Chicago
    assert out["latitude"].dtype.kind == "f"


def test_severity_weights(cfg):
    df = pd.DataFrame({
        "primary_type": ["HOMICIDE", "BATTERY", "BATTERY", "THEFT", "INTIMIDATION", "CRIMINAL SEXUAL ASSAULT"],
        "description": ["FIRST DEGREE MURDER", "SIMPLE", "AGGRAVATED - KNIFE", "POCKET-PICKING", "X", "NON-AGGRAVATED"],
    })
    assert clean02.add_severity(df, cfg)["severity"].tolist() == [10, 3, 6, 2, 1, 9]


def test_after_dark_uses_chicago_sun_times(cfg):
    df = pd.DataFrame({"date": pd.to_datetime([
        "2023-06-21 12:00",  # midday
        "2023-06-21 22:00",  # after sunset (~20:30 CDT)
        "2023-06-21 05:00",  # before sunrise (~05:15 CDT)
        "2023-12-21 17:00",  # after winter sunset (~16:22 CST)
        "2023-12-21 07:00",  # before winter sunrise (~07:15 CST)
        "2023-12-21 08:00",  # after winter sunrise
    ])})
    assert clean02.add_after_dark(df, cfg)["after_dark"].tolist() == [False, True, True, True, True, False]


def test_full_clean_pipeline(cfg):
    df, steps = clean02.clean(make_raw(), cfg)
    assert sorted(df["id"], key=int) == ["1", "2", "8", "9"]
    assert [n for _, n in steps] == [10, 9, 8, 7, 6, 5, 4, 4]
    r1 = df.set_index("id").loc["1"]
    assert (r1["hour"], r1["weekday"], r1["month"]) == (23, 3, 6)  # 2023-06-15 was a Thursday
    assert bool(r1["after_dark"]) is True
    assert r1["severity"] == 7
    assert r1["h3"] == h3.latlng_to_cell(41.88, -87.63, 9)
    assert h3.get_resolution(r1["h3"]) == 9
    r8 = df.set_index("id").loc["8"]
    assert r8["severity"] == 6 and bool(r8["arrest"]) is True
    assert df["date"].is_monotonic_increasing
    assert "Share after dark" in clean02.summarize(df, steps)
