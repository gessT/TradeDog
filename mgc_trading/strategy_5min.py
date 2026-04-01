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
    # Trend — EMA7 fast, EMA30 anchor (wider gap = better PUT detection)
    "ema_fast": 7,
    "ema_slow": 30,
    # RSI
    "rsi_period": 14,
    "rsi_low": 35,
    "rsi_high": 45,
    # MACD
    "macd_fast": 8,
    "macd_slow": 17,
    "macd_signal": 9,
    # ATR — asymmetric: wider SL for noise, tighter TP for quicker wins
    "atr_period": 14,
    "atr_sl_mult": 3.0,        # SL = 3.0× ATR
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
        df["ema_slope_falling"] = ind5.ema_slope_falling(df["ema_fast"], lookback=3)

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

        # MACD bearish momentum
        df["macd_mom_bear"] = ind5.macd_momentum_bear(macd_hist)

        # Breakout (long)
        df["breakout"] = ind5.breakout_high(c, df["high"], p["breakout_lookback"])

        # Breakout (short)
        df["breakout_low"] = ind5.breakout_low(c, df["low"], p["breakout_lookback"])

        # Pullback (both sides of EMA)
        df["pullback"] = ind5.pullback_to_ema(
            c, df["ema_fast"], df["atr"], p["pullback_atr_mult"]
        )

        # Volume filter
        df["vol_spike"] = ind5.volume_spike(
            df["volume"], p["vol_period"], p["vol_spike_mult"]
        )

        # RSI momentum (bullish)
        df["rsi_rising"] = ind5.rsi_rising(df["rsi"], p["rsi_low"], p["rsi_high"])

        # RSI momentum (bearish)
        df["rsi_falling"] = ind5.rsi_falling(df["rsi"])

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

        # Market structure — HH/HL vs LH/LL over last 100 bars
        df["mkt_structure"] = ind5.market_structure(
            df["high"], df["low"], c, lookback=100, swing_order=5,
        )

        return df

    def generate_signals(self, df: pd.DataFrame, disabled: set[str] | None = None) -> pd.Series:
        """Generate entry signals: +1 = CALL (long), -1 = PUT (short), 0 = no signal.

        *disabled* is an optional set of condition keys to skip (treat as always True).
        Valid keys: ema_trend, ema_slope, pullback, breakout, supertrend,
                    macd_momentum, rsi_momentum, volume_spike, atr_range,
                    session_ok, adx_ok.

        CALL conditions (ALL must be True):
          1. EMA fast > EMA slow AND EMA fast rising
          2. Pullback to EMA OR Breakout above recent high
          3. Supertrend bullish
          4. MACD or RSI bullish momentum
        PUT conditions (ALL must be True — mirror of CALL):
          1. EMA fast < EMA slow AND EMA fast falling
          2. Pullback to EMA OR Breakout below recent low
          3. Supertrend bearish
          4. MACD or RSI bearish momentum
        Common filters:
          - Volume above average
          - Session hours (if enabled)
          - ATR sufficient
          - ADX / HTF (if enabled)
        """
        p = self.p
        off = disabled or set()
        _true = pd.Series(True, index=df.index)

        def _or_group(parts: list) -> pd.Series:
            """OR only enabled conditions; if all disabled → always True."""
            if not parts:
                return _true
            result = parts[0]
            for p2 in parts[1:]:
                result = result | p2
            return result

        # ── Common filters ──────────────────────────────────────
        cond_vol = _true if "volume_spike" in off else (df["vol_spike"] == 1)
        cond_session = _true if "session_ok" in off else (df["in_session"] == 1)
        cond_atr = _true if "atr_range" in off else (df["atr_ok"] == 1)
        cond_adx = _true if "adx_ok" in off else (df["adx"] >= p.get("adx_min", 0))

        filters = cond_vol & cond_session & cond_atr & cond_adx

        # ── CALL (long) ────────────────────────────────────────
        call_trend = _true if "ema_trend" in off else (df["ema_fast"] > df["ema_slow"])
        call_slope = _true if "ema_slope" in off else (df["ema_slope"] == 1)
        # Entry group: only require enabled entry conditions
        call_entry_parts: list = []
        if "pullback" not in off:
            call_entry_parts.append(df["pullback"] == 1)
        if "breakout" not in off:
            call_entry_parts.append(df["breakout"] == 1)
        call_entry = _or_group(call_entry_parts)
        call_st = _true if "supertrend" in off else (df["st_dir"] == 1)
        # Momentum group: only require enabled momentum conditions
        call_mom_parts: list = []
        if "macd_momentum" not in off:
            call_mom_parts.append(df["macd_mom"] == 1)
        if "rsi_momentum" not in off:
            call_mom_parts.append(df["rsi_rising"] == 1)
        call_mom = _or_group(call_mom_parts)
        htf_ema_period = p.get("htf_ema_period", 999)
        call_htf = df["htf_trend"] == 1 if htf_ema_period < 500 else True

        call_signal = call_trend & call_slope & call_entry & call_st & call_mom & filters
        if htf_ema_period < 500:
            call_signal = call_signal & call_htf

        # ── PUT (short) ────────────────────────────────────────
        put_trend = _true if "ema_trend" in off else (df["ema_fast"] < df["ema_slow"])
        put_slope = _true if "ema_slope" in off else (df["ema_slope_falling"] == 1)
        # Entry group
        put_entry_parts: list = []
        if "pullback" not in off:
            put_entry_parts.append(df["pullback"] == 1)
        if "breakout" not in off:
            put_entry_parts.append(df["breakout_low"] == 1)
        put_entry = _or_group(put_entry_parts)
        put_st = _true if "supertrend" in off else (df["st_dir"] == -1)
        # Momentum group
        put_mom_parts: list = []
        if "macd_momentum" not in off:
            put_mom_parts.append(df["macd_mom_bear"] == 1)
        if "rsi_momentum" not in off:
            put_mom_parts.append(df["rsi_falling"] == 1)
        put_mom = _or_group(put_mom_parts)

        put_signal = put_trend & put_slope & put_entry & put_st & put_mom & filters

        # ── Combine: +1 = CALL, -1 = PUT ──────────────────────
        signal = pd.Series(0, index=df.index, dtype=int)
        signal[call_signal] = 1
        signal[put_signal] = -1
        # If both fire on same bar (rare), prefer the trend direction
        both = call_signal & put_signal
        if both.any():
            signal[both] = 0

        # Cooldown: suppress signals within N bars of a previous signal
        cooldown = p.get("cooldown_bars", 0)
        if cooldown > 0:
            last_signal_idx = -cooldown - 1
            for i in range(len(signal)):
                if signal.iloc[i] != 0:
                    if i - last_signal_idx <= cooldown:
                        signal.iloc[i] = 0
                    else:
                        last_signal_idx = i

        return signal
