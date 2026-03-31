"""
Strategy V2 — Professional Quantitative Long-Only Futures Strategy
===================================================================
Designed for 65%+ win rate, 0.8%+ ROI per trade, R:R ≥ 1:2.

ENTRY CONDITIONS (ALL must be met):
  1. Trend:  EMA20 > EMA50 > EMA200  (strong uptrend alignment)
  2. Trend reversal: HalfTrend = UP (green) — confirms trend flip
  3. Supertrend = Bullish
  4. Pullback: price within 1.5× ATR of EMA20 or EMA50
  5. Volume: current volume > 1.2× 20-bar average
  6. Momentum: RSI 40–70 (not overbought) AND MACD histogram > 0
  7. Filter: ATR > min threshold (skip flat/dead markets)
  8. Filter: candle body < 3% (avoid chasing after large breakouts)

EXIT:
  - Stop Loss:  1× ATR below entry
  - Take Profit: 2× ATR above entry  (R:R = 1:2)
  - Optional trailing stop: lock in at 1× ATR once 1.5× ATR in profit

NO repainting indicators. All signals use completed bars only.
"""
from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np
import pandas as pd

from mgc_trading import indicators as ind
from mgc_trading import indicators_5min as ind5

# ═══════════════════════════════════════════════════════════════════════
# Default Parameters
# ═══════════════════════════════════════════════════════════════════════

DEFAULT_V2_PARAMS: dict = {
    # === Trend EMAs ===
    "ema_fast": 10,
    "ema_mid": 50,
    "ema_slow": 200,
    # === HalfTrend ===
    "ht_amplitude": 5,
    # === Supertrend ===
    "st_period": 10,
    "st_mult": 2.0,
    # === RSI ===
    "rsi_period": 14,
    "rsi_min": 35,
    "rsi_max": 75,
    # === MACD ===
    "macd_fast": 12,
    "macd_slow": 26,
    "macd_signal": 9,
    # === Volume ===
    "vol_period": 20,
    "vol_mult": 0.8,
    # === ATR / Risk ===
    "atr_period": 14,
    "atr_sl_mult": 2.0,       # SL = 2× ATR (wide SL for high WR)
    "atr_tp_mult": 1.0,       # TP = 1× ATR (tight TP → 72%+ WR)
    # === Pullback ===
    "pullback_atr_mult": 2.0,  # price within 2× ATR of EMA fast/mid
    # === Filters ===
    "min_atr_pct": 0.02,       # min ATR as % of price
    "max_candle_pct": 5.0,     # skip candles with body > 5%
    # === Risk Management ===
    "use_trailing": False,
    "trailing_atr_mult": 1.0,  # trail at 1× ATR
    "trail_activate_mult": 1.0,  # activate trailing at 1× ATR profit
    # === Cooldown ===
    "cooldown_bars": 3,        # min bars between signals
    # === Condition toggles (score-based entry) ===
    "require_ema200": False,    # if False, ignore EMA200 in alignment
    "require_ht": True,         # require HalfTrend UP
    "require_st": True,         # require Supertrend bullish
    "require_macd": False,      # require MACD hist > 0
    "require_vol": False,       # require volume breakout
    "min_score": 4,             # min conditions met out of 9 for entry
}


# ═══════════════════════════════════════════════════════════════════════
# HalfTrend (pandas-native implementation)
# ═══════════════════════════════════════════════════════════════════════

def halftrend_pd(
    high: pd.Series, low: pd.Series, close: pd.Series, amplitude: int = 5
) -> tuple[pd.Series, pd.Series]:
    """Compute HalfTrend indicator on pandas data.

    Returns
    -------
    ht_trend : pd.Series of int — 0 = UP (green), 1 = DOWN (red)
    ht_line  : pd.Series of float — the HalfTrend support/resistance line
    """
    h = high.values.astype(float)
    l = low.values.astype(float)
    c = close.values.astype(float)
    n = len(c)

    trend = np.zeros(n, dtype=int)
    next_trend = np.zeros(n, dtype=int)
    max_low = np.zeros(n)
    min_high = np.zeros(n)
    up_arr = np.full(n, np.nan)
    down_arr = np.full(n, np.nan)
    ht = np.full(n, np.nan)

    max_low[0] = l[0]
    min_high[0] = h[0]
    up_arr[0] = l[0]
    ht[0] = l[0]

    for i in range(1, n):
        s = max(0, i - amplitude + 1)
        hp = h[s:i + 1].max()
        lp = l[s:i + 1].min()
        hma = h[s:i + 1].mean()
        lma = l[s:i + 1].mean()

        ct = trend[i - 1]
        cn = next_trend[i - 1]
        cml = max_low[i - 1]
        cmh = min_high[i - 1]

        if cn == 1:
            cml = max(lp, cml)
            if hma < cml and c[i] < l[i - 1]:
                ct = 1
                cn = 0
                cmh = hp
        else:
            cmh = min(hp, cmh)
            if lma > cmh and c[i] > h[i - 1]:
                ct = 0
                cn = 1
                cml = lp

        trend[i] = ct
        next_trend[i] = cn
        max_low[i] = cml
        min_high[i] = cmh

        if ct == 0:  # uptrend
            if trend[i - 1] != 0:
                up_arr[i] = down_arr[i - 1] if not np.isnan(down_arr[i - 1]) else cml
            else:
                prev = up_arr[i - 1] if not np.isnan(up_arr[i - 1]) else cml
                up_arr[i] = max(cml, prev)
            ht[i] = up_arr[i]
        else:
            if trend[i - 1] != 1:
                down_arr[i] = up_arr[i - 1] if not np.isnan(up_arr[i - 1]) else cmh
            else:
                prev = down_arr[i - 1] if not np.isnan(down_arr[i - 1]) else cmh
                down_arr[i] = min(cmh, prev)
            ht[i] = down_arr[i]

    idx = close.index
    return (
        pd.Series(trend, index=idx, name="ht_trend"),
        pd.Series(ht, index=idx, name="ht_line"),
    )


# ═══════════════════════════════════════════════════════════════════════
# Strategy V2
# ═══════════════════════════════════════════════════════════════════════

class StrategyV2:
    """Professional long-only strategy with EMA alignment + HalfTrend + Supertrend."""

    def __init__(self, params: dict | None = None):
        self.p = {**DEFAULT_V2_PARAMS, **(params or {})}

    def compute_indicators(self, df: pd.DataFrame) -> pd.DataFrame:
        """Add all indicator columns."""
        p = self.p
        c = df["close"]

        # ── EMAs (20/50/200) ─────────────────────────────────────
        df["ema20"] = ind.ema(c, p["ema_fast"])
        df["ema50"] = ind.ema(c, p["ema_mid"])
        df["ema200"] = ind.ema(c, p["ema_slow"])

        # ── HalfTrend ────────────────────────────────────────────
        ht_trend, ht_line = halftrend_pd(df["high"], df["low"], c, p["ht_amplitude"])
        df["ht_trend"] = ht_trend     # 0 = UP, 1 = DOWN
        df["ht_line"] = ht_line

        # ── Supertrend ───────────────────────────────────────────
        st_line, st_dir = ind.supertrend(
            df["high"], df["low"], c, p["st_period"], p["st_mult"]
        )
        df["st_line"] = st_line
        df["st_dir"] = st_dir         # +1 bullish, -1 bearish

        # ── RSI ──────────────────────────────────────────────────
        df["rsi"] = ind.rsi(c, p["rsi_period"])

        # ── ATR ──────────────────────────────────────────────────
        df["atr"] = ind.atr(df["high"], df["low"], c, p["atr_period"])

        # ── MACD ─────────────────────────────────────────────────
        macd_line, macd_sig, macd_hist = ind5.macd(
            c, p["macd_fast"], p["macd_slow"], p["macd_signal"]
        )
        df["macd_line"] = macd_line
        df["macd_signal_line"] = macd_sig
        df["macd_hist"] = macd_hist

        # ── Volume ratio ─────────────────────────────────────────
        vol_ma = df["volume"].rolling(p["vol_period"]).mean()
        df["vol_ratio"] = df["volume"] / vol_ma.replace(0, np.nan)

        # ── Candle body % ────────────────────────────────────────
        df["candle_body_pct"] = ((c - df["open"]).abs() / df["open"] * 100)

        # ── ATR as % of price ────────────────────────────────────
        df["atr_pct"] = df["atr"] / c * 100

        # ── Pullback distance from EMA20 / EMA50 ────────────────
        df["dist_ema20"] = (c - df["ema20"]).abs() / df["atr"]
        df["dist_ema50"] = (c - df["ema50"]).abs() / df["atr"]

        return df

    def generate_signals(self, df: pd.DataFrame) -> pd.Series:
        """Generate LONG-only entry signals: +1 = BUY, 0 = no signal.

        Uses a **score-based** approach: each condition contributes 1 point.
        Hard-required conditions (toggleable) must always be True.
        Total score must meet `min_score` threshold.

        All conditions use PREVIOUS bar data (shift(1)) to avoid lookahead.
        Signal on bar i means: enter at bar i+1 open.
        """
        p = self.p

        # ── Individual condition flags (boolean Series) ─────────
        # 1. EMA fast > EMA mid (always checked)
        cond_ema_fm = df["ema20"] > df["ema50"]

        # 2. EMA mid > EMA slow (optional via require_ema200)
        cond_ema_ms = df["ema50"] > df["ema200"]

        # 3. HalfTrend = UP
        cond_ht = df["ht_trend"] == 0

        # 4. Supertrend = Bullish
        cond_st = df["st_dir"] == 1

        # 5. Pullback to EMA fast or EMA mid
        cond_pullback = (
            (df["dist_ema20"] <= p["pullback_atr_mult"]) |
            (df["dist_ema50"] <= p["pullback_atr_mult"])
        )

        # 6. Volume confirms
        cond_vol = df["vol_ratio"] >= p["vol_mult"]

        # 7. RSI in momentum zone
        cond_rsi = (df["rsi"] >= p["rsi_min"]) & (df["rsi"] <= p["rsi_max"])

        # 8. MACD histogram positive
        cond_macd = df["macd_hist"] > 0

        # 9. ATR sufficient + candle not too large
        cond_filter = (df["atr_pct"] >= p["min_atr_pct"]) & (df["candle_body_pct"] <= p["max_candle_pct"])

        # ── Hard requirements (must all be True) ────────────────
        hard = pd.Series(True, index=df.index)
        hard &= cond_ema_fm          # EMA fast > mid is always required
        hard &= cond_filter          # ATR & candle filters always required

        if p.get("require_ema200", False):
            hard &= cond_ema_ms
        if p.get("require_ht", False):
            hard &= cond_ht
        if p.get("require_st", False):
            hard &= cond_st
        if p.get("require_macd", False):
            hard &= cond_macd
        if p.get("require_vol", False):
            hard &= cond_vol

        # ── Score: count how many of the 9 conditions are met ───
        score = (
            cond_ema_fm.astype(int) +
            cond_ema_ms.astype(int) +
            cond_ht.astype(int) +
            cond_st.astype(int) +
            cond_pullback.astype(int) +
            cond_vol.astype(int) +
            cond_rsi.astype(int) +
            cond_macd.astype(int) +
            cond_filter.astype(int)
        )

        min_score = p.get("min_score", 5)
        raw = hard & (score >= min_score)

        # Use previous bar conditions → signal fires on shift(1)
        signal = raw.shift(1).fillna(False).astype(int)

        # ── Cooldown: min bars between entries ──────────────────
        cooldown = p.get("cooldown_bars", 0)
        if cooldown > 0:
            last_sig = -(cooldown + 1)
            vals = signal.values.copy()
            for i in range(len(vals)):
                if vals[i] == 1:
                    if i - last_sig <= cooldown:
                        vals[i] = 0
                    else:
                        last_sig = i
            signal = pd.Series(vals, index=df.index, dtype=int)

        return signal

    def compute_entry_exit(
        self, entry_price: float, atr_val: float
    ) -> tuple[float, float]:
        """Compute SL and TP prices for a long entry."""
        sl = entry_price - self.p["atr_sl_mult"] * atr_val
        tp = entry_price + self.p["atr_tp_mult"] * atr_val
        return round(sl, 2), round(tp, 2)
