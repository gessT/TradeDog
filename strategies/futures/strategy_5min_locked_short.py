"""
GMC 5-Minute Locked Strategy — SHORT
======================================
SHORT-only, rule-based structure breakdown strategy for Micro Gold Futures.
Mirror of strategy_5min_locked.py with all conditions inverted for short side.

Entry Rules (ALL required):
  1. HTF Bias    — 1H EMA20 < 1H EMA50  (higher-timeframe downtrend)
  2. EMA Filter  — 5m close < EMA50  (price below medium-term anchor)
  3. Breakout    — 5m close < lowest low of last N bars  (BoS: Break of Structure down)
  4. Supertrend  — Supertrend direction = -1  (bearish regime)
  5. ATR Filter  — ATR > atr_min_pct × close  (skip flat/choppy market)
  6. Session     — Bar UTC hour in active session

Exit Rules:
  - Take Profit : entry − tp_atr_mult × ATR
  - Stop Loss   : entry + sl_atr_mult × ATR
  - Trailing    : (optional) trail at trail_atr_mult × ATR from trough
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from . import indicators as ind


# ═══════════════════════════════════════════════════════════════════════
# Default Parameters
# ═══════════════════════════════════════════════════════════════════════

DEFAULT_LOCKED_SHORT_PARAMS: dict = {
    # HTF bias — 1H EMA pair
    "htf_ema_fast": 20,
    "htf_ema_slow": 50,
    # 5m EMA anchor
    "ema_fast": 20,
    "ema_slow": 50,
    # Breakdown lookback (bars)
    "bos_lookback": 5,
    # Supertrend
    "st_period": 14,
    "st_mult": 1.5,
    # ATR
    "atr_period": 14,
    "sl_atr_mult": 2.0,
    "tp_atr_mult": 2.0,
    # Trailing stop
    "use_trailing": False,
    "trail_atr_mult": 1.0,
    # Flat-market filter
    "atr_min_pct": 0.02,
    # Session filter — all active hours (24/7 gold futures)
    "active_hours": set(range(24)),
    # Cooldown: minimum bars between entries
    "cooldown_bars": 2,
    # RSI confirmation (rsi_max=0 to disable)
    "rsi_period": 14,
    "rsi_max": 50,
}


# ═══════════════════════════════════════════════════════════════════════
# Indicator Helpers
# ═══════════════════════════════════════════════════════════════════════

def _ema(s: pd.Series, n: int) -> pd.Series:
    return s.ewm(span=n, adjust=False).mean()


def _rsi(close: pd.Series, period: int = 14) -> pd.Series:
    delta = close.diff()
    gain  = delta.clip(lower=0)
    loss  = (-delta).clip(lower=0)
    ag    = gain.ewm(alpha=1.0 / period, min_periods=period, adjust=False).mean()
    al    = loss.ewm(alpha=1.0 / period, min_periods=period, adjust=False).mean()
    rs    = ag / al.replace(0, np.nan)
    return (100.0 - 100.0 / (1.0 + rs)).fillna(50.0)


# ═══════════════════════════════════════════════════════════════════════
# Strategy Class
# ═══════════════════════════════════════════════════════════════════════

class LockedStrategy5MinShort:
    """
    5-minute GMC bearish structure breakdown strategy (SHORT-only).

    Workflow::

        strat = LockedStrategy5MinShort(params)
        df_5m_ind = strat.compute_indicators(df_5m, df_1h)
        signals   = strat.generate_signals(df_5m_ind)
    """

    def __init__(self, params: dict | None = None) -> None:
        self.params = {**DEFAULT_LOCKED_SHORT_PARAMS, **(params or {})}

    # ------------------------------------------------------------------
    def compute_indicators(
        self,
        df_5m: pd.DataFrame,
        df_1h: pd.DataFrame | None = None,
    ) -> pd.DataFrame:
        p   = self.params
        out = df_5m.copy()

        # ── 5m EMAs ──────────────────────────────────────────────────
        out["ema20"] = _ema(out["close"], p["ema_fast"])
        out["ema50"] = _ema(out["close"], p["ema_slow"])

        # ── RSI ───────────────────────────────────────────────────────
        out["rsi"] = _rsi(out["close"], p["rsi_period"])

        # ── ATR ───────────────────────────────────────────────────────
        out["atr"] = ind.atr(out["high"], out["low"], out["close"], p["atr_period"])
        out["atr_pct"] = out["atr"] / out["close"] * 100.0

        # ── Supertrend ────────────────────────────────────────────────
        st_line, st_dir = ind.supertrend(
            out["high"], out["low"], out["close"],
            period=p["st_period"], multiplier=p["st_mult"],
        )
        out["st_line"] = st_line
        out["st_dir"]  = st_dir

        # ── Break-of-Structure LOW (lowest prev N bars, shifted 1) ───
        lookback = int(p["bos_lookback"])
        out["bos_low"] = out["low"].shift(1).rolling(lookback, min_periods=lookback).min()

        # ── Volume ratio ─────────────────────────────────────────────
        avg_vol = out["volume"].rolling(20, min_periods=1).mean()
        out["vol_ratio"] = out["volume"] / avg_vol.replace(0, np.nan)

        # ── HTF bias (1H) — bearish = EMA20 < EMA50 ──────────────────
        if df_1h is not None and not df_1h.empty:
            h1 = df_1h.copy()
            h1["ema20_1h"] = _ema(h1["close"], p["htf_ema_fast"])
            h1["ema50_1h"] = _ema(h1["close"], p["htf_ema_slow"])
            h1["htf_bear"] = (h1["ema20_1h"] < h1["ema50_1h"]).astype(int)

            htf_series = h1["htf_bear"].reindex(out.index, method="ffill")
            out["htf_bear"] = htf_series.fillna(0).astype(int)
        else:
            out["htf_bear"] = 1   # bias disabled → always allowed

        return out

    # ------------------------------------------------------------------
    def generate_signals(self, df_ind: pd.DataFrame) -> pd.Series:
        """Return pd.Series of entry signals (1 = short entry, 0 = flat)."""
        p = self.params
        d = df_ind

        # 1. HTF Bear bias
        htf_ok = d["htf_bear"] == 1

        # 2. Price below EMA50
        below_ema = d["close"] < d["ema50"]

        # 3. Break of Structure DOWN — close below rolling N-bar low
        bos_down = d["close"] < d["bos_low"]

        # 4. Supertrend bearish
        st_bear = d["st_dir"] == -1

        # 5. ATR filter (avoid flat market)
        not_flat = d["atr_pct"] > p["atr_min_pct"]

        # 6. Session filter
        active_hours: set[int] = set(p.get("active_hours", set()))
        if active_hours:
            try:
                hours = pd.DatetimeIndex(d.index).tz_convert("UTC").hour
            except TypeError:
                hours = pd.DatetimeIndex(d.index).hour
            session_ok = pd.Series(
                [h in active_hours for h in hours], index=d.index
            )
        else:
            session_ok = pd.Series(True, index=d.index)

        # 7. RSI confirmation (optional)
        rsi_ok = d["rsi"] < p["rsi_max"] if p["rsi_max"] > 0 else pd.Series(True, index=d.index)

        raw = (htf_ok & below_ema & bos_down & st_bear & not_flat & session_ok & rsi_ok).astype(int)

        # Cooldown — suppress entries within cooldown_bars of last accepted entry
        cooldown = int(p.get("cooldown_bars", 2))
        arr = raw.to_numpy(dtype=np.int8).copy()
        last_entry = -(cooldown + 1)
        for i in range(len(arr)):
            if arr[i] == 1:
                if (i - last_entry) <= cooldown:
                    arr[i] = 0
                else:
                    last_entry = i

        return pd.Series(arr, index=raw.index, name="signal")

    # ------------------------------------------------------------------
    def get_sl_tp(self, entry: float, atr_val: float) -> tuple[float, float]:
        """For SHORT: SL is above entry, TP is below entry."""
        p  = self.params
        sl = entry + p["sl_atr_mult"] * atr_val
        tp = entry - p["tp_atr_mult"] * atr_val
        return sl, tp

    # ------------------------------------------------------------------
    def describe(self) -> str:
        p = self.params
        return (
            f"LockedShort5Min · BoS<{p['bos_lookback']}bars · "
            f"EMA{p['ema_fast']}/{p['ema_slow']} · "
            f"ST({p['st_period']},{p['st_mult']}) · "
            f"SL{p['sl_atr_mult']}×ATR TP{p['tp_atr_mult']}×ATR"
        )
