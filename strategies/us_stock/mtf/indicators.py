"""
MTF Strategy — Indicators
==========================
Daily: SuperTrend, HalfTrend, SMA
4H:    EMA fast/slow, RSI, ATR
"""
from __future__ import annotations

import math
import numpy as np
import pandas as pd


# ═══════════════════════════════════════════════════════════════════════
# Primitives
# ═══════════════════════════════════════════════════════════════════════

def ema(series: pd.Series, period: int) -> pd.Series:
    return series.ewm(span=period, adjust=False).mean()


def sma(series: pd.Series, period: int) -> pd.Series:
    return series.rolling(window=period, min_periods=period).mean()


def rsi(close: pd.Series, period: int = 14) -> pd.Series:
    delta = close.diff()
    gain = delta.clip(lower=0)
    loss = -delta.clip(upper=0)
    avg_gain = gain.ewm(alpha=1.0 / period, min_periods=period, adjust=False).mean()
    avg_loss = loss.ewm(alpha=1.0 / period, min_periods=period, adjust=False).mean()
    rs = avg_gain / avg_loss.replace(0, 1e-10)
    return 100.0 - (100.0 / (1.0 + rs))


def atr(high: pd.Series, low: pd.Series, close: pd.Series, period: int = 14) -> pd.Series:
    prev_close = close.shift(1)
    tr = pd.concat(
        [high - low, (high - prev_close).abs(), (low - prev_close).abs()],
        axis=1,
    ).max(axis=1)
    return tr.ewm(span=period, adjust=False).mean()


# ═══════════════════════════════════════════════════════════════════════
# SuperTrend  (pandas-vectorised inner loop)
# ═══════════════════════════════════════════════════════════════════════

def supertrend(
    high: pd.Series,
    low: pd.Series,
    close: pd.Series,
    period: int = 10,
    multiplier: float = 3.0,
) -> tuple[pd.Series, pd.Series]:
    """Return (st_line, direction).  direction: +1 bullish, −1 bearish."""
    atr_val = atr(high, low, close, period)
    hl2 = (high + low) / 2.0

    upper = (hl2 + multiplier * atr_val).values.copy()
    lower = (hl2 - multiplier * atr_val).values.copy()
    c = close.values
    n = len(c)

    trend = np.ones(n, dtype=np.int8)
    st = np.empty(n, dtype=np.float64)
    st[0] = upper[0]
    trend[0] = -1

    for i in range(1, n):
        if lower[i] < lower[i - 1] and c[i - 1] > lower[i - 1]:
            lower[i] = lower[i - 1]
        if upper[i] > upper[i - 1] and c[i - 1] < upper[i - 1]:
            upper[i] = upper[i - 1]

        if trend[i - 1] == 1:
            if c[i] < lower[i]:
                trend[i] = -1
                st[i] = upper[i]
            else:
                trend[i] = 1
                st[i] = lower[i]
        else:
            if c[i] > upper[i]:
                trend[i] = 1
                st[i] = lower[i]
            else:
                trend[i] = -1
                st[i] = upper[i]

    return (
        pd.Series(st, index=close.index, name="supertrend"),
        pd.Series(trend, index=close.index, name="st_dir"),
    )


# ═══════════════════════════════════════════════════════════════════════
# HalfTrend  (list-based, faithful Pine Script port)
# ═══════════════════════════════════════════════════════════════════════

def halftrend(
    high: pd.Series,
    low: pd.Series,
    close: pd.Series,
    amplitude: int = 5,
    channel_deviation: float = 2.0,
    atr_length: int = 100,
) -> tuple[pd.Series, pd.Series]:
    """Return (ht_line, ht_dir).  ht_dir: 0 = up, 1 = down."""
    highs = high.values
    lows = low.values
    closes = close.values
    n = len(closes)

    trend_arr = np.zeros(n, dtype=np.int8)
    ht_arr = np.full(n, np.nan, dtype=np.float64)

    next_trend = 0
    max_low = lows[0]
    min_high = highs[0]
    up_val = lows[0]
    down_val = highs[0]
    ht_arr[0] = up_val

    for i in range(1, n):
        start = max(0, i - amplitude + 1)
        high_price = highs[start: i + 1].max()
        low_price = lows[start: i + 1].min()

        high_ma = highs[start: i + 1].mean()
        low_ma = lows[start: i + 1].mean()

        cur_trend = trend_arr[i - 1]

        if next_trend == 1:
            max_low = max(low_price, max_low)
            if high_ma < max_low and closes[i] < lows[i - 1]:
                cur_trend = 1
                next_trend = 0
                min_high = high_price
        else:
            min_high = min(high_price, min_high)
            if low_ma > min_high and closes[i] > highs[i - 1]:
                cur_trend = 0
                next_trend = 1
                max_low = low_price

        trend_arr[i] = cur_trend

        if cur_trend == 0:  # uptrend
            if trend_arr[i - 1] != 0:
                up_val = down_val if not math.isnan(down_val) else max_low
            else:
                up_val = max(max_low, up_val)
            ht_arr[i] = up_val
        else:  # downtrend
            if trend_arr[i - 1] != 1:
                down_val = up_val if not math.isnan(up_val) else min_high
            else:
                down_val = min(min_high, down_val)
            ht_arr[i] = down_val

    return (
        pd.Series(ht_arr, index=close.index, name="ht_line"),
        pd.Series(trend_arr, index=close.index, name="ht_dir"),
    )
