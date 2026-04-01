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


def breakout_low(
    close: pd.Series,
    low: pd.Series,
    lookback: int = 20,
) -> pd.Series:
    """True when close breaks below the lowest low of *lookback* bars (shifted)."""
    prev_low = low.rolling(lookback).min().shift(1)
    return (close < prev_low).astype(int)


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


def ema_slope_falling(
    ema_line: pd.Series,
    lookback: int = 3,
) -> pd.Series:
    """True when EMA has been falling over the last *lookback* bars."""
    return (ema_line < ema_line.shift(lookback)).astype(int)


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
    """True when RSI shows bullish momentum."""
    was_low = rsi_vals.rolling(5).min() < low_thresh
    now_strong = rsi_vals > strength_thresh
    in_zone = (rsi_vals >= 35) & (rsi_vals <= 65)
    rising = rsi_vals > rsi_vals.shift(2)
    return ((was_low & now_strong) | (in_zone & rising)).astype(int)


def rsi_falling(
    rsi_vals: pd.Series,
    high_thresh: float = 65.0,
    weakness_thresh: float = 55.0,
) -> pd.Series:
    """True when RSI shows bearish momentum (mirror of rsi_rising)."""
    was_high = rsi_vals.rolling(5).max() > high_thresh
    now_weak = rsi_vals < weakness_thresh
    in_zone = (rsi_vals >= 35) & (rsi_vals <= 65)
    falling = rsi_vals < rsi_vals.shift(2)
    return ((was_high & now_weak) | (in_zone & falling)).astype(int)


def macd_momentum(
    macd_hist: pd.Series,
    lookback: int = 3,
) -> pd.Series:
    """True when MACD histogram is positive OR has just crossed above zero."""
    positive = macd_hist > 0
    was_neg = macd_hist.rolling(lookback).min() < 0
    fresh_cross = positive & was_neg
    return (positive | fresh_cross).astype(int)


def macd_momentum_bear(
    macd_hist: pd.Series,
    lookback: int = 3,
) -> pd.Series:
    """True when MACD histogram is negative OR has just crossed below zero."""
    negative = macd_hist < 0
    was_pos = macd_hist.rolling(lookback).max() > 0
    fresh_cross = negative & was_pos
    return (negative | fresh_cross).astype(int)


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


# ═══════════════════════════════════════════════════════════════════════
# Market Structure — Higher High / Lower Low detection
# ═══════════════════════════════════════════════════════════════════════

def _find_swing_points(
    high: pd.Series,
    low: pd.Series,
    order: int = 5,
) -> tuple[list[tuple[int, float]], list[tuple[int, float]]]:
    """Detect swing highs/lows using a ±order bar window.

    A swing high is a bar whose high is the highest in [i-order, i+order].
    A swing low is a bar whose low is the lowest in [i-order, i+order].

    Returns (swing_highs, swing_lows) as lists of (index_position, price).
    """
    swing_highs: list[tuple[int, float]] = []
    swing_lows: list[tuple[int, float]] = []

    h_vals = high.values
    l_vals = low.values
    n = len(h_vals)

    for i in range(order, n - order):
        # Swing high: bar i is highest in window
        window_h = h_vals[i - order : i + order + 1]
        if h_vals[i] == window_h.max() and h_vals[i] > h_vals[i - 1]:
            swing_highs.append((i, float(h_vals[i])))

        # Swing low: bar i is lowest in window
        window_l = l_vals[i - order : i + order + 1]
        if l_vals[i] == window_l.min() and l_vals[i] < l_vals[i - 1]:
            swing_lows.append((i, float(l_vals[i])))

    return swing_highs, swing_lows


def market_structure(
    high: pd.Series,
    low: pd.Series,
    close: pd.Series,
    lookback: int = 100,
    swing_order: int = 5,
) -> pd.Series:
    """Detect market structure over *lookback* bars.

    Returns a Series with values:
       1 = BULL  (Higher Highs + Higher Lows)
      -1 = BEAR  (Lower Highs + Lower Lows)
       0 = SIDEWAYS (横盘) — mixed or no clear structure

    Logic:
    - Find swing highs and swing lows within the lookback window
    - Compare the last 3+ swing points to determine trend
    - HH + HL = bullish structure → BUY
    - LH + LL = bearish structure → SELL
    - Mixed = sideways → CLEAR orders
    """
    n = len(close)
    result = pd.Series(0, index=close.index, dtype=int)

    for i in range(lookback, n):
        # Window of lookback bars ending at i
        start = max(0, i - lookback)
        h_window = high.iloc[start : i + 1]
        l_window = low.iloc[start : i + 1]

        swing_highs, swing_lows = _find_swing_points(h_window, l_window, order=swing_order)

        # Need at least 2 swing highs and 2 swing lows to determine structure
        if len(swing_highs) < 2 or len(swing_lows) < 2:
            result.iloc[i] = 0
            continue

        # Take last 3 swing points (or all if < 3)
        recent_highs = swing_highs[-3:]
        recent_lows = swing_lows[-3:]

        # Check higher highs: each swing high > previous
        hh_count = sum(
            1 for j in range(1, len(recent_highs))
            if recent_highs[j][1] > recent_highs[j - 1][1]
        )
        # Check higher lows
        hl_count = sum(
            1 for j in range(1, len(recent_lows))
            if recent_lows[j][1] > recent_lows[j - 1][1]
        )
        # Check lower highs
        lh_count = sum(
            1 for j in range(1, len(recent_highs))
            if recent_highs[j][1] < recent_highs[j - 1][1]
        )
        # Check lower lows
        ll_count = sum(
            1 for j in range(1, len(recent_lows))
            if recent_lows[j][1] < recent_lows[j - 1][1]
        )

        max_pairs = len(recent_highs) - 1  # max possible comparisons

        # Bull: majority HH + HL
        if hh_count >= max_pairs and hl_count >= max_pairs:
            result.iloc[i] = 1
        # Bear: majority LH + LL
        elif lh_count >= max_pairs and ll_count >= max_pairs:
            result.iloc[i] = -1
        # Sideways (横盘): mixed
        else:
            result.iloc[i] = 0

    return result
