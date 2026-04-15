"""
GMC 5-Minute Locked Strategy
==============================
LONG-only, rule-based structure breakout strategy for Micro Gold Futures.

Entry Rules (ALL required):
  1. HTF Bias    — 1H EMA20 > 1H EMA50  (higher-timeframe uptrend)
  2. EMA Filter  — 5m close > EMA50  (price above medium-term anchor)
  3. Breakout    — 5m close > highest high of last N bars  (BoS: Break of Structure)
  4. Supertrend  — Supertrend direction = +1  (bullish regime)
  5. ATR Filter  — ATR > atr_min_pct × close  (skip flat/choppy market)
  6. Session     — Bar UTC hour in active session  (high-volume hours only)

Exit Rules:
  - Take Profit : entry + tp_atr_mult × ATR  (default 2×)
  - Stop Loss   : entry − sl_atr_mult × ATR  (default 1×)
  - Trailing    : (optional) trail at trail_atr_mult × ATR from peak

Optimizer targets:
  - Win rate ≥ 70%
  - ROI ≥ 10%
  - Stable equity curve (maxDD < 15%)
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from . import indicators as ind


# ═══════════════════════════════════════════════════════════════════════
# Default Parameters
# ═══════════════════════════════════════════════════════════════════════

DEFAULT_LOCKED_PARAMS: dict = {
    # HTF bias — 1H EMA pair
    "htf_ema_fast": 20,
    "htf_ema_slow": 50,
    # 5m EMA anchor
    "ema_fast": 20,
    "ema_slow": 50,
    # Breakout lookback (bars)
    "bos_lookback": 5,
    # Supertrend
    "st_period": 14,
    "st_mult": 1.5,
    # ATR
    "atr_period": 14,
    "sl_atr_mult": 1.2,
    "tp_atr_mult": 1.5,
    # Trailing stop
    "use_trailing": False,
    "trail_atr_mult": 1.0,
    # Flat-market filter
    "atr_min_pct": 0.02,   # ATR must be > 0.02% of close
    # Session filter — UTC hours (NY+London overlap: 13-20 UTC)
    "active_hours": {13, 14, 15, 16, 17, 18, 19, 20},
    # Cooldown: minimum bars between entries
    "cooldown_bars": 2,
    # RSI confirmation (optional, set rsi_min=0 to disable)
    "rsi_period": 14,
    "rsi_min": 50,
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

class LockedStrategy5Min:
    """
    5-minute GMC bullish structure breakout strategy.

    Workflow::

        strat = LockedStrategy5Min(params)
        df_5m_ind = strat.compute_indicators(df_5m, df_1h)
        signals   = strat.generate_signals(df_5m_ind)
    """

    def __init__(self, params: dict | None = None) -> None:
        self.params = {**DEFAULT_LOCKED_PARAMS, **(params or {})}

    # ------------------------------------------------------------------
    def compute_indicators(
        self,
        df_5m: pd.DataFrame,
        df_1h: pd.DataFrame | None = None,
    ) -> pd.DataFrame:
        """
        Compute all indicators on the 5m frame.
        If df_1h is None, the HTF bias column will be NaN (= bias disabled).

        Returns copy of df_5m with extra columns:
          ema20, ema50, rsi, atr, st_dir, st_line,
          bos_high (rolling high of last N bars),
          htf_bull (1 if 1H EMA20>EMA50, else 0),
          atr_pct, vol_ratio
        """
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

        # ── Break-of-Structure high (highest prev N bars, shifted 1) ──
        lookback = int(p["bos_lookback"])
        out["bos_high"] = out["high"].shift(1).rolling(lookback, min_periods=lookback).max()

        # ── Volume ratio ─────────────────────────────────────────────
        avg_vol = out["volume"].rolling(20, min_periods=1).mean()
        out["vol_ratio"] = out["volume"] / avg_vol.replace(0, np.nan)

        # ── HTF bias (1H) ─────────────────────────────────────────────
        if df_1h is not None and not df_1h.empty:
            h1 = df_1h.copy()
            h1["ema20_1h"] = _ema(h1["close"], p["htf_ema_fast"])
            h1["ema50_1h"] = _ema(h1["close"], p["htf_ema_slow"])
            h1["htf_bull"] = (h1["ema20_1h"] > h1["ema50_1h"]).astype(int)

            # Forward-fill 1H signal onto 5m index
            htf_series = h1["htf_bull"].reindex(
                out.index, method="ffill"
            )
            out["htf_bull"] = htf_series.fillna(0).astype(int)
        else:
            out["htf_bull"] = 1   # bias disabled → always allowed

        return out

    # ------------------------------------------------------------------
    def generate_signals(self, df_ind: pd.DataFrame) -> pd.Series:
        """
        Return pd.Series of entry signals (1 = long entry, 0 = flat).

        All 6 rules must be True simultaneously.
        """
        p = self.params
        d = df_ind

        # 1. HTF Bull bias
        htf_ok = d["htf_bull"] == 1

        # 2. Price above EMA50
        above_ema = d["close"] > d["ema50"]

        # 3. Break of Structure — close above rolling N-bar high
        bos = d["close"] > d["bos_high"]

        # 4. Supertrend bullish
        st_bull = d["st_dir"] == 1

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
        rsi_ok = d["rsi"] > p["rsi_min"] if p["rsi_min"] > 0 else pd.Series(True, index=d.index)

        raw = (htf_ok & above_ema & bos & st_bull & not_flat & session_ok & rsi_ok).astype(int)

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
        p  = self.params
        sl = entry - p["sl_atr_mult"] * atr_val
        tp = entry + p["tp_atr_mult"] * atr_val
        return sl, tp

    # ------------------------------------------------------------------
    def describe(self) -> str:
        p = self.params
        return (
            f"Locked5Min · BoS>{p['bos_lookback']}bars · "
            f"EMA{p['ema_fast']}/{p['ema_slow']} · "
            f"ST({p['st_period']},{p['st_mult']}) · "
            f"SL{p['sl_atr_mult']}×ATR TP{p['tp_atr_mult']}×ATR"
        )
