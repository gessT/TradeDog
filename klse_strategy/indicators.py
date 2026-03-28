"""
indicators.py — Technical indicators for Bursa Malaysia multi-timeframe strategy.

Implements: Supertrend, HalfTrend, EMA, ATR, Pivot Points.
All indicators are vectorised with numpy/pandas for speed.
"""
from __future__ import annotations

import numpy as np
import pandas as pd


# ─── ATR (Wilder RMA) ─────────────────────────────────────────────────
def atr(highs: np.ndarray, lows: np.ndarray, closes: np.ndarray,
        period: int = 14) -> np.ndarray:
    """Average True Range using Wilder's smoothing (RMA)."""
    n = len(closes)
    tr = np.zeros(n)
    tr[0] = highs[0] - lows[0]
    for i in range(1, n):
        tr[i] = max(highs[i] - lows[i],
                     abs(highs[i] - closes[i - 1]),
                     abs(lows[i] - closes[i - 1]))
    alpha = 1.0 / period
    out = np.zeros(n)
    out[0] = tr[0]
    for i in range(1, n):
        out[i] = alpha * tr[i] + (1 - alpha) * out[i - 1]
    return out


# ─── EMA ───────────────────────────────────────────────────────────────
def ema(values: np.ndarray, period: int) -> np.ndarray:
    """Exponential Moving Average."""
    s = pd.Series(values)
    return s.ewm(span=period, adjust=False).mean().to_numpy()


# ─── Supertrend ────────────────────────────────────────────────────────
def supertrend(highs: np.ndarray, lows: np.ndarray, closes: np.ndarray,
               atr_period: int = 10, multiplier: float = 3.0
               ) -> tuple[np.ndarray, np.ndarray]:
    """
    Compute Supertrend indicator.

    Returns
    -------
    direction : ndarray  (-1 = uptrend/bullish, +1 = downtrend/bearish)
    st_line   : ndarray  supertrend value
    """
    n = len(closes)
    atr_vals = atr(highs, lows, closes, atr_period)

    hl2 = (highs + lows) / 2.0
    up_band = hl2 - multiplier * atr_vals
    dn_band = hl2 + multiplier * atr_vals

    final_up = np.zeros(n)
    final_dn = np.zeros(n)
    direction = np.ones(n)   # start bearish
    st_line = np.zeros(n)

    final_up[0] = up_band[0]
    final_dn[0] = dn_band[0]

    for i in range(1, n):
        # Persist upper band
        final_up[i] = max(up_band[i], final_up[i - 1]) \
            if closes[i - 1] > final_up[i - 1] else up_band[i]
        # Persist lower band
        final_dn[i] = min(dn_band[i], final_dn[i - 1]) \
            if closes[i - 1] < final_dn[i - 1] else dn_band[i]

        # Direction flip
        if direction[i - 1] == 1 and closes[i] > final_dn[i - 1]:
            direction[i] = -1
        elif direction[i - 1] == -1 and closes[i] < final_up[i - 1]:
            direction[i] = 1
        else:
            direction[i] = direction[i - 1]

        st_line[i] = final_up[i] if direction[i] == -1 else final_dn[i]

    return direction, st_line


def weekly_supertrend(daily_df: pd.DataFrame,
                      atr_period: int = 10,
                      multiplier: float = 3.0) -> np.ndarray:
    """
    Compute Weekly Supertrend and map back to daily bars.

    Returns ndarray (len == daily bars): -1 = bullish, +1 = bearish.
    """
    dates = daily_df["date"].values
    highs = daily_df["high"].values.astype(float)
    lows = daily_df["low"].values.astype(float)
    closes = daily_df["close"].values.astype(float)
    n = len(dates)

    # Aggregate daily → weekly
    w_opens, w_highs, w_lows, w_closes = [], [], [], []
    week_map = np.zeros(n, dtype=int)  # daily idx → week idx
    w_idx = -1

    for i in range(n):
        dt = pd.Timestamp(dates[i])
        new_week = (i == 0
                    or dt.isocalendar()[1] != pd.Timestamp(dates[i - 1]).isocalendar()[1]
                    or dt.year != pd.Timestamp(dates[i - 1]).year)
        if new_week:
            w_idx += 1
            w_opens.append(daily_df["open"].iat[i])
            w_highs.append(highs[i])
            w_lows.append(lows[i])
            w_closes.append(closes[i])
        else:
            w_highs[w_idx] = max(w_highs[w_idx], highs[i])
            w_lows[w_idx] = min(w_lows[w_idx], lows[i])
            w_closes[w_idx] = closes[i]
        week_map[i] = w_idx

    w_h = np.array(w_highs)
    w_l = np.array(w_lows)
    w_c = np.array(w_closes)

    w_dir, _ = supertrend(w_h, w_l, w_c, atr_period, multiplier)

    # Map weekly direction back to daily
    return np.array([w_dir[week_map[i]] for i in range(n)])


# ─── HalfTrend ─────────────────────────────────────────────────────────
def halftrend(highs: np.ndarray, lows: np.ndarray, closes: np.ndarray,
              amplitude: int = 2, atr_length: int = 100
              ) -> tuple[np.ndarray, np.ndarray]:
    """
    Pine Script HalfTrend indicator.

    Returns
    -------
    trend : ndarray  0 = uptrend (buy), 1 = downtrend (sell)
    ht    : ndarray  halftrend line value
    """
    n = len(closes)
    trend = np.zeros(n, dtype=int)
    ht = np.zeros(n)

    atr_vals = atr(highs, lows, closes, atr_length)

    next_trend = 0
    max_low_price = lows[0]
    min_high_price = highs[0]
    up = 0.0
    down = 0.0

    for i in range(n):
        lo = max(0, i - amplitude)
        highest = np.max(highs[lo:i + 1])
        lowest = np.min(lows[lo:i + 1])
        high_ma = np.mean(highs[lo:i + 1])
        low_ma = np.mean(lows[lo:i + 1])

        if next_trend == 1:
            max_low_price = max(lowest, max_low_price)
            if high_ma < max_low_price and (i == 0 or closes[i] < lows[i - 1]):
                trend[i] = 0
                next_trend = 0
                min_high_price = highest
            else:
                trend[i] = 1
        else:
            min_high_price = min(highest, min_high_price)
            if low_ma > min_high_price and (i == 0 or closes[i] > highs[i - 1]):
                trend[i] = 1
                next_trend = 1
                max_low_price = lowest
            else:
                trend[i] = 0

        if trend[i] == 0:
            up = max(max_low_price, up if i > 0 else max_low_price)
            ht[i] = up
        else:
            down = min(min_high_price, down if (i > 0 and down > 0) else min_high_price)
            ht[i] = down

    return trend, ht


# ─── Pivot Points (Support / Resistance) ──────────────────────────────
def pivot_points(highs: np.ndarray, lows: np.ndarray, closes: np.ndarray,
                 lookback: int = 10
                 ) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """
    Classic Pivot with rolling lookback.

    Returns
    -------
    pivot   : ndarray (PP = (H + L + C) / 3 over lookback)
    support : ndarray (S1 = 2*PP - H)
    resist  : ndarray (R1 = 2*PP - L)
    """
    n = len(closes)
    pivot = np.full(n, np.nan)
    support = np.full(n, np.nan)
    resist = np.full(n, np.nan)

    for i in range(lookback, n):
        h = np.max(highs[i - lookback:i])
        l = np.min(lows[i - lookback:i])
        c = closes[i - 1]
        pp = (h + l + c) / 3.0
        pivot[i] = pp
        support[i] = 2 * pp - h
        resist[i] = 2 * pp - l

    return pivot, support, resist


# ─── Swing High / Low detection ───────────────────────────────────────
def swing_low(lows: np.ndarray, lookback: int = 10) -> np.ndarray:
    """Return rolling swing low (confirmed minimum over ±lookback bars)."""
    n = len(lows)
    out = np.full(n, np.nan)
    last_swing = np.nan
    for i in range(lookback, n - lookback):
        window = lows[i - lookback:i + lookback + 1]
        if lows[i] == np.min(window):
            last_swing = lows[i]
        out[i + lookback] = last_swing
    # Forward fill
    for i in range(1, n):
        if np.isnan(out[i]):
            out[i] = out[i - 1] if i > 0 else np.nan
    return out


def swing_high(highs: np.ndarray, lookback: int = 10) -> np.ndarray:
    """Return rolling swing high."""
    n = len(highs)
    out = np.full(n, np.nan)
    last_swing = np.nan
    for i in range(lookback, n - lookback):
        window = highs[i - lookback:i + lookback + 1]
        if highs[i] == np.max(window):
            last_swing = highs[i]
        out[i + lookback] = last_swing
    for i in range(1, n):
        if np.isnan(out[i]):
            out[i] = out[i - 1] if i > 0 else np.nan
    return out


# ─── Volume filter ─────────────────────────────────────────────────────
def volume_ratio(volumes: np.ndarray, period: int = 20) -> np.ndarray:
    """Rolling volume / SMA(volume, period)."""
    s = pd.Series(volumes)
    avg = s.rolling(period, min_periods=1).mean()
    return (s / avg.replace(0, 1)).to_numpy()


# ─── ATR volatility filter (avoid flat markets) ───────────────────────
def atr_filter(atr_vals: np.ndarray, threshold_pct: float = 0.02,
               closes: np.ndarray | None = None) -> np.ndarray:
    """Return True where ATR / close > threshold (market is moving)."""
    if closes is None:
        return np.ones(len(atr_vals), dtype=bool)
    ratio = atr_vals / np.where(closes > 0, closes, 1.0)
    return ratio > threshold_pct
