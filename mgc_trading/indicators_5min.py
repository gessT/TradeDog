"""
5-Minute Indicators — MACD, Breakout, Session Filter, ATR Range
================================================================
Dedicated indicator functions for the 5-minute scalping strategy.
Uses existing EMA/RSI/ATR/Supertrend from indicators.py.
"""
from __future__ import annotations

import numpy as np
import pandas as pd


# ═══════════════════════════════════════════════════════════════════════
# MACD
# ═══════════════════════════════════════════════════════════════════════

def macd(
    close: pd.Series,
    fast: int = 12,
    slow: int = 26,
    signal: int = 9,
) -> tuple[pd.Series, pd.Series, pd.Series]:
    """Return (macd_line, signal_line, histogram)."""
    ema_fast = close.ewm(span=fast, adjust=False).mean()
    ema_slow = close.ewm(span=slow, adjust=False).mean()
    macd_line = ema_fast - ema_slow
    signal_line = macd_line.ewm(span=signal, adjust=False).mean()
    histogram = macd_line - signal_line
    return macd_line, signal_line, histogram


# ═══════════════════════════════════════════════════════════════════════
# Breakout / Pullback detection
# ═══════════════════════════════════════════════════════════════════════

def breakout_high(
    close: pd.Series,
    high: pd.Series,
    lookback: int = 20,
) -> pd.Series:
    """True when close breaks above the highest high of *lookback* bars (shifted)."""
    prev_high = high.rolling(lookback).max().shift(1)
    return (close > prev_high).astype(int)


def pullback_to_ema(
    close: pd.Series,
    ema_line: pd.Series,
    atr_vals: pd.Series,
    max_dist_atr: float = 2.0,
) -> pd.Series:
    """True when price is within *max_dist_atr* × ATR of the EMA (either side).

    Allows both slight dips below EMA and hovering above — captures
    real pullback‐to‐support behaviour instead of only "above EMA".
    """
    dist = (close - ema_line).abs()
    return (dist <= max_dist_atr * atr_vals).astype(int)


def ema_slope(
    ema_line: pd.Series,
    lookback: int = 3,
) -> pd.Series:
    """True when EMA has been rising over the last *lookback* bars."""
    return (ema_line > ema_line.shift(lookback)).astype(int)


# ═══════════════════════════════════════════════════════════════════════
# Volume Spike
# ═══════════════════════════════════════════════════════════════════════

def volume_spike(
    volume: pd.Series,
    period: int = 20,
    threshold: float = 0.8,
) -> pd.Series:
    """True when volume exceeds *threshold* × rolling mean.

    Default 0.8 is intentionally loose — filters out only dead-volume
    bars rather than requiring an actual spike.  The trend + pullback +
    supertrend conditions already provide quality filtering.
    """
    vol_ma = volume.rolling(period).mean()
    return (volume > threshold * vol_ma).astype(int)


# ═══════════════════════════════════════════════════════════════════════
# Session Time Filter
# ═══════════════════════════════════════════════════════════════════════

def in_session(
    index: pd.DatetimeIndex,
    sessions: list[tuple[int, int]] | None = None,
) -> pd.Series:
    """Return boolean Series — True when bar falls within allowed sessions.

    *sessions* is a list of (start_hour, end_hour) in UTC.
    Defaults to NY main session (13:30–20:00 UTC) + London overlap (07:00–11:30 UTC).
    """
    if sessions is None:
        sessions = [
            (13, 20),   # NY session  09:30–16:00 ET → 13:30–20:00 UTC (approx)
            (7, 12),    # London overlap  03:00–07:30 ET → 07:00–12:00 UTC
        ]

    hours = index.hour
    mask = pd.Series(False, index=index)
    for start_h, end_h in sessions:
        mask = mask | ((hours >= start_h) & (hours < end_h))
    return mask.astype(int)


# ═══════════════════════════════════════════════════════════════════════
# ATR Range Filter  (skip low-volatility / ranging markets)
# ═══════════════════════════════════════════════════════════════════════

def atr_range_ok(
    atr_vals: pd.Series,
    min_atr_pct: float = 0.05,
    close: pd.Series | None = None,
) -> pd.Series:
    """True when ATR as % of close exceeds *min_atr_pct*%.

    Filters out flat / ranging bars where signals are unreliable.
    """
    if close is None:
        return pd.Series(True, index=atr_vals.index)
    pct = atr_vals / close * 100
    return (pct >= min_atr_pct).astype(int)


# ═══════════════════════════════════════════════════════════════════════
# RSI momentum shift
# ═══════════════════════════════════════════════════════════════════════

def rsi_rising(
    rsi_vals: pd.Series,
    low_thresh: float = 35.0,
    strength_thresh: float = 45.0,
) -> pd.Series:
    """True when RSI shows bullish momentum.

    Conditions (OR):
    - RSI was below *low_thresh* in last 5 bars AND current > *strength_thresh*
    - RSI is in the 35-65 healthy momentum zone (not overbought)
    - RSI is rising (current > 2 bars ago)
    """
    was_low = rsi_vals.rolling(5).min() < low_thresh
    now_strong = rsi_vals > strength_thresh
    in_zone = (rsi_vals >= 35) & (rsi_vals <= 65)
    rising = rsi_vals > rsi_vals.shift(2)
    return ((was_low & now_strong) | (in_zone & rising)).astype(int)


def macd_momentum(
    macd_hist: pd.Series,
    lookback: int = 3,
) -> pd.Series:
    """True when MACD histogram is positive OR has just crossed above zero.

    More forgiving than requiring hist > 0 at the exact bar — catches
    fresh momentum shifts that the previous version missed.
    """
    positive = macd_hist > 0
    was_neg = macd_hist.rolling(lookback).min() < 0
    fresh_cross = positive & was_neg
    return (positive | fresh_cross).astype(int)


# ═══════════════════════════════════════════════════════════════════════
# ADX — Average Directional Index (trend strength filter)
# ═══════════════════════════════════════════════════════════════════════

def adx(
    high: pd.Series,
    low: pd.Series,
    close: pd.Series,
    period: int = 14,
) -> pd.Series:
    """Compute ADX (trend strength 0–100).

    ADX > 20 = trending market (good for entries).
    ADX < 20 = ranging/choppy (avoid signals).
    """
    plus_dm = high.diff()
    minus_dm = -low.diff()
    plus_dm = plus_dm.where((plus_dm > minus_dm) & (plus_dm > 0), 0.0)
    minus_dm = minus_dm.where((minus_dm > plus_dm) & (minus_dm > 0), 0.0)

    tr1 = high - low
    tr2 = (high - close.shift(1)).abs()
    tr3 = (low - close.shift(1)).abs()
    tr = pd.concat([tr1, tr2, tr3], axis=1).max(axis=1)

    atr_smooth = tr.ewm(span=period, adjust=False).mean()
    plus_di = 100 * (plus_dm.ewm(span=period, adjust=False).mean() / atr_smooth)
    minus_di = 100 * (minus_dm.ewm(span=period, adjust=False).mean() / atr_smooth)

    dx = (plus_di - minus_di).abs() / (plus_di + minus_di).replace(0, 1e-10) * 100
    adx_val = dx.ewm(span=period, adjust=False).mean()
    return adx_val


def higher_tf_trend(
    close: pd.Series,
    ema_period: int = 50,
) -> pd.Series:
    """Simulate a higher timeframe trend using a longer EMA.

    Returns 1 when close is above the long EMA (bullish bias).
    This acts as a regime filter — only trade longs in uptrends.
    """
    long_ema = close.ewm(span=ema_period, adjust=False).mean()
    return (close > long_ema).astype(int)
