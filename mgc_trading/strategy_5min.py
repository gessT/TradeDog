"""
5-Minute Strategy — Multi-condition entry for MGC scalping
===========================================================
Entry conditions (ALL must be met):
  1. EMA20 > EMA50  (trend alignment)
  2. Price pullback to EMA20 OR breakout above 20-bar high
  3. RSI rising from <40 → >50, or in 40-60 zone
  4. Supertrend = bullish
  5. Volume > 1.5× average (volume spike)
  + MACD histogram > 0 (momentum confirmation)
  + Session time filter (NY / London hours)
  + ATR range filter (skip flat markets)

Exit:
  - Stop Loss:   1 × ATR below entry
  - Take Profit: 2 × ATR above entry
  - Trailing Stop (optional): 1 × ATR
"""
from __future__ import annotations

import pandas as pd

from mgc_trading import indicators as ind
from mgc_trading import indicators_5min as ind5


# ═══════════════════════════════════════════════════════════════════════
# Default 5-Minute Parameters
# ═══════════════════════════════════════════════════════════════════════

DEFAULT_5MIN_PARAMS: dict = {
    # Trend — EMA7 reacts fastest on 5min, EMA21 anchor
    "ema_fast": 7,
    "ema_slow": 21,
    # RSI
    "rsi_period": 14,
    "rsi_low": 35,
    "rsi_high": 45,
    # MACD
    "macd_fast": 8,
    "macd_slow": 17,
    "macd_signal": 9,
    # ATR — symmetric R:R = 1:1
    "atr_period": 14,
    "atr_sl_mult": 2.5,        # SL = 2.5× ATR
    "atr_tp_mult": 2.5,        # TP = 2.5× ATR
    # Breakeven stop — OFF (causes trade churn at 5min scale)
    "use_breakeven": False,
    "be_atr_mult": 1.5,
    "be_offset_atr": 0.3,
    # Supertrend — slower, more stable filter to avoid whipsaws
    "st_period": 10,
    "st_mult": 2.0,
    # Pullback / Breakout
    "pullback_atr_mult": 2.0,
    "breakout_lookback": 20,
    # Volume
    "vol_period": 20,
    "vol_spike_mult": 0.8,     # loose — just filter dead bars
    # Session filter OFF by default
    "use_session_filter": False,
    # ATR range filter
    "min_atr_pct": 0.03,
    # Trailing stop OFF
    "trailing_atr_mult": 1.5,
    "use_trailing": False,
    # ADX OFF (over-restrictive, reduces signal count too much)
    "adx_period": 14,
    "adx_min": 0,
    # Higher TF OFF (999 disables)
    "htf_ema_period": 999,
    # Cooldown OFF
    "cooldown_bars": 0,
}


class MGCStrategy5Min:
    """5-minute scalping strategy with multi-indicator confirmation."""

    def __init__(self, params: dict | None = None):
        self.p = {**DEFAULT_5MIN_PARAMS, **(params or {})}

    def compute_indicators(self, df: pd.DataFrame) -> pd.DataFrame:
        """Add all indicator columns to the DataFrame."""
        p = self.p
        c = df["close"]

        # EMAs
        df["ema_fast"] = ind.ema(c, p["ema_fast"])
        df["ema_slow"] = ind.ema(c, p["ema_slow"])

        # EMA slope (confirms genuine trend, not whipsaw)
        df["ema_slope"] = ind5.ema_slope(df["ema_fast"], lookback=3)

        # RSI
        df["rsi"] = ind.rsi(c, p["rsi_period"])

        # ATR
        df["atr"] = ind.atr(df["high"], df["low"], c, p["atr_period"])

        # Supertrend
        st_line, st_dir = ind.supertrend(
            df["high"], df["low"], c, p["st_period"], p["st_mult"]
        )
        df["st_line"] = st_line
        df["st_dir"] = st_dir  # 1 = bullish, -1 = bearish

        # MACD
        macd_line, macd_sig, macd_hist = ind5.macd(
            c, p["macd_fast"], p["macd_slow"], p["macd_signal"]
        )
        df["macd_line"] = macd_line
        df["macd_signal"] = macd_sig
        df["macd_hist"] = macd_hist

        # MACD momentum (positive or fresh cross)
        df["macd_mom"] = ind5.macd_momentum(macd_hist)

        # Breakout
        df["breakout"] = ind5.breakout_high(c, df["high"], p["breakout_lookback"])

        # Pullback (both sides of EMA)
        df["pullback"] = ind5.pullback_to_ema(
            c, df["ema_fast"], df["atr"], p["pullback_atr_mult"]
        )

        # Volume filter
        df["vol_spike"] = ind5.volume_spike(
            df["volume"], p["vol_period"], p["vol_spike_mult"]
        )

        # RSI momentum
        df["rsi_rising"] = ind5.rsi_rising(df["rsi"], p["rsi_low"], p["rsi_high"])

        # ADX — trend strength filter (avoids choppy markets)
        df["adx"] = ind5.adx(df["high"], df["low"], c, p.get("adx_period", 14))

        # Higher TF trend filter (EMA50 as regime gate)
        df["htf_trend"] = ind5.higher_tf_trend(c, p.get("htf_ema_period", 50))

        # Session filter
        if p.get("use_session_filter") and hasattr(df.index, "hour"):
            df["in_session"] = ind5.in_session(df.index)
        else:
            df["in_session"] = 1

        # ATR range filter
        df["atr_ok"] = ind5.atr_range_ok(df["atr"], p["min_atr_pct"], c)

        return df

    def generate_signals(self, df: pd.DataFrame) -> pd.Series:
        """Generate entry signals — 1 = long entry, 0 = no signal.

        Core conditions (ALL must be True):
          1. EMA fast > EMA slow AND EMA fast is rising (trend + slope)
          2. Pullback to EMA OR Breakout above recent high
          3. Supertrend bullish
          4. ADX >= threshold (trending, not choppy)
          5. Price above EMA50 (higher-TF bullish bias)
        Confirmation (at least momentum from MACD or RSI):
          6. MACD momentum positive (or fresh cross)
          7. RSI in healthy zone / rising
        Filters:
          8. Volume above average
          9. Within session hours (if enabled)
          10. ATR sufficient
        """
        p = self.p
        # Core trend: EMA cross + rising slope
        cond_trend = (df["ema_fast"] > df["ema_slow"]) & (df["ema_slope"] == 1)
        # Entry trigger: pullback or breakout
        cond_entry = (df["pullback"] == 1) | (df["breakout"] == 1)
        # Supertrend confirmation
        cond_st = df["st_dir"] == 1
        # ADX trend strength (default >= 20)
        cond_adx = df["adx"] >= p.get("adx_min", 20)
        # Higher TF trend (price above EMA50)
        cond_htf = df["htf_trend"] == 1
        # Momentum: MACD or RSI (at least one)
        cond_momentum = (df["macd_mom"] == 1) | (df["rsi_rising"] == 1)
        # Filters
        cond_vol = df["vol_spike"] == 1
        cond_session = df["in_session"] == 1
        cond_atr = df["atr_ok"] == 1

        signal = (
            cond_trend
            & cond_entry
            & cond_st
            & cond_adx
            & cond_htf
            & cond_momentum
            & cond_vol
            & cond_session
            & cond_atr
        ).astype(int)

        # Cooldown: suppress signals within N bars of a previous signal
        cooldown = p.get("cooldown_bars", 0)
        if cooldown > 0:
            last_signal_idx = -cooldown - 1
            for i in range(len(signal)):
                if signal.iloc[i] == 1:
                    if i - last_signal_idx <= cooldown:
                        signal.iloc[i] = 0
                    else:
                        last_signal_idx = i

        return signal
