"""
1-Hour Strategy — Multi-condition entry for US stocks
======================================================
Same logic as 5-min futures strategy but tuned for 1-hour bars.
Entry / Exit conditions are identical; only default params differ.
"""
from __future__ import annotations

import pandas as pd

from strategies.futures import indicators as ind
from strategies.us_stock import indicators_1h as ind1h


# ═══════════════════════════════════════════════════════════════════════
# Default 1-Hour Parameters (wider than 5min — larger bars)
# ═══════════════════════════════════════════════════════════════════════

DEFAULT_1H_PARAMS: dict = {
    # Trend — EMA
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
    # ATR
    "atr_period": 14,
    "atr_sl_mult": 3.0,
    "atr_tp_mult": 2.5,
    # Breakeven
    "use_breakeven": False,
    "be_atr_mult": 1.5,
    "be_offset_atr": 0.3,
    # Supertrend
    "st_period": 10,
    "st_mult": 2.0,
    # Pullback / Breakout
    "pullback_atr_mult": 2.0,
    "breakout_lookback": 20,
    # Volume
    "vol_period": 20,
    "vol_spike_mult": 0.8,
    # Session filter OFF
    "use_session_filter": False,
    # ATR range filter
    "min_atr_pct": 0.03,
    # Trailing stop
    "trailing_atr_mult": 1.5,
    "use_trailing": False,
    # ADX
    "adx_period": 14,
    "adx_min": 0,
    # Higher TF
    "htf_ema_period": 999,
    # Cooldown
    "cooldown_bars": 0,
}


class USStrategy1H:
    """1-hour strategy with multi-indicator confirmation (same logic as 5-min)."""

    def __init__(self, params: dict | None = None):
        self.p = {**DEFAULT_1H_PARAMS, **(params or {})}

    def compute_indicators(self, df: pd.DataFrame) -> pd.DataFrame:
        """Add all indicator columns."""
        p = self.p
        c = df["close"]

        # EMAs
        df["ema_fast"] = ind.ema(c, p["ema_fast"])
        df["ema_slow"] = ind.ema(c, p["ema_slow"])
        df["ema_slope"] = ind1h.ema_slope(df["ema_fast"], lookback=3)
        df["ema_slope_falling"] = ind1h.ema_slope_falling(df["ema_fast"], lookback=3)

        # RSI
        df["rsi"] = ind.rsi(c, p["rsi_period"])

        # ATR
        df["atr"] = ind.atr(df["high"], df["low"], c, p["atr_period"])

        # Supertrend
        st_line, st_dir = ind.supertrend(
            df["high"], df["low"], c, p["st_period"], p["st_mult"]
        )
        df["st_line"] = st_line
        df["st_dir"] = st_dir

        # MACD
        macd_line, macd_sig, macd_hist = ind1h.macd(
            c, p["macd_fast"], p["macd_slow"], p["macd_signal"]
        )
        df["macd_line"] = macd_line
        df["macd_signal"] = macd_sig
        df["macd_hist"] = macd_hist
        df["macd_mom"] = ind1h.macd_momentum(macd_hist)
        df["macd_mom_bear"] = ind1h.macd_momentum_bear(macd_hist)

        # Breakout
        df["breakout"] = ind1h.breakout_high(c, df["high"], p["breakout_lookback"])
        df["breakout_low"] = ind1h.breakout_low(c, df["low"], p["breakout_lookback"])

        # Pullback
        df["pullback"] = ind1h.pullback_to_ema(
            c, df["ema_fast"], df["atr"], p["pullback_atr_mult"]
        )

        # Volume
        df["vol_spike"] = ind1h.volume_spike(
            df["volume"], p["vol_period"], p["vol_spike_mult"]
        )

        # RSI
        df["rsi_rising"] = ind1h.rsi_rising(df["rsi"], p["rsi_low"], p["rsi_high"])
        df["rsi_falling"] = ind1h.rsi_falling(df["rsi"])

        # ADX
        df["adx"] = ind1h.adx(df["high"], df["low"], c, p.get("adx_period", 14))

        # HTF trend
        df["htf_trend"] = ind1h.higher_tf_trend(c, p.get("htf_ema_period", 50))

        # Session filter — off for 1h by default
        df["in_session"] = 1

        # ATR range
        df["atr_ok"] = ind1h.atr_range_ok(df["atr"], p["min_atr_pct"], c)

        # Market structure
        df["mkt_structure"] = ind1h.market_structure(
            df["high"], df["low"], c, lookback=100, swing_order=3,
        )

        return df

    def generate_signals(self, df: pd.DataFrame, disabled: set[str] | None = None) -> pd.Series:
        """Generate entry signals: +1 = CALL, -1 = PUT, 0 = no signal."""
        p = self.p
        off = disabled or set()
        _true = pd.Series(True, index=df.index)

        def _or_group(parts: list) -> pd.Series:
            if not parts:
                return _true
            result = parts[0]
            for p2 in parts[1:]:
                result = result | p2
            return result

        # Common filters
        cond_vol = _true if "volume_spike" in off else (df["vol_spike"] == 1)
        cond_session = _true if "session_ok" in off else (df["in_session"] == 1)
        cond_atr = _true if "atr_range" in off else (df["atr_ok"] == 1)
        cond_adx = _true if "adx_ok" in off else (df["adx"] >= p.get("adx_min", 0))
        filters = cond_vol & cond_session & cond_atr & cond_adx

        # CALL
        call_trend = _true if "ema_trend" in off else (df["ema_fast"] > df["ema_slow"])
        call_slope = _true if "ema_slope" in off else (df["ema_slope"] == 1)
        call_entry_parts: list = []
        if "pullback" not in off:
            call_entry_parts.append(df["pullback"] == 1)
        if "breakout" not in off:
            call_entry_parts.append(df["breakout"] == 1)
        call_entry = _or_group(call_entry_parts)
        call_st = _true if "supertrend" in off else (df["st_dir"] == 1)
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

        # PUT
        put_trend = _true if "ema_trend" in off else (df["ema_fast"] < df["ema_slow"])
        put_slope = _true if "ema_slope" in off else (df["ema_slope_falling"] == 1)
        put_entry_parts: list = []
        if "pullback" not in off:
            put_entry_parts.append(df["pullback"] == 1)
        if "breakout" not in off:
            put_entry_parts.append(df["breakout_low"] == 1)
        put_entry = _or_group(put_entry_parts)
        put_st = _true if "supertrend" in off else (df["st_dir"] == -1)
        put_mom_parts: list = []
        if "macd_momentum" not in off:
            put_mom_parts.append(df["macd_mom_bear"] == 1)
        if "rsi_momentum" not in off:
            put_mom_parts.append(df["rsi_falling"] == 1)
        put_mom = _or_group(put_mom_parts)
        put_signal = put_trend & put_slope & put_entry & put_st & put_mom & filters

        # Combine
        signal = pd.Series(0, index=df.index, dtype=int)
        signal[call_signal] = 1
        signal[put_signal] = -1
        both = call_signal & put_signal
        if both.any():
            signal[both] = 0

        # Cooldown
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
