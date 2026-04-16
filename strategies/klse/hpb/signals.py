"""
signals.py — Entry / exit signal generation for HPB strategy.

Builds all indicators on a DataFrame, then returns entry_signals array.
Exit is handled bar-by-bar in the backtest engine (SL / TP / trailing).
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from .config import HPBParams
from .indicators import ema, rsi, atr, sma, highest_high, avg_volume
from .heat_score import compute_heat_score


def build_indicators(df: pd.DataFrame, params: HPBParams) -> pd.DataFrame:
    """
    Attach all HPB indicator columns to the DataFrame.

    Expects columns: open, high, low, close, volume (and 'date' or DatetimeIndex).
    """
    df = df.copy()
    h = df["high"].values.astype(float)
    l = df["low"].values.astype(float)
    c = df["close"].values.astype(float)
    v = df["volume"].values.astype(float)

    df["ema50"] = ema(c, params.ema_fast)
    df["ema200"] = ema(c, params.ema_slow)
    df["rsi"] = rsi(c, params.rsi_period)
    df["atr"] = atr(h, l, c, params.atr_period)
    df["atr_mean"] = sma(df["atr"].values, 20)
    df["avg_vol"] = avg_volume(v, params.vol_avg_period)
    df["highest_high"] = highest_high(h, params.breakout_period)

    df["heat_score"] = compute_heat_score(
        rsi_vals=df["rsi"].values,
        volumes=v,
        avg_vol=df["avg_vol"].values,
        ema50=df["ema50"].values,
        ema200=df["ema200"].values,
        atr_vals=df["atr"].values,
        atr_mean=df["atr_mean"].values,
    )

    return df


def generate_entry_signals(df: pd.DataFrame, params: HPBParams) -> np.ndarray:
    """
    Return boolean array — True where all LONG entry conditions are met.

    Conditions:
      1. HeatScore > heat_threshold (default 70)
      2. Close > EMA50 AND Close > EMA200
      3. Close > Highest High (last N bars)
      4. Volume > vol_mult × avg_volume
      5. (optional) ATR > ATR_mean (skip sideways)
    """
    n = len(df)
    signals = np.zeros(n, dtype=bool)

    c = df["close"].values
    ema50 = df["ema50"].values
    ema200 = df["ema200"].values
    heat = df["heat_score"].values
    hh = df["highest_high"].values
    vol = df["volume"].values.astype(float)
    avg_v = df["avg_vol"].values
    atr_vals = df["atr"].values
    atr_mean = df["atr_mean"].values

    for i in range(n):
        if np.isnan(heat[i]) or np.isnan(hh[i]):
            continue

        # Core conditions
        if heat[i] <= params.heat_threshold:
            continue
        if c[i] <= ema50[i] or c[i] <= ema200[i]:
            continue
        if c[i] <= hh[i]:
            continue
        if np.isnan(avg_v[i]) or avg_v[i] == 0:
            continue
        if vol[i] <= params.vol_mult * avg_v[i]:
            continue

        # Optional ATR filter — skip sideways
        if params.skip_low_atr:
            if np.isnan(atr_mean[i]) or atr_mean[i] == 0:
                continue
            if atr_vals[i] < atr_mean[i]:
                continue

        signals[i] = True

    return signals
