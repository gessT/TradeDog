"""
MGC Data Loader
===============
Load Micro Gold Futures OHLCV data from Yahoo Finance, JSON, or CSV.
"""
from __future__ import annotations

import json
import logging
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pandas as pd
import yfinance as yf

from .config import CONTRACT_SIZE, DATA_PERIOD, DEFAULT_INTERVAL, SYMBOL_YF

logger = logging.getLogger(__name__)

# Requested period → days to fetch
_PERIOD_DAYS: dict[str, int] = {
    "1d": 2, "2d": 3, "3d": 5, "5d": 7, "7d": 9,
    "30d": 32, "60d": 60,
    # Standard yfinance-style period strings used by KLSE / US daily backtests
    "1mo": 35, "3mo": 95, "6mo": 185,
    "1y": 370, "2y": 740, "5y": 1830,
}

# yfinance hard limits on how far back intraday data goes
_INTERVAL_MAX_DAYS: dict[str, int] = {
    "1m": 7, "2m": 58, "5m": 58, "15m": 58, "30m": 58,
    "60m": 58, "1h": 730, "90m": 58,
    # Daily / weekly / monthly — no practical hard limit in yfinance
    "1d": 3650, "5d": 3650, "1wk": 3650, "1mo": 3650,
}


# ═══════════════════════════════════════════════════════════════════════
# Yahoo Finance
# ═══════════════════════════════════════════════════════════════════════

def load_yfinance(
    symbol: str = SYMBOL_YF,
    interval: str = DEFAULT_INTERVAL,
    period: str = DATA_PERIOD,
) -> pd.DataFrame:
    """Fetch intraday or daily OHLCV from Yahoo Finance.

    Returns DataFrame with columns: open, high, low, close, volume
    and a DatetimeIndex.

    Uses explicit start/end datetimes instead of the period= string so that
    yfinance's internal requests cache is bypassed on every call (the cache
    key includes the exact start/end values, not the period alias).  This
    ensures the "keep-going" strategy always receives up-to-the-minute data
    instead of a stale snapshot from hours ago.
    """
    logger.info("Fetching %s  interval=%s  period=%s", symbol, interval, period)

    days_back = _PERIOD_DAYS.get(period, 60)
    # Clamp to yfinance's per-interval hard limits to avoid empty responses
    max_days = _INTERVAL_MAX_DAYS.get(interval, 365)
    days_back = min(days_back, max_days)

    end_dt = datetime.now(timezone.utc)
    start_dt = end_dt - timedelta(days=days_back)

    ticker = yf.Ticker(symbol)
    df = ticker.history(start=start_dt, end=end_dt, interval=interval, auto_adjust=False)

    if df is None or df.empty:
        raise ValueError(f"No data returned for {symbol} ({interval}, {period})")

    df = _normalise_columns(df)
    df = df.dropna(subset=["close"])
    logger.info("Loaded %d bars  [%s → %s]", len(df), df.index[0], df.index[-1])
    return df


# ═══════════════════════════════════════════════════════════════════════
# JSON
# ═══════════════════════════════════════════════════════════════════════

def load_json(path: str | Path) -> pd.DataFrame:
    """Load OHLCV from a JSON file.

    Expected format — list of objects:
        [{"timestamp": ..., "open": ..., "high": ..., "low": ..., "close": ..., "volume": ...}, ...]
    """
    path = Path(path)
    with open(path, encoding="utf-8") as fh:
        raw = json.load(fh)

    df = pd.DataFrame(raw)
    if "timestamp" in df.columns:
        df.index = pd.to_datetime(df["timestamp"])
        df = df.drop(columns=["timestamp"])
    elif "time" in df.columns:
        df.index = pd.to_datetime(df["time"])
        df = df.drop(columns=["time"])
    elif "date" in df.columns:
        df.index = pd.to_datetime(df["date"])
        df = df.drop(columns=["date"])

    df = _normalise_columns(df)
    df = df.dropna(subset=["close"])
    logger.info("Loaded %d bars from %s", len(df), path.name)
    return df


# ═══════════════════════════════════════════════════════════════════════
# CSV
# ═══════════════════════════════════════════════════════════════════════

def load_csv(path: str | Path) -> pd.DataFrame:
    """Load OHLCV from a CSV file with a timestamp/date column."""
    path = Path(path)
    df = pd.read_csv(path)

    for col in ("timestamp", "time", "date", "Date", "Datetime"):
        if col in df.columns:
            df.index = pd.to_datetime(df[col])
            df = df.drop(columns=[col])
            break

    df = _normalise_columns(df)
    df = df.dropna(subset=["close"])
    logger.info("Loaded %d bars from %s", len(df), path.name)
    return df


# ═══════════════════════════════════════════════════════════════════════
# Helpers
# ═══════════════════════════════════════════════════════════════════════

def _normalise_columns(df: pd.DataFrame) -> pd.DataFrame:
    """Ensure lowercase OHLCV column names and numeric types."""
    # Handle yfinance MultiIndex columns
    if isinstance(df.columns, pd.MultiIndex):
        df.columns = df.columns.get_level_values(0)

    rename_map: dict[str, str] = {}
    for col in df.columns:
        lc = str(col).lower().strip()
        if lc in ("open", "high", "low", "close", "volume", "adj close"):
            rename_map[col] = lc
    df = df.rename(columns=rename_map)

    for col in ("open", "high", "low", "close", "volume"):
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors="coerce")

    # Keep only needed columns
    keep = [c for c in ("open", "high", "low", "close", "volume") if c in df.columns]
    df = df[keep].copy()
    df.index = pd.to_datetime(df.index)
    df = df.sort_index()
    return df


def point_value() -> float:
    """Dollar value of a 1-point move per contract."""
    return float(CONTRACT_SIZE)
