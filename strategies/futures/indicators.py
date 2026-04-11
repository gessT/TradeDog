"""
MGC Technical Indicators
========================
Pure-pandas / numpy implementations — no TA-Lib dependency.
"""
from __future__ import annotations

import numpy as np
import pandas as pd


# ═══════════════════════════════════════════════════════════════════════
# Moving Averages
# ═══════════════════════════════════════════════════════════════════════

def ema(series: pd.Series, period: int) -> pd.Series:
    """Exponential Moving Average."""
    return series.ewm(span=period, adjust=False).mean()


def sma(series: pd.Series, period: int) -> pd.Series:
    """Simple Moving Average."""
    return series.rolling(window=period, min_periods=period).mean()


# ═══════════════════════════════════════════════════════════════════════
# RSI
# ═══════════════════════════════════════════════════════════════════════

def rsi(series: pd.Series, period: int = 14) -> pd.Series:
    """Relative Strength Index (Wilder smoothing)."""
    delta = series.diff()
    gain = delta.clip(lower=0)
    loss = (-delta).clip(lower=0)
    avg_gain = gain.ewm(alpha=1.0 / period, min_periods=period, adjust=False).mean()
    avg_loss = loss.ewm(alpha=1.0 / period, min_periods=period, adjust=False).mean()
    rs = avg_gain / avg_loss.replace(0, np.nan)
    return (100.0 - (100.0 / (1.0 + rs))).fillna(50.0)


# ═══════════════════════════════════════════════════════════════════════
# ATR
# ═══════════════════════════════════════════════════════════════════════

def atr(high: pd.Series, low: pd.Series, close: pd.Series, period: int = 14) -> pd.Series:
    """Average True Range (EMA smoothing)."""
    prev_close = close.shift(1)
    tr = pd.concat(
        [high - low, (high - prev_close).abs(), (low - prev_close).abs()],
        axis=1,
    ).max(axis=1)
    return tr.ewm(span=period, adjust=False).mean()


# ═══════════════════════════════════════════════════════════════════════
# Supertrend
# ═══════════════════════════════════════════════════════════════════════

def supertrend(
    high: pd.Series,
    low: pd.Series,
    close: pd.Series,
    period: int = 10,
    multiplier: float = 3.0,
) -> tuple[pd.Series, pd.Series]:
    """Supertrend indicator.

    Returns
    -------
    st_line : pd.Series   — Supertrend value per bar
    direction : pd.Series  — +1 bullish, -1 bearish
    """
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
        # Clamp lower band upward
        if lower[i] < lower[i - 1] and c[i - 1] > lower[i - 1]:
            lower[i] = lower[i - 1]
        # Clamp upper band downward
        if upper[i] > upper[i - 1] and c[i - 1] < upper[i - 1]:
            upper[i] = upper[i - 1]

        if trend[i - 1] == 1:  # was bullish
            if c[i] < lower[i]:
                trend[i] = -1
                st[i] = upper[i]
            else:
                trend[i] = 1
                st[i] = lower[i]
        else:  # was bearish
            if c[i] > upper[i]:
                trend[i] = 1
                st[i] = lower[i]
            else:
                trend[i] = -1
                st[i] = upper[i]

    return (
        pd.Series(st, index=close.index, name="supertrend"),
        pd.Series(trend, index=close.index, name="st_direction"),
    )


# ═══════════════════════════════════════════════════════════════════════
# Candlestick Patterns
# ═══════════════════════════════════════════════════════════════════════

def is_bullish_candle(open_s: pd.Series, close_s: pd.Series) -> pd.Series:
    """True when close > open (green candle)."""
    return close_s > open_s


def is_bullish_engulfing(
    open_s: pd.Series,
    high_s: pd.Series,
    low_s: pd.Series,
    close_s: pd.Series,
) -> pd.Series:
    """Bullish engulfing: current green candle body fully engulfs previous red candle body."""
    prev_open = open_s.shift(1)
    prev_close = close_s.shift(1)
    prev_red = prev_close < prev_open
    cur_green = close_s > open_s
    engulfs = (open_s <= prev_close) & (close_s >= prev_open)
    return prev_red & cur_green & engulfs


# ═══════════════════════════════════════════════════════════════════════
# Volume
# ═══════════════════════════════════════════════════════════════════════

def volume_above_ma(volume: pd.Series, period: int = 20, multiplier: float = 1.2) -> pd.Series:
    """True when volume exceeds `multiplier` × SMA(volume, period)."""
    vol_ma = volume.rolling(window=period, min_periods=1).mean()
    return volume > multiplier * vol_ma
