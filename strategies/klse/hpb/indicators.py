"""
indicators.py — Technical indicator calculations for HPB strategy.

All functions operate on numpy arrays for speed.
"""
from __future__ import annotations

import numpy as np


def ema(values: np.ndarray, period: int) -> np.ndarray:
    """Exponential moving average."""
    out = np.full_like(values, np.nan, dtype=float)
    if len(values) < period:
        return out
    k = 2.0 / (period + 1)
    out[period - 1] = np.mean(values[:period])
    for i in range(period, len(values)):
        out[i] = values[i] * k + out[i - 1] * (1 - k)
    return out


def rsi(closes: np.ndarray, period: int = 14) -> np.ndarray:
    """Wilder RSI."""
    out = np.full(len(closes), np.nan)
    if len(closes) < period + 1:
        return out
    deltas = np.diff(closes)
    gains = np.where(deltas > 0, deltas, 0.0)
    losses = np.where(deltas < 0, -deltas, 0.0)

    avg_gain = np.mean(gains[:period])
    avg_loss = np.mean(losses[:period])
    out[period] = 100.0 - 100.0 / (1 + avg_gain / avg_loss) if avg_loss > 0 else 100.0

    for i in range(period, len(deltas)):
        avg_gain = (avg_gain * (period - 1) + gains[i]) / period
        avg_loss = (avg_loss * (period - 1) + losses[i]) / period
        out[i + 1] = 100.0 - 100.0 / (1 + avg_gain / avg_loss) if avg_loss > 0 else 100.0
    return out


def atr(highs: np.ndarray, lows: np.ndarray, closes: np.ndarray,
        period: int = 14) -> np.ndarray:
    """Average True Range (Wilder RMA)."""
    n = len(highs)
    out = np.full(n, np.nan)
    if n < 2:
        return out

    tr = np.empty(n)
    tr[0] = highs[0] - lows[0]
    for i in range(1, n):
        tr[i] = max(highs[i] - lows[i],
                     abs(highs[i] - closes[i - 1]),
                     abs(lows[i] - closes[i - 1]))

    if n < period:
        return out
    out[period - 1] = np.mean(tr[:period])
    for i in range(period, n):
        out[i] = (out[i - 1] * (period - 1) + tr[i]) / period
    return out


def sma(values: np.ndarray, period: int) -> np.ndarray:
    """Simple moving average (NaN-safe)."""
    out = np.full_like(values, np.nan, dtype=float)
    n = len(values)
    if n < period:
        return out
    for i in range(period - 1, n):
        window = values[i - period + 1:i + 1]
        valid = window[~np.isnan(window)]
        if len(valid) == period:
            out[i] = np.mean(valid)
    return out


def highest_high(highs: np.ndarray, period: int) -> np.ndarray:
    """Rolling highest high over `period` bars (not including current bar)."""
    n = len(highs)
    out = np.full(n, np.nan)
    for i in range(period, n):
        out[i] = np.max(highs[i - period:i])
    return out


def avg_volume(volumes: np.ndarray, period: int = 20) -> np.ndarray:
    """Rolling average volume."""
    return sma(volumes, period)
