"""
strategy.py — Weekly Trend + HalfTrend Confirmation Strategy.

INDICATORS:
  - HalfTrend (amplitude, channelDeviation, ATR deviation)
  - Weekly Supertrend (ATR period, factor)

ENTRY (Long only):
  BUY when: Weekly Supertrend is green (bullish) AND HalfTrend turns green
  on the same day. Both conditions must be true together.
  Max 2 buy entries per weekly bullish cycle, then wait for next cycle.

EXIT:
  - HalfTrend turns red (bearish) → close ALL
  - Stop Loss = entry - ATR * sl_atr_mult (hard safety)
  - Take Profit = entry + ATR * tp_atr_mult

POSITION:
  - Max 2 entries per weekly bullish cycle
  - Reset buy_count when weekly trend flips bearish then back to bullish
"""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
import pandas as pd

from . import indicators as ind


@dataclass
class StrategyParams:
    # HalfTrend
    ht_amplitude: int = 5
    ht_channel_deviation: int = 2

    # Weekly Supertrend
    wst_atr_period: int = 10
    wst_multiplier: float = 3.0

    # ATR for SL/TP
    atr_period: int = 14
    sl_atr_mult: float = 1.0     # Stop  = entry - ATR * 1.0
    tp_atr_mult: float = 2.0     # Profit = entry + ATR * 2.0

    # Risk per trade
    risk_pct: float = 1.0        # 1% of equity per trade

    # Max entries per trend cycle
    max_entries: int = 2

    # Trailing stop (optional enhancement)
    use_trailing: bool = False
    trail_atr_mult: float = 2.0

    # Swing lookback for alternative SL
    swing_lookback: int = 15


def compute_indicators(df: pd.DataFrame, p: StrategyParams) -> pd.DataFrame:
    """Compute all indicator columns on the DataFrame."""
    h = df["high"].values
    l = df["low"].values
    c = df["close"].values

    # Weekly Supertrend (no lookahead)
    df["wst_dir"] = ind.weekly_supertrend(df, p.wst_atr_period, p.wst_multiplier)

    # HalfTrend with exact Pine Script logic
    ht_trend, ht_line, ht_buy, ht_sell = ind.halftrend(
        h, l, c, p.ht_amplitude, p.ht_channel_deviation
    )
    df["ht_trend"] = ht_trend      # 0 = bullish, 1 = bearish
    df["ht_line"] = ht_line
    df["ht_buy"] = ht_buy          # 1 = buy signal (bearish→bullish)
    df["ht_sell"] = ht_sell         # 1 = sell signal (bullish→bearish)

    # ATR for SL/TP sizing
    df["atr"] = ind.atr(h, l, c, p.atr_period)

    # Weekly Supertrend flip signals
    wst = df["wst_dir"].values
    big_flip_up = np.zeros(len(c), dtype=int)
    big_flip_down = np.zeros(len(c), dtype=int)
    for i in range(1, len(c)):
        if wst[i] == -1 and wst[i - 1] == 1:
            big_flip_up[i] = 1   # bearish → bullish
        elif wst[i] == 1 and wst[i - 1] == -1:
            big_flip_down[i] = 1  # bullish → bearish
    df["big_flip_up"] = big_flip_up
    df["big_flip_down"] = big_flip_down

    # Swing low for SL reference
    df["swing_low"] = ind.swing_low(l, p.swing_lookback)

    return df


def generate_signals(df: pd.DataFrame, p: StrategyParams) -> tuple[np.ndarray, np.ndarray]:
    """
    Generate entry/exit signals.

    BUY:  Any day where Weekly Supertrend is green (wst_dir == -1)
          AND HalfTrend is green (ht_trend == 0) → can buy.
          Max 2 buys per weekly bullish cycle.

    SELL: HalfTrend turns red (ht_sell) → close ALL (take profit / cut loss).
          buy_count resets when a new weekly bullish cycle starts.

    Returns
    -------
    entry_signals : ndarray (1 = enter long next bar)
    exit_signals  : ndarray (1 = exit all next bar)
    """
    n = len(df)
    entry_signals = np.zeros(n, dtype=int)
    exit_signals = np.zeros(n, dtype=int)

    wst_dir = df["wst_dir"].values
    ht_trend = df["ht_trend"].values
    ht_sell = df["ht_sell"].values
    big_flip_up = df["big_flip_up"].values

    buy_count = 0
    in_position = False

    for i in range(1, n):
        # New weekly bullish cycle → reset buy_count
        if big_flip_up[i]:
            buy_count = 0

        # EXIT: HalfTrend turns red → close ALL (profit / cut)
        if ht_sell[i] and in_position:
            exit_signals[i] = 1
            in_position = False

        # BUY: Weekly green + HalfTrend green + not already in position + within limit
        if wst_dir[i] == -1 and ht_trend[i] == 0 and not in_position and buy_count < p.max_entries:
            entry_signals[i] = 1
            buy_count += 1
            in_position = True

    return entry_signals, exit_signals
