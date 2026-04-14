"""
VPR Strategy — Signal Generation
===================================
LONG only.  Three-layer confirmation:
  1. VWAP bias     — price > session VWAP
  2. Volume Profile — price >= POC  or  price near HVN
  3. RSI momentum  — RSI in [45,65] and rising
"""
from __future__ import annotations

import pandas as pd

from .config import DEFAULT_VPR_PARAMS
from .indicators import rsi, atr, session_vwap, volume_profile_levels


class VPRStrategy:
    """Volume-Profile + VWAP + RSI  (long-only)."""

    def __init__(self, params: dict | None = None):
        self.p = {**DEFAULT_VPR_PARAMS, **(params or {})}

    def compute_indicators(self, df: pd.DataFrame) -> pd.DataFrame:
        """Add all indicator columns. Non-repainting."""
        p = self.p
        c = df["close"]

        # RSI
        df["rsi"] = rsi(c, p["rsi_period"])
        df["rsi_prev"] = df["rsi"].shift(1)

        # ATR
        df["atr"] = atr(df["high"], df["low"], c, p["atr_period"])

        # Session VWAP
        df["vwap"] = session_vwap(df)

        # Volume Profile — POC + HVN
        poc_series, hvn_list = volume_profile_levels(
            df,
            lookback=p["vp_lookback"],
            bin_count=p["vp_bin_count"],
            hvn_percentile=p["vp_hvn_percentile"],
        )
        df["poc"] = poc_series
        # Store HVN list as object column (list of floats per bar)
        df["_hvn_prices"] = pd.Series(hvn_list, index=df.index, dtype=object)

        # Session hour (for filtering)
        if hasattr(df.index, "hour"):
            df["_hour"] = df.index.hour
        else:
            df["_hour"] = 0

        return df

    def generate_signals(self, df: pd.DataFrame, disabled: set[str] | None = None) -> pd.Series:
        """Generate entry signals: +1 = LONG, 0 = no signal.

        Uses PREVIOUS bar's indicator values to avoid repainting.
        Conditions can be disabled: vwap_bias, vol_profile, rsi_momentum, bullish_candle, session
        """
        p = self.p
        off = disabled or set()
        n = len(df)
        signal = pd.Series(0, index=df.index, dtype=int)

        for i in range(1, n):
            prev = df.iloc[i - 1]

            # ── Session filter ──
            if "session" not in off:
                hour = int(prev.get("_hour", 0))
                if hour < 13 or hour >= 20:
                    continue

            # ── 1. VWAP bias: close > VWAP ──
            prev_close = float(prev["close"])
            if "vwap_bias" not in off:
                prev_vwap = float(prev["vwap"])
                if pd.isna(prev_vwap) or prev_close <= prev_vwap:
                    continue

            # ── 2. Volume Profile structure ──
            if "vol_profile" not in off:
                prev_poc = float(prev["poc"])
                prev_atr = float(prev["atr"])
                if pd.isna(prev_poc) or pd.isna(prev_atr) or prev_atr <= 0:
                    continue

                tolerance = p["vp_touch_tolerance_atr"] * prev_atr
                above_poc = prev_close >= prev_poc
                hvn_prices = prev.get("_hvn_prices", [])
                if not isinstance(hvn_prices, list):
                    hvn_prices = []
                near_hvn = any(abs(prev_close - h) <= tolerance for h in hvn_prices)

                if not above_poc and not near_hvn:
                    continue

            # ── 3. RSI momentum ──
            if "rsi_momentum" not in off:
                prev_rsi = float(prev["rsi"])
                prev_rsi_prev = float(prev["rsi_prev"])
                if pd.isna(prev_rsi) or pd.isna(prev_rsi_prev):
                    continue

                rsi_in_zone = p["rsi_low"] <= prev_rsi <= p["rsi_high"]
                rsi_rising = prev_rsi > prev_rsi_prev

                if not rsi_in_zone or not rsi_rising:
                    continue

            # ── 4. Bullish candle confirmation ──
            if "bullish_candle" not in off:
                if prev["close"] <= prev["open"]:
                    continue

            signal.iloc[i] = 1

        return signal
