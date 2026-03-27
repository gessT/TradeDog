"""
MGC Pro Indicators — Extended Technical Indicator Library
==========================================================
Extends the base indicators with MACD, Market Structure, and session filters.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from .indicators import atr, ema, rsi, sma, supertrend  # re-export base


# ═══════════════════════════════════════════════════════════════════════
# MACD
# ═══════════════════════════════════════════════════════════════════════

def macd(
    close: pd.Series,
    fast: int = 12,
    slow: int = 26,
    signal_period: int = 9,
) -> tuple[pd.Series, pd.Series, pd.Series]:
    """MACD line, signal line, histogram."""
    macd_line = ema(close, fast) - ema(close, slow)
    signal_line = ema(macd_line, signal_period)
    histogram = macd_line - signal_line
    return macd_line, signal_line, histogram


# ═══════════════════════════════════════════════════════════════════════
# Market Structure — Higher High / Higher Low detection
# ═══════════════════════════════════════════════════════════════════════

def market_structure(
    high: pd.Series,
    low: pd.Series,
    lookback: int = 5,
) -> pd.Series:
    """Detect market structure.

    Returns +1 (bullish: HH + HL), -1 (bearish: LL + LH), 0 (neutral).
    Uses rolling window to find swing highs/lows.
    """
    roll_high = high.rolling(lookback, center=False).max()
    roll_low = low.rolling(lookback, center=False).min()

    # Higher high: current rolling max > previous rolling max
    hh = roll_high > roll_high.shift(lookback)
    # Higher low: current rolling min > previous rolling min
    hl = roll_low > roll_low.shift(lookback)
    # Lower low
    ll = roll_low < roll_low.shift(lookback)
    # Lower high
    lh = roll_high < roll_high.shift(lookback)

    structure = pd.Series(0, index=high.index, dtype=np.int8)
    structure[hh & hl] = 1   # bullish
    structure[ll & lh] = -1  # bearish
    return structure


# ═══════════════════════════════════════════════════════════════════════
# Session Filter — London & New York
# ═══════════════════════════════════════════════════════════════════════

def in_trading_session(index: pd.DatetimeIndex, sessions: str = "london_ny") -> pd.Series:
    """Return boolean Series indicating if bar falls within active sessions.

    Sessions (UTC times):
      London : 08:00 — 16:00 UTC
      NY     : 13:00 — 21:00 UTC  (overlap 13-16)
      Combined: 08:00 — 21:00 UTC

    For US Eastern timezone data, London=03:00-11:00, NY=08:00-16:00 ET
    Combined: 03:00-16:00 ET → mapped to hour check.
    """
    if not isinstance(index, pd.DatetimeIndex):
        index = pd.to_datetime(index)

    hour = index.hour

    if sessions == "london_ny":
        # If data has timezone, convert; otherwise assume US Eastern
        if index.tz is not None:
            try:
                utc_hour = index.tz_convert("UTC").hour
                return pd.Series((utc_hour >= 8) & (utc_hour < 21), index=index)
            except Exception:
                pass
        # Assume US Eastern: London 3am-11am, NY 8am-4pm → combined 3am-4pm
        return pd.Series((hour >= 3) & (hour < 16), index=index)
    elif sessions == "ny_only":
        if index.tz is not None:
            try:
                utc_hour = index.tz_convert("UTC").hour
                return pd.Series((utc_hour >= 13) & (utc_hour < 21), index=index)
            except Exception:
                pass
        return pd.Series((hour >= 8) & (hour < 16), index=index)
    else:
        return pd.Series(True, index=index)


# ═══════════════════════════════════════════════════════════════════════
# Volume Spike Detection
# ═══════════════════════════════════════════════════════════════════════

def volume_spike(volume: pd.Series, period: int = 20, threshold: float = 1.5) -> pd.Series:
    """True when volume exceeds threshold × SMA(volume)."""
    vol_ma = volume.rolling(window=period, min_periods=1).mean()
    return volume > threshold * vol_ma


# ═══════════════════════════════════════════════════════════════════════
# ATR Volatility Filter
# ═══════════════════════════════════════════════════════════════════════

def atr_filter(
    high: pd.Series,
    low: pd.Series,
    close: pd.Series,
    period: int = 14,
    min_atr: float = 0.0,
    max_atr: float = float("inf"),
) -> pd.Series:
    """True when ATR is within acceptable range (filters low/extreme volatility)."""
    atr_val = atr(high, low, close, period)
    return (atr_val >= min_atr) & (atr_val <= max_atr)


# ═══════════════════════════════════════════════════════════════════════
# Multi-Timeframe Resampling Helper
# ═══════════════════════════════════════════════════════════════════════

def resample_to_higher_tf(df: pd.DataFrame, tf: str = "1h") -> pd.DataFrame:
    """Resample OHLCV data to a higher timeframe (e.g., 15m → 1H).

    Returns DataFrame with same columns at higher TF granularity.
    """
    resampled = df.resample(tf).agg({
        "open": "first",
        "high": "max",
        "low": "min",
        "close": "last",
        "volume": "sum",
    }).dropna()
    return resampled
