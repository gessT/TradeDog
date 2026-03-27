"""
MGC Strategy — Trend + Pullback + Momentum Confirmation
========================================================
Long-only strategy for Micro Gold Futures on 5m / 15m bars.

Entry (ALL must be true):
  1. Up-trend: EMA_fast > EMA_slow  (or Supertrend bullish)
  2. Pullback: price within pullback_atr_mult × ATR of EMA_fast
  3. RSI recovery: RSI crosses above rsi_low  OR  RSI > rsi_high
  4. Bullish candle confirmation (green candle or bullish engulfing)
  5. Volume above vol_mult × MA(vol_period)

Exit:
  Stop-loss  = entry − atr_sl_mult × ATR
  Take-profit = entry + atr_tp_mult × ATR
  Optional trailing stop at trailing_atr_mult × ATR below highest close
"""
from __future__ import annotations

import pandas as pd

from . import indicators as ind
from .config import DEFAULT_PARAMS


class MGCStrategy:
    """Generates long-only entry signals on a prepared OHLCV DataFrame."""

    def __init__(self, params: dict | None = None) -> None:
        self.p: dict = {**DEFAULT_PARAMS, **(params or {})}

    # ── Compute all indicators ──────────────────────────────────────
    def compute_indicators(self, df: pd.DataFrame) -> pd.DataFrame:
        """Add indicator columns in-place and return the same DataFrame."""
        p = self.p
        df = df.copy()

        df["ema_fast"] = ind.ema(df["close"], p["ema_fast"])
        df["ema_slow"] = ind.ema(df["close"], p["ema_slow"])
        df["rsi"] = ind.rsi(df["close"], p["rsi_period"])
        df["atr"] = ind.atr(df["high"], df["low"], df["close"], p["atr_period"])
        df["vol_above"] = ind.volume_above_ma(df["volume"], p["vol_period"], p["vol_mult"])
        df["bullish_candle"] = ind.is_bullish_candle(df["open"], df["close"])
        df["bullish_engulfing"] = ind.is_bullish_engulfing(
            df["open"], df["high"], df["low"], df["close"],
        )

        if p.get("use_supertrend"):
            st_line, st_dir = ind.supertrend(
                df["high"], df["low"], df["close"], p["st_period"], p["st_mult"],
            )
            df["st_line"] = st_line
            df["st_dir"] = st_dir

        return df

    # ── Generate entry signals ──────────────────────────────────────
    def generate_signals(self, df: pd.DataFrame) -> pd.Series:
        """Return a Series of 1 (long entry) / 0 (no signal).

        IMPORTANT: signal on bar i means "enter at open of bar i+1".
        """
        p = self.p

        # 1. Trend filter
        if p.get("use_supertrend") and "st_dir" in df.columns:
            uptrend = df["st_dir"] == 1
        else:
            uptrend = df["ema_fast"] > df["ema_slow"]

        # 2. Pullback to EMA zone
        pullback = (df["close"] - df["ema_fast"]).abs() <= p["pullback_atr_mult"] * df["atr"]

        # 3. RSI condition: recovering from oversold OR momentum above threshold
        rsi_prev = df["rsi"].shift(1)
        rsi_recovery = (rsi_prev <= p["rsi_low"]) & (df["rsi"] > p["rsi_low"])
        rsi_strong = df["rsi"] > p["rsi_high"]
        rsi_ok = rsi_recovery | rsi_strong

        # 4. Bullish candle confirmation
        candle_ok = df["bullish_candle"] | df["bullish_engulfing"]

        # 5. Volume filter
        vol_ok = df["vol_above"]

        signal = (uptrend & pullback & rsi_ok & candle_ok & vol_ok).astype(int)
        signal.name = "signal"
        return signal
