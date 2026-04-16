"""
strategy.py — SMP (Smart Money Pivot) Strategy for Bursa Malaysia.

Modern TradingView-style indicators combined for high win-rate on small-cap KLSE stocks:
  • Pivot Points (swing high/low) — dynamic S/R for breakout detection
  • Smart Money Concepts:
    - Break of Structure (BOS) — higher highs confirm uptrend
    - Order Blocks (OB) — last bearish candle before bullish impulse = demand zone
    - Fair Value Gaps (FVG) — imbalance zones for pullback entries
  • EMA 21/55 — fast trend + structural trend
  • RSI Momentum — avoid extremes, confirm strength
  • Volume Profile — confirm institutional participation

Architecture (daily bars, KLSE-optimised):
  • Scoring system: require min_score out of 7 conditions
  • Dual entry: pivot breakout OR FVG/OB pullback bounce
  • SL = below order block or swing low
  • TP = R-multiple with trailing stop
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from strategies.klse.hpb.indicators import ema, rsi, atr, sma, avg_volume

# ═══════════════════════════════════════════════════════════
# Default parameters — tuned for Pekat Group (0233.KL) daily bars
# ═══════════════════════════════════════════════════════════

DEFAULT_PARAMS: dict = {
    # ── Trend EMAs ──
    "ema_fast": 13,
    "ema_slow": 34,

    # ── Pivot / Swing detection ──
    "pivot_lookback": 5,       # bars left/right for swing high/low detection
    "breakout_lookback": 10,   # break above N-bar high for entry

    # ── Smart Money: Order Block ──
    "ob_lookback": 20,         # how far back to scan for last bearish candle before bullish move
    "ob_atr_zone": 1.5,        # OB zone extends 1.5× ATR below the OB candle high

    # ── Smart Money: Fair Value Gap ──
    "fvg_min_gap_atr": 0.3,    # min gap size = 0.3× ATR to qualify as FVG

    # ── Volume ──
    "vol_period": 20,
    "vol_multiplier": 1.2,     # volume > 1.2× avg for confirmation

    # ── RSI filter ──
    "rsi_period": 14,
    "rsi_min": 40,
    "rsi_max": 72,

    # ── ATR ──
    "atr_period": 14,

    # ── Scoring ──
    "min_score": 4,            # require 4 out of 7 conditions

    # ── Risk management ──
    "sl_lookback": 4,          # swing low of N bars for SL
    "min_sl_atr": 0.3,         # min SL distance = 0.3× ATR
    "tp_r_multiple": 2.0,      # TP = 2.0× risk
    "risk_pct": 5.0,           # risk 5% of equity per trade
    "use_trailing": True,
    "trailing_atr_mult": 2.5,  # trail at 2.5× ATR from peak

    # ── Cooldown ──
    "cooldown_bars": 1,
}

# Valid condition keys for UI disable toggles
VALID_CONDITIONS = {
    "ema_trend", "bos", "pivot_breakout", "order_block",
    "fvg_pullback", "vol_confirm", "rsi_filter",
    "sl_exit", "tp_exit", "trail_exit",
}


def _detect_swing_highs_lows(h: np.ndarray, l: np.ndarray, lookback: int):
    """Detect pivot swing highs and swing lows using left/right window."""
    n = len(h)
    swing_high = np.full(n, np.nan)
    swing_low = np.full(n, np.nan)

    for i in range(lookback, n - lookback):
        # Swing high: h[i] is the highest in range [i-lookback, i+lookback]
        if h[i] == np.max(h[i - lookback:i + lookback + 1]):
            swing_high[i] = h[i]
        # Swing low: l[i] is the lowest in range
        if l[i] == np.min(l[i - lookback:i + lookback + 1]):
            swing_low[i] = l[i]

    return swing_high, swing_low


def _detect_bos(h: np.ndarray, swing_high: np.ndarray) -> np.ndarray:
    """Break of Structure: close above the most recent swing high."""
    n = len(h)
    bos = np.zeros(n, dtype=int)
    last_sh = np.nan

    for i in range(n):
        if not np.isnan(swing_high[i]):
            last_sh = swing_high[i]
        if not np.isnan(last_sh) and h[i] > last_sh:
            bos[i] = 1

    return bos


def _detect_order_blocks(o: np.ndarray, c: np.ndarray, h: np.ndarray,
                         l: np.ndarray, lookback: int) -> tuple[np.ndarray, np.ndarray]:
    """Detect bullish Order Blocks: last bearish candle before a significant bullish move.
    Returns (ob_top, ob_bottom) arrays — the OB zone for each bar.
    """
    n = len(c)
    ob_top = np.full(n, np.nan)
    ob_bottom = np.full(n, np.nan)

    for i in range(2, n):
        # Look for: bearish candle at [j] followed by bullish impulse (close[i] > high[j])
        for j in range(max(0, i - lookback), i):
            if c[j] < o[j]:  # bearish candle
                # Check if price has moved up significantly from this candle
                if c[i] > h[j] and (c[i] - h[j]) / h[j] > 0.005:  # 0.5% above OB high
                    ob_top[i] = h[j]
                    ob_bottom[i] = l[j]
                    break  # use the most recent OB

    return ob_top, ob_bottom


def _detect_fvg(h: np.ndarray, l: np.ndarray, c: np.ndarray,
                atr_vals: np.ndarray, min_gap_atr: float) -> tuple[np.ndarray, np.ndarray]:
    """Detect bullish Fair Value Gaps: gap between candle[i-2] high and candle[i] low.
    Returns (fvg_top, fvg_bottom) — the FVG zone.
    """
    n = len(h)
    fvg_top = np.full(n, np.nan)
    fvg_bottom = np.full(n, np.nan)

    for i in range(2, n):
        # Bullish FVG: candle[i] low > candle[i-2] high (gap up)
        gap = l[i] - h[i - 2]
        if gap > 0 and not np.isnan(atr_vals[i]):
            if gap >= min_gap_atr * atr_vals[i]:
                fvg_top[i] = l[i]       # top of gap
                fvg_bottom[i] = h[i - 2]  # bottom of gap

    return fvg_top, fvg_bottom


def build_indicators(df: pd.DataFrame, params: dict) -> pd.DataFrame:
    """Attach all SMP indicator columns to daily DataFrame."""
    df = df.copy()
    h = df["high"].values.astype(float)
    l = df["low"].values.astype(float)
    c = df["close"].values.astype(float)
    o = df["open"].values.astype(float)
    v = df["volume"].values.astype(float)

    # Core indicators
    df["ema_fast"] = ema(c, params["ema_fast"])
    df["ema_slow"] = ema(c, params["ema_slow"])
    df["rsi"] = rsi(c, params["rsi_period"])
    df["atr"] = atr(h, l, c, params["atr_period"])
    df["atr_mean"] = sma(df["atr"].values, 20)
    df["vol_ma"] = avg_volume(v, params["vol_period"])

    # Pivot swing highs/lows
    pivot_lb = params["pivot_lookback"]
    swing_high, swing_low = _detect_swing_highs_lows(h, l, pivot_lb)
    df["swing_high"] = swing_high
    df["swing_low_pivot"] = swing_low

    # Break of Structure
    df["bos"] = _detect_bos(c, swing_high)

    # Highest high for breakout
    from strategies.klse.hpb.indicators import highest_high
    df["highest_high"] = highest_high(h, params["breakout_lookback"])

    # Order Blocks
    ob_top, ob_bottom = _detect_order_blocks(o, c, h, l, params["ob_lookback"])
    df["ob_top"] = ob_top
    df["ob_bottom"] = ob_bottom

    # Fair Value Gaps
    fvg_top, fvg_bottom = _detect_fvg(h, l, c, df["atr"].values, params["fvg_min_gap_atr"])
    df["fvg_top"] = fvg_top
    df["fvg_bottom"] = fvg_bottom

    # Swing low for SL
    sl_lb = params["sl_lookback"]
    n = len(df)
    lowest = np.full(n, np.nan)
    for i in range(sl_lb, n):
        lowest[i] = np.min(l[i - sl_lb:i])
    df["swing_low"] = lowest

    return df


def generate_signals(df: pd.DataFrame, params: dict,
                     disabled: set[str] | None = None) -> np.ndarray:
    """Generate daily entry signals using Smart Money + Pivot scoring system.

    Conditions (each = 1 point):
      1. ema_trend    — Close > EMA21 > EMA55 (gate — required)
      2. bos          — Break of Structure detected (higher high)
      3. pivot_breakout — Close > breakout_lookback-bar highest high
      4. order_block  — Price is near/bouncing from a bullish Order Block
      5. fvg_pullback — Price pulled back into a Fair Value Gap
      6. vol_confirm  — Volume > vol_multiplier × avg
      7. rsi_filter   — RSI between rsi_min and rsi_max
    """
    off = disabled or set()
    n = len(df)
    signals = np.zeros(n, dtype=bool)

    c = df["close"].values
    o = df["open"].values
    h = df["high"].values
    l_vals = df["low"].values
    v = df["volume"].values.astype(float)
    ema_f = df["ema_fast"].values
    ema_s = df["ema_slow"].values
    rsi_vals = df["rsi"].values
    atr_vals = df["atr"].values
    vol_ma = df["vol_ma"].values
    hh = df["highest_high"].values
    bos = df["bos"].values
    ob_top = df["ob_top"].values
    ob_bottom = df["ob_bottom"].values

    cooldown = params["cooldown_bars"]
    min_score = params.get("min_score", 4)
    last_signal = -cooldown - 1

    # Track recent FVGs (within last 10 bars)
    fvg_zones: list[tuple[float, float, int]] = []  # (top, bottom, bar_idx)

    for i in range(max(params["breakout_lookback"], params["sl_lookback"], 10) + 1, n):
        if i - last_signal <= cooldown:
            continue

        # Track FVG zones
        if not np.isnan(df["fvg_top"].values[i]):
            fvg_zones.append((df["fvg_top"].values[i], df["fvg_bottom"].values[i], i))
        # Keep only recent FVGs (within 10 bars)
        fvg_zones = [(t, b, idx) for t, b, idx in fvg_zones if i - idx <= 10]

        score = 0

        # 1. EMA trend gate (required — acts as filter, not scored)
        if "ema_trend" not in off:
            if np.isnan(ema_f[i]) or np.isnan(ema_s[i]):
                continue
            if c[i] <= ema_f[i] or ema_f[i] <= ema_s[i]:
                continue

        # 2. Break of Structure
        if "bos" not in off:
            # BOS in last 3 bars
            if any(bos[max(0, i - 3):i + 1]):
                score += 1

        # 3. Pivot Breakout — close above N-bar high
        if "pivot_breakout" not in off:
            if not np.isnan(hh[i]) and c[i] > hh[i]:
                score += 1

        # 4. Order Block — price near a bullish OB zone (bouncing from demand)
        if "order_block" not in off:
            if not np.isnan(ob_top[i]) and not np.isnan(ob_bottom[i]):
                # Price recently visited OB zone or is near it
                ob_zone_dist = atr_vals[i] * params["ob_atr_zone"] if not np.isnan(atr_vals[i]) else 0
                if l_vals[i] <= ob_top[i] + ob_zone_dist and c[i] > ob_bottom[i]:
                    score += 1

        # 5. Fair Value Gap pullback — price pulled into a recent FVG
        if "fvg_pullback" not in off:
            for fvg_t, fvg_b, _ in fvg_zones:
                if l_vals[i] <= fvg_t and c[i] >= fvg_b and c[i] > o[i]:
                    score += 1
                    break

        # 6. Volume confirmation
        if "vol_confirm" not in off:
            if not np.isnan(vol_ma[i]) and vol_ma[i] > 0:
                if v[i] > params["vol_multiplier"] * vol_ma[i]:
                    score += 1

        # 7. RSI filter
        if "rsi_filter" not in off:
            if not np.isnan(rsi_vals[i]):
                if params["rsi_min"] <= rsi_vals[i] <= params["rsi_max"]:
                    score += 1

        if score >= min_score:
            signals[i] = True
            last_signal = i

    return signals
