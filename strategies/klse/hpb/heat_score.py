"""
heat_score.py — Market Heat Score (0–100) for HPB strategy.

Combines RSI, Volume, Trend (EMA50 vs EMA200), and ATR expansion
into a single composite score.
"""
from __future__ import annotations

import numpy as np

from .config import HEAT_WEIGHTS


def compute_heat_score(
    rsi_vals: np.ndarray,
    volumes: np.ndarray,
    avg_vol: np.ndarray,
    ema50: np.ndarray,
    ema200: np.ndarray,
    atr_vals: np.ndarray,
    atr_mean: np.ndarray,
) -> np.ndarray:
    """
    Compute bar-by-bar HeatScore (0–100).

    Components (each normalised 0–1):
      RSI_score   = clamp((RSI - 30) / 40, 0, 1)   # bullish zone 30-70 → 0-1
      Vol_score   = min(volume / avg_volume, 3.0) / 3.0
      Trend_score = clamp((EMA50-EMA200)/EMA200*20 + 0.5, 0, 1)  # proportional
      ATR_score   = min(ATR / ATR_mean, 2.0) / 2.0

    Final = weighted sum × 100
    """
    n = len(rsi_vals)
    score = np.full(n, np.nan)

    w = HEAT_WEIGHTS

    for i in range(n):
        if np.isnan(rsi_vals[i]) or np.isnan(ema50[i]) or np.isnan(ema200[i]):
            continue
        if np.isnan(atr_vals[i]) or np.isnan(atr_mean[i]) or atr_mean[i] == 0:
            continue
        if np.isnan(avg_vol[i]) or avg_vol[i] == 0:
            continue

        rsi_s = max(0.0, min((rsi_vals[i] - 30.0) / 40.0, 1.0))  # bullish zone
        vol_s = min(volumes[i] / avg_vol[i], 3.0) / 3.0
        trend_gap = (ema50[i] - ema200[i]) / ema200[i] * 20.0 + 0.5
        trend_s = max(0.0, min(trend_gap, 1.0))  # proportional, not binary
        atr_s = min(atr_vals[i] / atr_mean[i], 2.0) / 2.0

        score[i] = (
            rsi_s * w["rsi"]
            + vol_s * w["volume"]
            + trend_s * w["trend"]
            + atr_s * w["atr"]
        ) * 100.0

    return score
