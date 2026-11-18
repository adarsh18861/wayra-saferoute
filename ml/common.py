"""Shared paths and config loading for the ml/ pipeline scripts."""
from __future__ import annotations

import os
import sys
from pathlib import Path
from typing import Any

import yaml

# Show progress immediately even when output is piped (npm, log files).
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(line_buffering=True, errors="replace")

ML_DIR = Path(__file__).resolve().parent
ROOT = ML_DIR.parent
DATA_DIR = ROOT / "data"
RAW_DIR = DATA_DIR / "raw"
PROCESSED_DIR = DATA_DIR / "processed"
CACHE_DIR = DATA_DIR / "cache"
CONFIG_PATH = ML_DIR / "config.yaml"


def env_value(name: str) -> str | None:
    """Value from the process environment, else from the repo-root .env file (no extra dependency)."""
    if os.environ.get(name):
        return os.environ[name]
    env_file = ROOT / ".env"
    if env_file.exists():
        for line in env_file.read_text(encoding="utf-8").splitlines():
            key, sep, value = line.partition("=")
            if sep and key.strip() == name:
                return value.strip().strip('"').strip("'") or None
    return None


def load_config(path: Path = CONFIG_PATH) -> dict[str, Any]:
    with open(path, encoding="utf-8") as f:
        return yaml.safe_load(f)
