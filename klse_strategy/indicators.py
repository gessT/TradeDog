"""
indicators.py — Technical indicators for HalfTrend + Weekly Supertrend strategy.

Implements exact Pine Script logic:
  - HalfTrend with amplitude, channelDeviation, ATR deviation
  - Supertrend (ATR-based, factor/period configurable)
  - Weekly Supertrend aggregation (no lookahead)
  - ATR (Wilder RMA)
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


# ─── SMA ───────────────────────────────────────────────────────────────
def sma(values: np.ndarray, period: int) -> np.ndarray:
    """Simple Moving Average."""
    s = pd.Series(values)
    return s.rolling(period, min_periods=1).mean().to_numpy()


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
    Supertrend matching Pine Script ta.supertrend().

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
    Compute Weekly Supertrend and map back to daily bars WITHOUT lookahead.

    Each daily bar sees only the COMPLETED weekly Supertrend (prev week).
    The current week's partial data updates the weekly candle but the
    Supertrend direction used is from the *last completed* weekly bar
    until the current week closes.

    Returns ndarray (len == daily bars): -1 = bullish, +1 = bearish.
    """
    dates = daily_df["date"].values
    highs = daily_df["high"].values.astype(float)
    lows = daily_df["low"].values.astype(float)
    closes = daily_df["close"].values.astype(float)
    n = len(dates)

    # Aggregate daily → weekly
    w_highs, w_lows, w_closes = [], [], []
    week_map = np.zeros(n, dtype=int)  # daily idx → week idx
    w_idx = -1

    for i in range(n):
        dt = pd.Timestamp(dates[i])
        new_week = (i == 0
                    or dt.isocalendar()[1] != pd.Timestamp(dates[i - 1]).isocalendar()[1]
                    or dt.year != pd.Timestamp(dates[i - 1]).year)
        if new_week:
            w_idx += 1
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

    # Map weekly direction back to daily (use PREVIOUS completed week to avoid lookahead)
    # Within current week, use dir from previous completed week
    out = np.ones(n)
    for i in range(n):
        wi = week_map[i]
        # Use the completed previous week's direction
        if wi > 0:
            out[i] = w_dir[wi - 1]
        else:
            out[i] = w_dir[0]  # first week, no prior data
    return out


# ─── HalfTrend (exact Pine Script replica) ────────────────────────────
def halftrend(highs: np.ndarray, lows: np.ndarray, closes: np.ndarray,
              amplitude: int = 5, channel_deviation: int = 2
              ) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    """
    Exact Pine Script HalfTrend indicator.

    Pine Script reference:
      amplitude = input(5)
      channelDeviation = input(2)
      Uses ATR(100) for channel width, SMA of high/low for trend detection.

    Parameters
    ----------
    amplitude : int
        Lookback for highest/lowest and SMA of high/low.
    channel_deviation : int
        Multiplier for ATR-based channel deviation.

    Returns
    -------
    trend       : ndarray  0 = uptrend (bullish), 1 = downtrend (bearish)
    ht_line     : ndarray  HalfTrend line value
    buy_signal  : ndarray  1 = buy signal (trend flipped bullish), 0 = no signal
    sell_signal : ndarray  1 = sell signal (trend flipped bearish), 0 = no signal
    """
    n = len(closes)
    trend = np.zeros(n, dtype=int)
    ht_line = np.zeros(n)
    buy_signal = np.zeros(n, dtype=int)
    sell_signal = np.zeros(n, dtype=int)

    # ATR(100) for deviation channel — matches Pine default
    atr_vals = atr(highs, lows, closes, 100)
    dev = channel_deviation * atr_vals

    next_trend = 0
    max_low_price = lows[0]
    min_high_price = highs[0]
    up = 0.0
    down = 0.0
    atr_high = 0.0
    atr_low = 0.0

    for i in range(n):
        lo = max(0, i - amplitude)
        highest_val = np.max(highs[lo:i + 1])
        lowest_val = np.min(lows[lo:i + 1])
        # SMA of highs and lows over amplitude period
        high_ma = np.mean(highs[lo:i + 1])
        low_ma = np.mean(lows[lo:i + 1])

        prev_trend = trend[i - 1] if i > 0 else next_trend

        if next_trend == 1:
            # Currently bearish, check for flip to bullish
            max_low_price = max(lowest_val, max_low_price)
            if high_ma < max_low_price and closes[i] < (lows[max(0, i - 1)] if i > 0 else lows[0]):
                trend[i] = 0  # flip to bullish
                next_trend = 0
                min_high_price = highest_val
                # Set up line
                up = max(max_low_price, up if i > 0 else max_low_price)
            else:
                trend[i] = 1  # stay bearish
        else:
            # Currently bullish, check for flip to bearish
            min_high_price = min(highest_val, min_high_price)
            if low_ma > min_high_price and closes[i] > (highs[max(0, i - 1)] if i > 0 else highs[0]):
                trend[i] = 1  # flip to bearish
                next_trend = 1
                max_low_price = lowest_val
                # Set down line
                down = min(min_high_price, down if (i > 0 and down > 0) else min_high_price)
            else:
                trend[i] = 0  # stay bullish

        # Update HalfTrend line
        if trend[i] == 0:
            if prev_trend != 0:
                up = max(max_low_price, up if i > 0 else max_low_price)
            else:
                up = max(max_low_price, up)
            atr_high = up + dev[i]
            atr_low = up - dev[i]
            ht_line[i] = up
        else:
            if prev_trend != 1:
                down = min(min_high_price, down if (i > 0 and down > 0) else min_high_price)
            else:
                down = min(min_high_price, down if down > 0 else min_high_price)
            atr_high = down + dev[i]
            atr_low = down - dev[i]
            ht_line[i] = down

        # Detect signals: trend flip
        if i > 0:
            if trend[i] == 0 and trend[i - 1] == 1:
                buy_signal[i] = 1   # bearish → bullish
            elif trend[i] == 1 and trend[i - 1] == 0:
                sell_signal[i] = 1  # bullish → bearish

    return trend, ht_line, buy_signal, sell_signal


# ─── Swing Low detection ──────────────────────────────────────────────
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
    for i in range(1, n):
        if np.isnan(out[i]):
            out[i] = out[i - 1] if i > 0 else np.nan
    return out
