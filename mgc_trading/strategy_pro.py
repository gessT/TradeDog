"""
MGC Pro Strategy — Multiple Strategy Types
============================================
Implements Pullback, Breakout, Momentum, and Trend-Following strategies
with configurable filters and exit modes.

Each strategy returns entry signals. The backtester handles exits.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from . import indicators as ind
from .indicators_pro import (
    atr_filter,
    in_trading_session,
    macd,
    market_structure,
    resample_to_higher_tf,
    volume_spike,
)
from .config import DEFAULT_PARAMS


# ═══════════════════════════════════════════════════════════════════════
# Extended Default Parameters
# ═══════════════════════════════════════════════════════════════════════

PRO_DEFAULTS: dict = {
    **DEFAULT_PARAMS,
    # Strategy type: "pullback", "breakout", "momentum", "trend_following"
    "strategy_type": "pullback",

    # MACD
    "macd_fast": 12,
    "macd_slow": 26,
    "macd_signal": 9,

    # Market structure
    "ms_lookback": 5,
    "use_market_structure": False,

    # Session filter
    "use_session_filter": True,
    "session_type": "london_ny",  # "london_ny", "ny_only", "all"

    # Volume spike
    "vol_spike_threshold": 1.2,

    # ATR volatility filter
    "use_atr_filter": False,
    "atr_min_pct": 0.0,  # min ATR as % of close

    # Breakout params
    "breakout_lookback": 20,  # bars for high/low channel

    # Trailing stop
    "trailing_atr_mult": 1.5,
    "use_trailing": True,

    # Time exit (max bars in trade)
    "use_time_exit": False,
    "max_bars_in_trade": 40,  # close after N bars

    # Direction
    "direction": "long",  # "long", "short", "both"

    # Multi-timeframe
    "use_mtf": False,  # Use 1H trend + 15m entry
    "mtf_ema_period": 50,  # EMA on higher TF for trend
}


# ═══════════════════════════════════════════════════════════════════════
# Pro Strategy Class
# ═══════════════════════════════════════════════════════════════════════

class MGCProStrategy:
    """Multi-strategy engine for MGC with configurable entry/exit logic."""

    def __init__(self, params: dict | None = None) -> None:
        self.p: dict = {**PRO_DEFAULTS, **(params or {})}

    def compute_indicators(self, df: pd.DataFrame) -> pd.DataFrame:
        """Compute all indicators on the DataFrame."""
        p = self.p
        df = df.copy()

        # Core indicators
        df["ema_fast"] = ind.ema(df["close"], p["ema_fast"])
        df["ema_slow"] = ind.ema(df["close"], p["ema_slow"])
        df["rsi"] = ind.rsi(df["close"], p["rsi_period"])
        df["atr"] = ind.atr(df["high"], df["low"], df["close"], p["atr_period"])

        # MACD
        df["macd_line"], df["macd_signal"], df["macd_hist"] = macd(
            df["close"], p["macd_fast"], p["macd_slow"], p["macd_signal"],
        )

        # Volume
        df["vol_above"] = ind.volume_above_ma(df["volume"], p["vol_period"], p["vol_mult"])
        df["vol_spike"] = volume_spike(df["volume"], p["vol_period"], p["vol_spike_threshold"])

        # Candlestick
        df["bullish_candle"] = ind.is_bullish_candle(df["open"], df["close"])
        df["bearish_candle"] = df["close"] < df["open"]
        df["bullish_engulfing"] = ind.is_bullish_engulfing(
            df["open"], df["high"], df["low"], df["close"],
        )

        # Supertrend
        if p.get("use_supertrend"):
            st_line, st_dir = ind.supertrend(
                df["high"], df["low"], df["close"], p["st_period"], p["st_mult"],
            )
            df["st_line"] = st_line
            df["st_dir"] = st_dir

        # Market structure
        if p.get("use_market_structure"):
            df["market_struct"] = market_structure(
                df["high"], df["low"], p["ms_lookback"],
            )

        # Session filter
        df["in_session"] = in_trading_session(df.index, p["session_type"])

        # Breakout channel
        df["channel_high"] = df["high"].rolling(p["breakout_lookback"]).max().shift(1)
        df["channel_low"] = df["low"].rolling(p["breakout_lookback"]).min().shift(1)

        # Multi-timeframe trend
        if p.get("use_mtf"):
            df["mtf_trend"] = self._compute_mtf_trend(df, p["mtf_ema_period"])
        else:
            df["mtf_trend"] = 1  # default bullish

        return df

    def _compute_mtf_trend(self, df: pd.DataFrame, ema_period: int) -> pd.Series:
        """Compute higher timeframe trend (1H EMA) and map back to 15m bars."""
        df_1h = resample_to_higher_tf(df, "1h")
        df_1h["ema_htf"] = ind.ema(df_1h["close"], ema_period)
        df_1h["htf_trend"] = (df_1h["close"] > df_1h["ema_htf"]).astype(int) * 2 - 1

        # Forward-fill to original index (no lookahead: use shift)
        htf_trend = df_1h["htf_trend"].reindex(df.index, method="ffill")
        return htf_trend.fillna(0).astype(int)

    def generate_signals(self, df: pd.DataFrame) -> pd.Series:
        """Generate entry signals based on strategy type.

        Returns Series of: 1 (long), -1 (short), 0 (no signal).
        Signal on bar i → enter at open of bar i+1.
        """
        p = self.p
        strategy_type = p["strategy_type"]

        if strategy_type == "pullback":
            return self._pullback_signals(df)
        elif strategy_type == "breakout":
            return self._breakout_signals(df)
        elif strategy_type == "momentum":
            return self._momentum_signals(df)
        elif strategy_type == "trend_following":
            return self._trend_following_signals(df)
        else:
            raise ValueError(f"Unknown strategy type: {strategy_type}")

    # ── Shared filters ──────────────────────────────────────────────

    def _apply_filters(self, signal: pd.Series, df: pd.DataFrame) -> pd.Series:
        """Apply session, volume, and MTF filters to raw signals."""
        p = self.p

        if p.get("use_session_filter"):
            signal = signal & df["in_session"]

        if p.get("use_market_structure") and "market_struct" in df.columns:
            # Long only when bullish structure, short when bearish
            long_ok = df["market_struct"] >= 0
            short_ok = df["market_struct"] <= 0
            long_signals = signal > 0
            short_signals = signal < 0
            signal = pd.Series(0, index=df.index)
            signal[long_signals & long_ok] = 1
            signal[short_signals & short_ok] = -1

        if p.get("use_mtf"):
            mtf = df["mtf_trend"]
            long_signals = signal > 0
            short_signals = signal < 0
            filtered = pd.Series(0, index=df.index)
            filtered[long_signals & (mtf > 0)] = 1
            filtered[short_signals & (mtf < 0)] = -1
            signal = filtered

        return signal

    # ── Strategy: Pullback ──────────────────────────────────────────

    def _pullback_signals(self, df: pd.DataFrame) -> pd.Series:
        p = self.p

        # Trend
        if p.get("use_supertrend") and "st_dir" in df.columns:
            uptrend = df["st_dir"] == 1
            downtrend = df["st_dir"] == -1
        else:
            uptrend = df["ema_fast"] > df["ema_slow"]
            downtrend = df["ema_fast"] < df["ema_slow"]

        # Pullback zone
        pullback_long = (df["close"] - df["ema_fast"]).abs() <= p["pullback_atr_mult"] * df["atr"]
        pullback_short = (df["close"] - df["ema_fast"]).abs() <= p["pullback_atr_mult"] * df["atr"]

        # RSI
        rsi_prev = df["rsi"].shift(1)
        rsi_recovery = (rsi_prev <= p["rsi_low"]) & (df["rsi"] > p["rsi_low"])
        rsi_strong = df["rsi"] > p["rsi_high"]
        rsi_long = rsi_recovery | rsi_strong

        rsi_overbought_drop = (rsi_prev >= (100 - p["rsi_low"])) & (df["rsi"] < (100 - p["rsi_low"]))
        rsi_weak = df["rsi"] < (100 - p["rsi_high"])
        rsi_short = rsi_overbought_drop | rsi_weak

        # Candle
        candle_long = df["bullish_candle"] | df["bullish_engulfing"]
        candle_short = df["bearish_candle"]

        # Volume
        vol_ok = df["vol_above"]

        # Combine
        long_signal = uptrend & pullback_long & rsi_long & candle_long & vol_ok
        short_signal = downtrend & pullback_short & rsi_short & candle_short & vol_ok

        signal = pd.Series(0, index=df.index, dtype=int)
        direction = p.get("direction", "long")
        if direction in ("long", "both"):
            signal[long_signal] = 1
        if direction in ("short", "both"):
            signal[short_signal] = -1

        return self._apply_filters(signal, df)

    # ── Strategy: Breakout ──────────────────────────────────────────

    def _breakout_signals(self, df: pd.DataFrame) -> pd.Series:
        p = self.p

        # Breakout: close crosses above channel high
        long_breakout = (df["close"] > df["channel_high"]) & (df["close"].shift(1) <= df["channel_high"].shift(1))
        short_breakout = (df["close"] < df["channel_low"]) & (df["close"].shift(1) >= df["channel_low"].shift(1))

        # Trend confirmation
        if p.get("use_supertrend") and "st_dir" in df.columns:
            uptrend = df["st_dir"] == 1
            downtrend = df["st_dir"] == -1
        else:
            uptrend = df["ema_fast"] > df["ema_slow"]
            downtrend = df["ema_fast"] < df["ema_slow"]

        # Volume confirmation (breakout needs volume spike)
        vol_ok = df["vol_spike"] | df["vol_above"]

        # RSI momentum for confirmation
        rsi_long = df["rsi"] > 50
        rsi_short = df["rsi"] < 50

        long_signal = long_breakout & uptrend & vol_ok & rsi_long
        short_signal = short_breakout & downtrend & vol_ok & rsi_short

        signal = pd.Series(0, index=df.index, dtype=int)
        direction = p.get("direction", "long")
        if direction in ("long", "both"):
            signal[long_signal] = 1
        if direction in ("short", "both"):
            signal[short_signal] = -1

        return self._apply_filters(signal, df)

    # ── Strategy: Momentum ──────────────────────────────────────────

    def _momentum_signals(self, df: pd.DataFrame) -> pd.Series:
        p = self.p

        # MACD crossover
        macd_long = (df["macd_hist"] > 0) & (df["macd_hist"].shift(1) <= 0)
        macd_short = (df["macd_hist"] < 0) & (df["macd_hist"].shift(1) >= 0)

        # RSI confirmation
        rsi_long = df["rsi"] > p["rsi_high"]
        rsi_short = df["rsi"] < (100 - p["rsi_high"])

        # Trend alignment
        uptrend = df["ema_fast"] > df["ema_slow"]
        downtrend = df["ema_fast"] < df["ema_slow"]

        # Volume
        vol_ok = df["vol_above"]

        # Candle
        candle_long = df["bullish_candle"]
        candle_short = df["bearish_candle"]

        long_signal = macd_long & rsi_long & uptrend & vol_ok & candle_long
        short_signal = macd_short & rsi_short & downtrend & vol_ok & candle_short

        signal = pd.Series(0, index=df.index, dtype=int)
        direction = p.get("direction", "long")
        if direction in ("long", "both"):
            signal[long_signal] = 1
        if direction in ("short", "both"):
            signal[short_signal] = -1

        return self._apply_filters(signal, df)

    # ── Strategy: Trend Following ───────────────────────────────────

    def _trend_following_signals(self, df: pd.DataFrame) -> pd.Series:
        p = self.p

        # EMA alignment: fast > slow AND price > fast (strong trend)
        strong_uptrend = (df["ema_fast"] > df["ema_slow"]) & (df["close"] > df["ema_fast"])
        strong_downtrend = (df["ema_fast"] < df["ema_slow"]) & (df["close"] < df["ema_fast"])

        # Supertrend confirmation
        if p.get("use_supertrend") and "st_dir" in df.columns:
            st_long = df["st_dir"] == 1
            st_short = df["st_dir"] == -1
            strong_uptrend = strong_uptrend & st_long
            strong_downtrend = strong_downtrend & st_short

        # MACD positive
        macd_long = df["macd_hist"] > 0
        macd_short = df["macd_hist"] < 0

        # RSI not overbought/oversold (trend continuation, not exhaustion)
        rsi_ok_long = (df["rsi"] > 40) & (df["rsi"] < 75)
        rsi_ok_short = (df["rsi"] > 25) & (df["rsi"] < 60)

        # Volume
        vol_ok = df["vol_above"]

        # Entry on trend resumption (after minor pullback)
        prev_below_ema = df["close"].shift(1) < df["ema_fast"].shift(1)
        cur_above_ema = df["close"] > df["ema_fast"]
        trend_resume_long = prev_below_ema & cur_above_ema

        prev_above_ema = df["close"].shift(1) > df["ema_fast"].shift(1)
        cur_below_ema = df["close"] < df["ema_fast"]
        trend_resume_short = prev_above_ema & cur_below_ema

        long_signal = strong_uptrend & macd_long & rsi_ok_long & vol_ok & trend_resume_long
        short_signal = strong_downtrend & macd_short & rsi_ok_short & vol_ok & trend_resume_short

        signal = pd.Series(0, index=df.index, dtype=int)
        direction = p.get("direction", "long")
        if direction in ("long", "both"):
            signal[long_signal] = 1
        if direction in ("short", "both"):
            signal[short_signal] = -1

        return self._apply_filters(signal, df)
