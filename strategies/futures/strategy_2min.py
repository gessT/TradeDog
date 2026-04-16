"""
GMC 2-Minute Pullback Strategy
================================
Rule-based, LONG-only scalping strategy for Micro Gold Futures (MGC/GMC).

Entry Rules (ALL required):
  1. Trend  — EMA20 > EMA50 (price in uptrend)
  2. Pullback — close within pullback_atr_mult × ATR of EMA20
              AND close >= EMA20 (price above / at EMA20, not below)
  3. Momentum — RSI > rsi_min (default 50)
  4. Confirmation — Volume spike (vol > vol_mult × avg) OR MACD histogram > 0
  5. Volatility filter — ATR > atr_min_pct × close (skip flat / sideways bars)

Exit Rules:
  - Take Profit : entry + tp_mult × ATR
  - Stop Loss   : entry − sl_mult × ATR

Default optimised parameters target > 70% win rate, > 10% ROI on 2m MGC.
"""
from __future__ import annotations

import numpy as np
import pandas as pd


# ═══════════════════════════════════════════════════════════════════════
# Default Parameters
# ═══════════════════════════════════════════════════════════════════════

DEFAULT_PARAMS: dict = {
    # Trade direction: "LONG" (buy pullback) or "SHORT" (sell rally)
    "direction": "SHORT",
    # Trend
    "ema_fast": 20,
    "ema_slow": 50,
    # Pullback tolerance — price within N × ATR of EMA20
    "pullback_atr_mult": 1.0,
    # Volume confirmation
    "vol_period": 20,
    "vol_mult": 1.5,
    # RSI
    "rsi_period": 14,
    "rsi_min": 50,
    # MACD (alternative confirmation when volume is low)
    "macd_fast": 12,
    "macd_slow": 26,
    "macd_signal": 9,
    # ATR
    "atr_period": 14,
    "sl_mult": 1.0,
    "tp_mult": 1.5,
    # Flat-market filter — skip entries when ATR < atr_min_pct% of close
    "atr_min_pct": 0.05,   # 0.05% of price
    # Session filter — only trade during active hours (UTC)
    # Set to empty set to disable
    "active_hours": {13, 14, 15, 16, 17, 18, 19, 20},   # ~09:00-16:00 NY
    # Cooldown — bars between consecutive entries
    "cooldown_bars": 3,
}


# ═══════════════════════════════════════════════════════════════════════
# Indicator Calculations  (pure pandas, no TA-Lib)
# ═══════════════════════════════════════════════════════════════════════

def calc_ema(series: pd.Series, period: int) -> pd.Series:
    """Exponential Moving Average."""
    return series.ewm(span=period, adjust=False).mean()


def calc_rsi(close: pd.Series, period: int = 14) -> pd.Series:
    """RSI using Wilder smoothing (matches TradingView default)."""
    delta = close.diff()
    gain = delta.clip(lower=0)
    loss = (-delta).clip(lower=0)
    avg_gain = gain.ewm(alpha=1.0 / period, min_periods=period, adjust=False).mean()
    avg_loss = loss.ewm(alpha=1.0 / period, min_periods=period, adjust=False).mean()
    rs = avg_gain / avg_loss.replace(0, np.nan)
    return (100.0 - 100.0 / (1.0 + rs)).fillna(50.0)


def calc_atr(high: pd.Series, low: pd.Series, close: pd.Series, period: int = 14) -> pd.Series:
    """Average True Range (EMA smoothing)."""
    prev_close = close.shift(1)
    tr = pd.concat(
        [high - low, (high - prev_close).abs(), (low - prev_close).abs()],
        axis=1,
    ).max(axis=1)
    return tr.ewm(span=period, adjust=False).mean()


def calc_macd(
    close: pd.Series,
    fast: int = 12,
    slow: int = 26,
    signal: int = 9,
) -> tuple[pd.Series, pd.Series, pd.Series]:
    """MACD line, signal line, histogram."""
    ema_f = close.ewm(span=fast, adjust=False).mean()
    ema_s = close.ewm(span=slow, adjust=False).mean()
    macd_line = ema_f - ema_s
    signal_line = macd_line.ewm(span=signal, adjust=False).mean()
    histogram = macd_line - signal_line
    return macd_line, signal_line, histogram


def calc_volume_spike(volume: pd.Series, period: int = 20, mult: float = 1.5) -> pd.Series:
    """True when volume exceeds mult × rolling average."""
    avg_vol = volume.rolling(window=period, min_periods=1).mean()
    return (volume > mult * avg_vol).astype(int)


# ═══════════════════════════════════════════════════════════════════════
# Core Strategy Class
# ═══════════════════════════════════════════════════════════════════════

class GMCPullbackStrategy:
    """
    2-minute GMC pullback-to-EMA20 strategy.
    Call ``compute_indicators`` then ``generate_signals``.
    """

    def __init__(self, params: dict | None = None) -> None:
        self.params = {**DEFAULT_PARAMS, **(params or {})}

    # -----------------------------------------------------------------
    def compute_indicators(self, df: pd.DataFrame) -> pd.DataFrame:
        """
        Add all indicator columns to a copy of *df*.

        Expects columns: open, high, low, close, volume
        Returns df with extra columns:
          ema20, ema50, rsi, atr,
          macd_line, macd_signal, macd_hist,
          vol_spike, atr_pct
        """
        p = self.params
        out = df.copy()

        out["ema20"] = calc_ema(out["close"], p["ema_fast"])
        out["ema50"] = calc_ema(out["close"], p["ema_slow"])
        out["rsi"]   = calc_rsi(out["close"], p["rsi_period"])
        out["atr"]   = calc_atr(out["high"], out["low"], out["close"], p["atr_period"])

        ml, sl, hist = calc_macd(
            out["close"], p["macd_fast"], p["macd_slow"], p["macd_signal"]
        )
        out["macd_line"]   = ml
        out["macd_signal"] = sl
        out["macd_hist"]   = hist

        out["vol_spike"] = calc_volume_spike(
            out["volume"], p["vol_period"], p["vol_mult"]
        )

        # ATR as % of close — used for flat-market filter
        out["atr_pct"] = out["atr"] / out["close"] * 100.0

        return out

    # -----------------------------------------------------------------
    def generate_signals(self, df_ind: pd.DataFrame) -> pd.Series:
        """
        Return a pd.Series of entry signals (1 = entry, 0 = no signal).

        Entry conditions are always LONG-based (EMA20>EMA50 pullback).
        When direction="SHORT", the SAME entry bars are used but the trade
        is entered SHORT — TP sits where LONG SL was (price going down),
        giving ~inverse win rate.
        """
        p = self.params
        d = df_ind

        # 1. Uptrend
        trend_ok = d["ema20"] > d["ema50"]

        # 2. Pullback zone
        pullback_upper = d["ema20"] + p["pullback_atr_mult"] * d["atr"]
        at_ema = (d["close"] >= d["ema20"]) & (d["close"] <= pullback_upper)

        # 3. RSI momentum
        rsi_ok = d["rsi"] > p["rsi_min"]

        # 4. Volume spike OR positive MACD histogram
        confirmation = (d["vol_spike"] == 1) | (d["macd_hist"] > 0)

        # 5. Volatility filter (same for both directions)
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

        raw = (
            trend_ok & at_ema & rsi_ok & confirmation & not_flat & session_ok
        ).astype(int)

        # Apply cooldown — suppress signals within cooldown_bars of last entry
        # Vectorised: mark each signal bar, then zero out any that are within
        # cooldown distance of a prior accepted signal.
        cooldown = int(p.get("cooldown_bars", 3))
        arr = raw.to_numpy(dtype=np.int8).copy()
        last_entry = -(cooldown + 1)
        for i in range(len(arr)):
            if arr[i] == 1:
                if (i - last_entry) <= cooldown:
                    arr[i] = 0
                else:
                    last_entry = i

        return pd.Series(arr, index=raw.index, name="signal")

    # -----------------------------------------------------------------
    def get_sl_tp(self, entry_price: float, atr_val: float) -> tuple[float, float]:
        """Return (stop_loss_price, take_profit_price) for a given entry.

        SHORT direction swaps the multipliers so the TP coincides with where
        the LONG SL would have been — achieving the mathematical inverse WR.
          LONG : SL = entry - sl_mult×ATR,  TP = entry + tp_mult×ATR
          SHORT: SL = entry + tp_mult×ATR,  TP = entry - sl_mult×ATR
        """
        p = self.params
        direction = str(p.get("direction", "LONG")).upper()
        if direction == "SHORT":
            sl = entry_price + p["tp_mult"] * atr_val   # above entry
            tp = entry_price - p["sl_mult"] * atr_val   # below entry (was LONG SL)
        else:
            sl = entry_price - p["sl_mult"] * atr_val
            tp = entry_price + p["tp_mult"] * atr_val
        return sl, tp

    # -----------------------------------------------------------------
    def describe(self) -> str:
        p = self.params
        lines = [
            "GMC 2-Min Pullback Strategy",
            f"  Trend   : EMA{p['ema_fast']} > EMA{p['ema_slow']}",
            f"  Pullback: close within {p['pullback_atr_mult']}×ATR of EMA{p['ema_fast']}",
            f"  RSI     : > {p['rsi_min']} (period {p['rsi_period']})",
            f"  Volume  : > {p['vol_mult']}× {p['vol_period']}-bar avg  OR  MACD hist > 0",
            f"  SL/TP   : {p['sl_mult']}×ATR / {p['tp_mult']}×ATR",
            f"  ATR min : {p['atr_min_pct']}% of close (flat filter)",
        ]
        return "\n".join(lines)
