"""
VPB v3 — Multi-Timeframe Volume-Price Strategy (量价分析)
===========================================================
Core theory (量价关系):
  量缩价稳 → 蓄力 (volume shrinks, price stable = accumulation)
  量增价升 → 突破 (volume expands, price breaks out = entry)

Architecture:
  • Daily bars: trend direction + accumulation detection (≥M of last N bars)
  • 1H bars:   precise entry on volume-confirmed breakout

Entry conditions:
  1. Daily trend up: close > EMA20 daily, EMA20 > EMA50 daily
  2. Accumulation on daily: ≥M of last N bars have low vol + tight range
  3. 1H breakout: close > recent N-bar high on 1H (local resistance)
  4. 1H volume surge: volume > X × vol_ma (量增)
  5. Bullish 1H candle: close > open, body ratio ≥ threshold

Risk management:
  • SL = recent swing low on 1H (h_sl_lookback bars) — tight, 1H-based
  • TP = R-multiple (1.5R default for high WR)
  • Breakeven at 1R
  • Trailing stop at X × ATR from peak
  • Long-only (market bias)
  • Cooldown: 3 bars between trades
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from strategies.futures import indicators as ind

DEFAULT_VPB3_PARAMS: dict = {
    # ── Daily trend ──
    "d_ema_fast": 20,
    "d_ema_slow": 50,

    # ── Daily accumulation detection ──
    # Set accum_min_bars=0 to disable (testing showed it hurts WR)
    "accum_min_bars": 0,
    "accum_vol_ratio": 0.90,
    "accum_range_atr": 1.8,
    "accum_lookback": 8,

    # ── 1H indicators ──
    "h_atr_period": 14,
    "h_ema_fast": 20,
    "h_vol_period": 20,

    # ── 1H entry filters ──
    "h_vol_multiplier": 1.2,     # breakout vol > X × vol_ma  (量增)
    "h_body_ratio_min": 0.25,    # min candle body ratio
    "h_close_top_pct": 0.30,     # close in top X% of range
    "h_breakout_lookback": 5,    # break above N-bar high on 1H

    # ── Session filter ──
    # Disabled by default (testing showed it reduces trades too much)
    "use_session_filter": False,
    "session_skip_first_min": 30,
    "session_skip_last_min": 30,

    # ── Risk management ──
    "tp_r_multiple": 0.8,        # balanced: 62% WR / 25% ROI
    "h_sl_lookback": 3,          # SL = lowest low of last N 1H bars
    "min_sl_atr": 0.5,           # min SL distance in ATR multiples

    # ── RSI filter ──
    "h_rsi_period": 14,
    "h_rsi_min": 40,             # avoid oversold (weak trend)
    "h_rsi_max": 72,             # avoid overbought (exhausted)

    # ── Breakeven / Trailing ──
    "use_breakeven": False,
    "be_trigger_r": 0.5,
    "be_offset_atr": 0.1,
    "use_trailing": False,
    "trailing_atr_mult": 2.5,

    # ── Direction ──
    "long_only": True,

    # ── Cooldown ──
    "cooldown_bars": 2,
}


class VPBv3Strategy:
    """Multi-timeframe Volume-Price Analysis strategy."""

    def __init__(self, params: dict | None = None):
        self.p = {**DEFAULT_VPB3_PARAMS, **(params or {})}

    # ═══════════════════════════════════════════════════════
    # Daily context analysis
    # ═══════════════════════════════════════════════════════

    def compute_daily_context(self, df_daily: pd.DataFrame) -> pd.DataFrame:
        """Compute daily-level trend and accumulation detection.

        Accumulation uses flexible counting: ≥M of last N bars
        have low volume AND tight range (not strictly consecutive).
        """
        p = self.p
        c = df_daily["close"]
        h = df_daily["high"]
        l_ = df_daily["low"]
        v = df_daily["volume"]

        df_daily["d_ema_fast"] = ind.ema(c, p["d_ema_fast"])
        df_daily["d_ema_slow"] = ind.ema(c, p["d_ema_slow"])
        df_daily["d_trend_up"] = (
            (c > df_daily["d_ema_fast"]) &
            (df_daily["d_ema_fast"] > df_daily["d_ema_slow"])
        ).astype(int)

        df_daily["d_atr"] = ind.atr(h, l_, c, 14)
        df_daily["d_vol_ma"] = v.rolling(20, min_periods=20).mean()

        # ── Accumulation detection (flexible, not consecutive) ──
        min_bars = p["accum_min_bars"]
        if min_bars <= 0:
            # Disabled — always pass
            df_daily["d_in_accum"] = 1
        else:
            # 量缩: volume below threshold
            vol_low = v < (df_daily["d_vol_ma"] * p["accum_vol_ratio"])
            # 价稳: daily range < X × ATR (tight price action)
            range_tight = (h - l_) < (df_daily["d_atr"] * p["accum_range_atr"])

            # Count qualifying bars in lookback window
            qualify = (vol_low & range_tight).astype(int)
            lb = p["accum_lookback"]
            count_in_window = qualify.rolling(lb, min_periods=min_bars).sum()
            df_daily["d_in_accum"] = (count_in_window >= min_bars).astype(int)

        return df_daily

    # ═══════════════════════════════════════════════════════
    # 1H indicators
    # ═══════════════════════════════════════════════════════

    def compute_1h_indicators(self, df_1h: pd.DataFrame) -> pd.DataFrame:
        """Compute 1H-level indicators for entry timing."""
        p = self.p
        c = df_1h["close"]
        h = df_1h["high"]
        l_ = df_1h["low"]
        o = df_1h["open"]
        v = df_1h["volume"]

        df_1h["h_atr"] = ind.atr(h, l_, c, p["h_atr_period"])
        df_1h["h_ema"] = ind.ema(c, p["h_ema_fast"])
        df_1h["h_vol_ma"] = v.rolling(p["h_vol_period"], min_periods=p["h_vol_period"]).mean()
        df_1h["h_rsi"] = ind.rsi(c, p["h_rsi_period"])

        # Candle metrics
        candle_range = (h - l_).replace(0, np.nan)
        body = (c - o).abs()
        df_1h["h_body_ratio"] = (body / candle_range).fillna(0)
        df_1h["h_close_pos"] = ((c - l_) / candle_range).fillna(0.5)

        # Session filter
        if p["use_session_filter"] and hasattr(df_1h.index, "hour"):
            bar_min = df_1h.index.hour * 60 + df_1h.index.minute
            ok_start = 9 * 60 + 30 + p["session_skip_first_min"]
            ok_end = 16 * 60 - p["session_skip_last_min"]
            df_1h["h_in_session"] = ((bar_min >= ok_start) & (bar_min < ok_end)).astype(int)
        else:
            df_1h["h_in_session"] = 1

        return df_1h

    # ═══════════════════════════════════════════════════════
    # Map daily context to 1H bars
    # ═══════════════════════════════════════════════════════

    @staticmethod
    def map_daily_to_1h(df_daily: pd.DataFrame, df_1h: pd.DataFrame) -> pd.DataFrame:
        """Map daily-level columns onto 1H bars using date alignment.

        For each 1H bar, use the PREVIOUS day's daily data
        (avoid look-ahead bias).
        """
        daily_cols = [
            "d_trend_up", "d_atr", "d_vol_ma", "d_in_accum",
            "d_ema_fast", "d_ema_slow",
        ]

        # Extract date from 1H index
        if hasattr(df_1h.index, "date"):
            h_dates = pd.Series(df_1h.index.date, index=df_1h.index)
        else:
            h_dates = pd.Series(pd.to_datetime(df_1h.index).date, index=df_1h.index)

        # Build a daily lookup shifted by 1 day (use previous day's context)
        daily_lookup = df_daily[daily_cols].copy()
        daily_lookup.index = pd.to_datetime(daily_lookup.index.date) if hasattr(daily_lookup.index, "date") else pd.to_datetime(daily_lookup.index)
        # Shift forward by 1 day — today's 1H bars use yesterday's daily context
        daily_lookup = daily_lookup.shift(1)
        daily_lookup.index = daily_lookup.index.date

        # Map
        for col in daily_cols:
            df_1h[col] = h_dates.map(daily_lookup[col]).values

        return df_1h

    # ═══════════════════════════════════════════════════════
    # Signal generation
    # ═══════════════════════════════════════════════════════

    def generate_signals(
        self,
        df: pd.DataFrame,
        disabled: set[str] | None = None,
    ) -> pd.Series:
        """Generate entry signals on 1H bars (with daily context mapped).

        Signal = +1 LONG if all conditions met, 0 otherwise.
        Also sets signal_sl (swing low on 1H) for backtester SL placement.
        """
        p = self.p
        off = disabled or set()
        n = len(df)
        signals = pd.Series(0, index=df.index)

        c = df["close"].values
        h = df["high"].values
        l_ = df["low"].values
        o = df["open"].values
        v = df["volume"].values

        h_ema = df["h_ema"].values
        h_vol_ma = df["h_vol_ma"].values
        h_body_ratio = df["h_body_ratio"].values
        h_close_pos = df["h_close_pos"].values
        h_in_session = df["h_in_session"].values
        h_atr = df["h_atr"].values
        h_rsi = df["h_rsi"].values if "h_rsi" in df else np.full(n, 55.0)

        d_trend_up = df["d_trend_up"].values if "d_trend_up" in df else np.ones(n)
        d_in_accum = df["d_in_accum"].values if "d_in_accum" in df else np.ones(n)

        vol_mult = p["h_vol_multiplier"]
        body_min = p["h_body_ratio_min"]
        close_top = p["h_close_top_pct"]
        cooldown = p["cooldown_bars"]
        breakout_lb = p["h_breakout_lookback"]
        sl_lb = p["h_sl_lookback"]
        min_sl_atr = p["min_sl_atr"]

        last_signal = -cooldown - 1

        # Pre-compute rolling high/low for breakout and SL
        df["_roll_high"] = pd.Series(h).rolling(breakout_lb, min_periods=breakout_lb).max().values
        df["_roll_low"] = pd.Series(l_).rolling(sl_lb, min_periods=sl_lb).min().values

        roll_high = df["_roll_high"].values
        roll_low = df["_roll_low"].values

        # Signal SL storage
        df["signal_sl"] = np.nan

        for i in range(max(breakout_lb, sl_lb) + 1, n):
            if i - last_signal <= cooldown:
                continue

            # ── LONG entry conditions ──────────────────

            # 1. Daily trend up
            if "daily_trend" not in off:
                if d_trend_up[i] != 1:
                    continue

            # 2. Daily accumulation detected (量缩价稳)
            if "accum" not in off:
                if d_in_accum[i] != 1:
                    continue

            # 3. 1H breakout: close > recent N-bar high (excluding current bar)
            if "breakout" not in off:
                recent_high = roll_high[i - 1]  # high of previous N bars
                if np.isnan(recent_high) or c[i] <= recent_high:
                    continue

            # 4. Volume surge on 1H bar (量增)
            if "vol_surge" not in off:
                if np.isnan(h_vol_ma[i]) or h_vol_ma[i] <= 0:
                    continue
                if v[i] <= h_vol_ma[i] * vol_mult:
                    continue

            # 5. RSI filter (avoid overbought/oversold)
            if "rsi" not in off:
                rsi_val = h_rsi[i]
                if np.isnan(rsi_val):
                    continue
                if rsi_val < p["h_rsi_min"] or rsi_val > p["h_rsi_max"]:
                    continue

            # 6. 1H price above EMA (trend alignment)
            if "h_ema_trend" not in off:
                if c[i] <= h_ema[i]:
                    continue

            # 7. Strong bullish candle
            if "candle_quality" not in off:
                if c[i] <= o[i]:  # must be bullish
                    continue
                if h_body_ratio[i] < body_min:
                    continue
                if h_close_pos[i] < (1.0 - close_top):
                    continue

            # 8. Session filter
            if "session" not in off:
                if h_in_session[i] == 0:
                    continue

            # All conditions passed → signal
            signals.iloc[i] = 1
            last_signal = i

            # Compute SL: swing low of last N bars on 1H
            swing_low = roll_low[i]
            atr_i = h_atr[i] if not np.isnan(h_atr[i]) else 1.0
            # Ensure minimum SL distance
            min_distance = min_sl_atr * atr_i
            if c[i] - swing_low < min_distance:
                swing_low = c[i] - min_distance
            df.iloc[i, df.columns.get_loc("signal_sl")] = swing_low

        # Cleanup temp columns
        df.drop(columns=["_roll_high", "_roll_low"], inplace=True, errors="ignore")

        return signals
