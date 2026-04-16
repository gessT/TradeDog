"""
strategy.py — VPB3 Malaysia (量价突破) Daily Volume-Price Breakout for Bursa Malaysia.

Core theory (量价关系):
  量缩价稳 → accumulation (volume shrinks, price holds = coiling)
  量增价升 → breakout (volume surges, price breaks out = entry)

Architecture (daily-only, optimised for KLSE):
  • EMA20/50 for trend direction
  • Scoring system: require min_score out of 7 conditions (not ALL)
  • Dual entry: breakout OR EMA-pullback bounce
  • Volume surge confirmation
  • RSI filter (avoid overbought)
  • Bullish candle quality
  • SL = swing low of N bars; TP = R-multiple

KLSE adaptations vs US version:
  • Daily bars only (no 1H — KLSE 1H data is limited on yfinance)
  • Scoring system (min 5/7) instead of requiring all conditions
  • EMA pullback entry added for blue-chip trend following
  • Higher TP (2.5R) and wider trailing for daily swings
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from strategies.klse.hpb.indicators import ema, rsi, atr, sma, highest_high, avg_volume

# ═══════════════════════════════════════════════════════════
# Default parameters — tuned for KLSE daily bars
# Scoring system: require min_score / 7 conditions to fire
# ═══════════════════════════════════════════════════════════

DEFAULT_PARAMS: dict = {
    # ── Trend ──
    "ema_fast": 20,
    "ema_slow": 50,

    # ── Accumulation detection ──
    "accum_min_bars": 2,        # relaxed: require ≥2 qualifying bars
    "accum_lookback": 10,       # wider window for detection
    "accum_vol_ratio": 0.90,    # volume < 90% of avg (relaxed)
    "accum_range_atr": 1.8,     # daily range < 1.8× ATR (relaxed)

    # ── Breakout ──
    "breakout_lookback": 8,     # break above 8-day high

    # ── Volume ──
    "vol_period": 20,
    "vol_multiplier": 1.2,      # relaxed: volume > 1.2× avg

    # ── RSI filter ──
    "rsi_period": 14,
    "rsi_min": 40,              # wider band for blue chips
    "rsi_max": 72,              # allow stronger momentum

    # ── Candle quality ──
    "body_ratio_min": 0.25,     # relaxed: body ≥ 25% of range
    "close_top_pct": 0.40,      # close in top 40% of range

    # ── ATR filter ──
    "atr_period": 14,
    "skip_low_atr": False,      # DISABLED by default (was filtering too much)

    # ── EMA pullback entry (new) ──
    "pullback_enabled": True,   # enable EMA pullback bounce entry
    "pullback_atr_dist": 1.0,   # max distance from EMA20 = 1.0× ATR

    # ── Scoring ──
    "min_score": 4,             # require 4 out of 7 conditions (relaxed for blue chips)

    # ── Risk management ──
    "sl_lookback": 5,           # swing low of 5 bars
    "min_sl_atr": 0.7,          # min SL distance = 0.7× ATR
    "tp_r_multiple": 3.0,       # TP = 3.0× risk (let winners run on daily)
    "risk_pct": 5.0,            # 5% of equity risked per trade
    "use_trailing": True,       # trailing stop enabled
    "trailing_atr_mult": 2.5,   # wider trail at 2.5× ATR from peak

    # ── Cooldown ──
    "cooldown_bars": 2,         # 2 bars between trades (faster re-entry)
}

# Valid condition keys for UI disable toggles
VALID_CONDITIONS = {
    "ema_trend", "accum", "breakout", "vol_surge",
    "rsi", "candle_quality", "atr_filter", "pullback",
    "sl_exit", "tp_exit", "trail_exit",
}


def build_indicators(df: pd.DataFrame, params: dict) -> pd.DataFrame:
    """Attach all VPB3 indicator columns to daily DataFrame."""
    df = df.copy()
    h = df["high"].values.astype(float)
    l = df["low"].values.astype(float)
    c = df["close"].values.astype(float)
    o = df["open"].values.astype(float)
    v = df["volume"].values.astype(float)

    df["ema_fast"] = ema(c, params["ema_fast"])
    df["ema_slow"] = ema(c, params["ema_slow"])
    df["rsi"] = rsi(c, params["rsi_period"])
    df["atr"] = atr(h, l, c, params["atr_period"])
    df["atr_mean"] = sma(df["atr"].values, 20)
    df["vol_ma"] = avg_volume(v, params["vol_period"])
    df["highest_high"] = highest_high(h, params["breakout_lookback"])

    # Lowest low for SL placement
    sl_lb = params["sl_lookback"]
    n = len(df)
    lowest = np.full(n, np.nan)
    for i in range(sl_lb, n):
        lowest[i] = np.min(l[i - sl_lb:i])
    df["swing_low"] = lowest

    # Candle metrics
    candle_range = (h - l).copy()
    candle_range[candle_range == 0] = np.nan
    body = np.abs(c - o)
    df["body_ratio"] = body / candle_range
    df["close_pos"] = (c - l) / candle_range  # 1.0 = close at high

    # Accumulation detection
    min_bars = params["accum_min_bars"]
    if min_bars <= 0:
        df["in_accum"] = 1
    else:
        vol_low = v < (df["vol_ma"].values * params["accum_vol_ratio"])
        range_tight = (h - l) < (df["atr"].values * params["accum_range_atr"])
        qualify = (vol_low & range_tight).astype(int)
        lb = params["accum_lookback"]
        count = pd.Series(qualify).rolling(lb, min_periods=min_bars).sum().values
        df["in_accum"] = (count >= min_bars).astype(int)

    # EMA pullback detection: price near EMA20 and bouncing
    ema_f = df["ema_fast"].values
    atr_vals = df["atr"].values
    dist = params.get("pullback_atr_dist", 1.0)
    # Price was near/below EMA20 recently and now closing above it
    near_ema = np.abs(c - ema_f) <= (dist * atr_vals)
    bouncing = (c > o) & (c > ema_f)  # bullish + above EMA
    was_near = np.zeros(n, dtype=bool)
    for i in range(3, n):
        # Any of last 3 bars was near or below EMA20
        was_near[i] = any(l[j] <= ema_f[j] * 1.01 for j in range(max(0, i - 3), i))
    df["pullback_bounce"] = ((near_ema | was_near) & bouncing).astype(int)

    return df


def generate_signals(df: pd.DataFrame, params: dict,
                     disabled: set[str] | None = None) -> np.ndarray:
    """Generate daily entry signals using scoring system.

    Each condition contributes 1 point. Entry requires min_score points.
    Signal at bar[i] → entry at bar[i+1] open (handled by backtester).
    """
    off = disabled or set()
    n = len(df)
    signals = np.zeros(n, dtype=bool)

    c = df["close"].values
    o = df["open"].values
    h = df["high"].values
    v = df["volume"].values.astype(float)
    ema_f = df["ema_fast"].values
    ema_s = df["ema_slow"].values
    rsi_vals = df["rsi"].values
    hh = df["highest_high"].values
    vol_ma = df["vol_ma"].values
    body_ratio = df["body_ratio"].values
    close_pos = df["close_pos"].values
    atr_vals = df["atr"].values
    atr_mean = df["atr_mean"].values
    in_accum = df["in_accum"].values
    pullback = df["pullback_bounce"].values

    cooldown = params["cooldown_bars"]
    min_score = params.get("min_score", 5)
    last_signal = -cooldown - 1

    for i in range(max(params["breakout_lookback"], params["sl_lookback"]) + 1, n):
        if i - last_signal <= cooldown:
            continue

        score = 0
        max_possible = 0  # track how many conditions are enabled

        # 1. EMA trend: close > EMA20 > EMA50 (REQUIRED — not scored, acts as gate)
        if "ema_trend" not in off:
            if np.isnan(ema_f[i]) or np.isnan(ema_s[i]):
                continue
            if c[i] <= ema_f[i] or ema_f[i] <= ema_s[i]:
                # Allow if pullback bounce is active
                pullback_ok = (params.get("pullback_enabled") and "pullback" not in off
                               and pullback[i] == 1 and not np.isnan(ema_s[i])
                               and ema_f[i] > ema_s[i])  # at least EMA20 > EMA50
                if not pullback_ok:
                    continue

        # 2. Accumulation: ≥M of last N bars had low vol + tight range
        if "accum" not in off:
            max_possible += 1
            if in_accum[i] == 1:
                score += 1

        # 3. Breakout OR Pullback bounce (either gives a point)
        if "breakout" not in off:
            max_possible += 1
            breakout_hit = not np.isnan(hh[i]) and c[i] > hh[i]
            pullback_hit = (params.get("pullback_enabled") and "pullback" not in off
                           and pullback[i] == 1)
            if breakout_hit or pullback_hit:
                score += 1
                if breakout_hit and pullback_hit:
                    score += 1  # bonus for both
                    max_possible += 1

        # 4. Volume surge: volume > multiplier × vol_ma
        if "vol_surge" not in off:
            max_possible += 1
            if not np.isnan(vol_ma[i]) and vol_ma[i] > 0:
                if v[i] > vol_ma[i] * params["vol_multiplier"]:
                    score += 1

        # 5. RSI filter
        if "rsi" not in off:
            max_possible += 1
            if not np.isnan(rsi_vals[i]):
                if params["rsi_min"] <= rsi_vals[i] <= params["rsi_max"]:
                    score += 1

        # 6. Candle quality: bullish, body > min, close near high
        if "candle_quality" not in off:
            max_possible += 1
            if (c[i] > o[i]
                and not np.isnan(body_ratio[i]) and body_ratio[i] >= params["body_ratio_min"]
                and not np.isnan(close_pos[i]) and close_pos[i] >= (1.0 - params["close_top_pct"])):
                score += 1

        # 7. ATR expansion (skip sideways)
        if "atr_filter" not in off:
            max_possible += 1
            if params["skip_low_atr"]:
                if (not np.isnan(atr_mean[i]) and atr_mean[i] > 0
                    and atr_vals[i] >= atr_mean[i]):
                    score += 1
            else:
                score += 1  # auto-pass when filter disabled

        # Require minimum score
        effective_min = min(min_score, max_possible) if max_possible > 0 else min_score
        if score >= effective_min:
            signals[i] = True
            last_signal = i

    return signals
