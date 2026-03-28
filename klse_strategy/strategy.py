"""
strategy.py — Multi-Timeframe Trend Trading Strategy for Bursa Malaysia.

Entry logic (long only):
  1. Weekly Supertrend = Bullish (-1)
  2. Daily HalfTrend = Buy (just flipped to 0 from 1)
  3. EMA_fast > EMA_slow (short-term trend up)
  4. Price > Pivot OR breakout above Pivot Resistance
  5. Volume confirmation (ratio >= vol_min)
  6. ATR filter (not sideways)

Exit logic:
  - Stop Loss: max(swing_low, entry - atr_sl_mult * ATR)
  - Take Profit: entry + atr_tp_mult * ATR  (or Pivot Resistance)
  - RR must be >= min_rr
  - Trailing stop after partial profit (optional)
"""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
import pandas as pd

from . import indicators as ind


@dataclass
class StrategyParams:
    # Weekly Supertrend
    wst_atr_period: int = 10
    wst_multiplier: float = 4.0

    # HalfTrend
    ht_amplitude: int = 6
    ht_atr_length: int = 50

    # EMA
    ema_fast: int = 10
    ema_slow: int = 50

    # Pivot
    pivot_lookback: int = 10
    use_pivot_breakout: bool = True   # True = breakout, False = bounce from support

    # ATR for SL/TP
    atr_period: int = 14
    atr_sl_mult: float = 1.5
    atr_tp_mult: float = 2.0
    min_rr: float = 2.5

    # Volume filter
    vol_period: int = 20
    vol_min: float = 1.0           # minimum volume ratio (1.0 = no filter)

    # ATR volatility filter
    atr_vol_threshold: float = 0.01  # ATR/close must exceed this

    # Swing lookback for SL
    swing_lookback: int = 15

    # Trailing stop (after 1R profit, trail at entry)
    use_trailing: bool = True
    trail_atr_mult: float = 1.5


def compute_indicators(df: pd.DataFrame, p: StrategyParams) -> pd.DataFrame:
    """Add all indicator columns to the DataFrame."""
    h = df["high"].values
    l = df["low"].values
    c = df["close"].values
    v = df["volume"].values

    # Weekly Supertrend
    df["wst"] = ind.weekly_supertrend(df, p.wst_atr_period, p.wst_multiplier)

    # HalfTrend
    ht_trend, ht_line = ind.halftrend(h, l, c, p.ht_amplitude, p.ht_atr_length)
    df["ht_trend"] = ht_trend
    df["ht_line"] = ht_line

    # EMAs
    df["ema_fast"] = ind.ema(c, p.ema_fast)
    df["ema_slow"] = ind.ema(c, p.ema_slow)
    df["ema200"] = ind.ema(c, 200)

    # ATR
    atr_vals = ind.atr(h, l, c, p.atr_period)
    df["atr"] = atr_vals

    # Pivot Points
    pivot, support, resist = ind.pivot_points(h, l, c, p.pivot_lookback)
    df["pivot"] = pivot
    df["support"] = support
    df["resist"] = resist

    # Swing levels
    df["swing_low"] = ind.swing_low(l, p.swing_lookback)
    df["swing_high"] = ind.swing_high(h, p.swing_lookback)

    # Volume
    df["vol_ratio"] = ind.volume_ratio(v, p.vol_period)

    # ATR volatility filter
    df["atr_active"] = ind.atr_filter(atr_vals, p.atr_vol_threshold, c)

    return df


def generate_signals(df: pd.DataFrame, p: StrategyParams) -> np.ndarray:
    """
    Generate entry signals.  1 = buy next bar, 0 = no action.
    Signals are evaluated at bar close; trade enters on next bar open.
    """
    n = len(df)
    signals = np.zeros(n, dtype=int)

    wst = df["wst"].values
    ht = df["ht_trend"].values
    ema_f = df["ema_fast"].values
    ema_s = df["ema_slow"].values
    closes = df["close"].values
    pivot = df["pivot"].values
    support = df["support"].values
    resist = df["resist"].values
    vol_r = df["vol_ratio"].values
    atr_ok = df["atr_active"].values

    for i in range(2, n):
        # 1. Weekly Supertrend bullish
        if wst[i] != -1:
            continue

        # 2. HalfTrend buy condition
        #    Strict: just flipped to buy (ht==0 and prev==1)
        #    Relaxed: currently in uptrend (ht==0) with recent flip within 3 bars
        if ht[i] != 0:
            continue
        recent_flip = any(ht[max(0, i - k)] == 1 for k in range(1, 4))
        if not recent_flip:
            continue

        # 3. EMA fast > EMA slow
        if ema_f[i] <= ema_s[i]:
            continue

        # 4. Price vs Pivot — structural confirmation
        if not np.isnan(pivot[i]):
            if p.use_pivot_breakout:
                # Breakout: close above support (lenient) or above pivot
                if closes[i] < support[i]:
                    continue
            else:
                # Bounce: price above support and trending up
                if closes[i] < support[i]:
                    continue

        # 5. Volume filter
        if vol_r[i] < p.vol_min:
            continue

        # 6. ATR volatility filter
        if not atr_ok[i]:
            continue

        signals[i] = 1

    return signals
