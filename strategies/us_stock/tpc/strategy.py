"""
TPC Strategy — Trend-Pullback-Continuation
=============================================
Multi-timeframe LONG-only trend-following strategy.

Core concept:
  Weekly SuperTrend → confirms macro bullish trend
  Daily EMA200 + ADX → confirms trend strength (no sideways noise)
  Daily HalfTrend → detects pullback + continuation (re-flip to UP)
  1H bar → precise entry on pullback recovery + volume + bullish candle

Entry logic (pullback continuation, NOT breakout):
  1. Weekly SuperTrend = bullish (+1)
  2. Daily close > EMA200 (strong uptrend)
  3. Daily ADX > 20 (trending, not sideways)
  4. Daily HalfTrend has JUST flipped back to up (0)
     — meaning price pulled back (HT went down) then recovered (HT back up)
     — OR HalfTrend is already up AND price pulled back near 1H EMA50
  5. 1H: price near EMA50 (within pullback_atr_dist × ATR) — pullback zone
  6. 1H: volume > vol_multiplier × vol_ma — confirmation
  7. 1H: strong bullish candle (body ratio, close > open)
  8. 1H: RSI in [35, 65] — not overbought/oversold

Trade frequency control:
  • One entry per trend cycle (resets when weekly ST flips)
  • Minimum cooldown_bars between trades
  • No pyramiding

Each condition can be individually disabled from the frontend.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from .config import DEFAULT_TPC_PARAMS
from .indicators import ema, sma, rsi, atr, adx, supertrend, halftrend


class TPCStrategy:
    """Multi-timeframe Trend-Pullback-Continuation strategy."""

    DISABLEABLE = {
        "w_st_trend",       # Weekly SuperTrend must be bullish
        "d_ema200",         # Daily close > EMA200
        "d_adx",            # Daily ADX > threshold
        "d_ht_pullback",    # Daily HalfTrend pullback continuation
        "h_pullback_zone",  # 1H price near EMA50 (pullback zone)
        "h_volume",         # 1H volume confirmation
        "h_candle",         # 1H bullish candle quality
        "h_rsi",            # 1H RSI filter
        "h_ema_trend",      # 1H EMA fast > slow
        "volatility",       # Min ATR% filter
    }

    def __init__(self, params: dict | None = None):
        self.p = {**DEFAULT_TPC_PARAMS, **(params or {})}

    # ═══════════════════════════════════════════════════════
    # Weekly indicators
    # ═══════════════════════════════════════════════════════

    def compute_weekly(self, df_w: pd.DataFrame) -> pd.DataFrame:
        """Add Weekly SuperTrend to weekly bars."""
        p = self.p
        df_w = df_w.copy()
        st_line, st_dir = supertrend(
            df_w["high"], df_w["low"], df_w["close"],
            period=p["w_st_period"], multiplier=p["w_st_mult"],
        )
        df_w["w_st_line"] = st_line
        df_w["w_st_dir"] = st_dir
        return df_w

    # ═══════════════════════════════════════════════════════
    # Daily indicators
    # ═══════════════════════════════════════════════════════

    def compute_daily(self, df_d: pd.DataFrame) -> pd.DataFrame:
        """Add EMA200, ADX, HalfTrend to daily bars."""
        p = self.p
        df_d = df_d.copy()

        # EMA200 trend strength
        df_d["d_ema200"] = ema(df_d["close"], p["d_ema_trend"])

        # ADX trend strength
        df_d["d_adx"] = adx(df_d["high"], df_d["low"], df_d["close"], p["d_adx_period"])

        # HalfTrend — pullback detection
        ht_line, ht_dir = halftrend(
            df_d["high"], df_d["low"], df_d["close"],
            amplitude=p["d_ht_amplitude"],
            channel_deviation=p["d_ht_channel_dev"],
            atr_length=p["d_ht_atr_length"],
        )
        df_d["d_ht_line"] = ht_line
        df_d["d_ht_dir"] = ht_dir

        # Track HT direction changes (for pullback flip detection)
        df_d["d_ht_dir_prev"] = df_d["d_ht_dir"].shift(1)
        # Bars since last HT flip to up (0)
        df_d["d_ht_just_flipped_up"] = (
            (df_d["d_ht_dir"] == 0) & (df_d["d_ht_dir_prev"] == 1)
        ).astype(int)

        # Count bars since last HT flip to up (for entry window)
        flip_up = df_d["d_ht_just_flipped_up"].values
        bars_since = np.full(len(df_d), 999, dtype=np.int32)
        counter = 999
        for i in range(len(df_d)):
            if flip_up[i] == 1:
                counter = 0
            else:
                counter += 1
            bars_since[i] = counter
        df_d["d_bars_since_ht_flip"] = bars_since

        # Daily ATR for reference
        df_d["d_atr"] = atr(df_d["high"], df_d["low"], df_d["close"], 14)

        return df_d

    # ═══════════════════════════════════════════════════════
    # 1H indicators
    # ═══════════════════════════════════════════════════════

    def compute_1h(self, df_1h: pd.DataFrame) -> pd.DataFrame:
        """Add entry indicators to 1H bars."""
        p = self.p
        df_1h = df_1h.copy()

        df_1h["h_ema_fast"] = ema(df_1h["close"], p["h_ema_fast"])
        df_1h["h_ema_slow"] = ema(df_1h["close"], p["h_ema_slow"])
        df_1h["h_rsi"] = rsi(df_1h["close"], p["h_rsi_period"])
        df_1h["h_atr"] = atr(df_1h["high"], df_1h["low"], df_1h["close"], p["h_atr_period"])
        df_1h["h_vol_ma"] = df_1h["volume"].rolling(p["h_vol_period"], min_periods=p["h_vol_period"]).mean()

        # Candle metrics
        candle_range = (df_1h["high"] - df_1h["low"]).replace(0, np.nan)
        body = (df_1h["close"] - df_1h["open"]).abs()
        df_1h["h_body_ratio"] = (body / candle_range).fillna(0)

        return df_1h

    # ═══════════════════════════════════════════════════════
    # Merge higher TF data into 1H
    # ═══════════════════════════════════════════════════════

    @staticmethod
    def merge_weekly_into_daily(df_d: pd.DataFrame, df_w: pd.DataFrame) -> pd.DataFrame:
        """Forward-fill weekly SuperTrend direction into daily bars.

        Uses PREVIOUS completed weekly bar to prevent look-ahead.
        """
        weekly_cols = ["w_st_dir", "w_st_line"]
        available = [c for c in weekly_cols if c in df_w.columns]

        # Shift by 1 week — use last week's completed values
        weekly_shifted = df_w[available].shift(1)

        # Reindex to daily timestamps with forward-fill
        weekly_reindexed = weekly_shifted.reindex(df_d.index, method="ffill")
        for col in available:
            df_d[col] = weekly_reindexed[col]

        return df_d

    @staticmethod
    def merge_daily_into_1h(df_1h: pd.DataFrame, df_d: pd.DataFrame) -> pd.DataFrame:
        """Forward-fill daily columns into 1H bars.

        Uses PREVIOUS day's values (no look-ahead bias).
        """
        daily_cols = [
            "d_ema200", "d_adx", "d_ht_dir", "d_ht_dir_prev",
            "d_ht_just_flipped_up", "d_ht_line", "d_atr",
            "d_bars_since_ht_flip",
            "w_st_dir", "w_st_line",
        ]
        available = [c for c in daily_cols if c in df_d.columns]

        # Extract date from 1H index
        if hasattr(df_1h.index, "date"):
            h_dates = pd.Series(df_1h.index.date, index=df_1h.index)
        else:
            h_dates = pd.Series(pd.to_datetime(df_1h.index).date, index=df_1h.index)

        # Build daily lookup shifted by 1 day
        daily_lookup = df_d[available].copy()
        daily_lookup.index = (
            pd.to_datetime(daily_lookup.index.date)
            if hasattr(daily_lookup.index, "date")
            else pd.to_datetime(daily_lookup.index)
        )
        daily_lookup = daily_lookup.shift(1)
        daily_lookup.index = daily_lookup.index.date

        for col in available:
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
        """Generate entry signals on 1H bars.

        Returns Series: +1 = LONG entry, 0 = no signal.
        Uses PREVIOUS bar logic where applicable.

        Also sets `signal_sl` column for backtester SL placement.
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

        h_ema_fast = df["h_ema_fast"].values
        h_ema_slow = df["h_ema_slow"].values
        h_rsi = df["h_rsi"].values if "h_rsi" in df else np.full(n, 50.0)
        h_atr = df["h_atr"].values
        h_vol_ma = df["h_vol_ma"].values
        h_body_ratio = df["h_body_ratio"].values

        # Higher TF context (mapped from daily)
        w_st_dir = df["w_st_dir"].values if "w_st_dir" in df else np.ones(n)
        d_ema200 = df["d_ema200"].values if "d_ema200" in df else np.full(n, np.nan)
        d_adx = df["d_adx"].values if "d_adx" in df else np.full(n, 30.0)
        d_ht_dir = df["d_ht_dir"].values if "d_ht_dir" in df else np.zeros(n)
        d_ht_just_flipped = df["d_ht_just_flipped_up"].values if "d_ht_just_flipped_up" in df else np.zeros(n)
        d_bars_since_ht = df["d_bars_since_ht_flip"].values if "d_bars_since_ht_flip" in df else np.full(n, 999)

        cooldown = p["cooldown_bars"]
        last_signal = -cooldown - 1
        # Track trend cycle: reset when weekly ST flips
        in_cycle = False
        prev_w_st = 0

        # Pre-compute swing low for SL
        sl_lookback = 10  # 10 bars lookback for swing low
        df["_roll_low"] = pd.Series(l_).rolling(sl_lookback, min_periods=sl_lookback).min().values
        roll_low = df["_roll_low"].values
        df["signal_sl"] = np.nan

        for i in range(max(sl_lookback, 50) + 1, n):
            # ── Trend cycle tracking ──
            cur_w_st = w_st_dir[i]
            if not np.isnan(cur_w_st) and cur_w_st != prev_w_st:
                in_cycle = False  # Reset on weekly ST change
                prev_w_st = cur_w_st

            # One entry per cycle
            if p["one_per_cycle"] and in_cycle and "w_st_trend" not in off:
                continue

            # Cooldown
            if i - last_signal <= cooldown:
                continue

            # ── 1. Weekly SuperTrend must be bullish ──
            if "w_st_trend" not in off:
                if np.isnan(w_st_dir[i]) or int(w_st_dir[i]) != 1:
                    continue

            # ── 2. Daily close > EMA200 ──
            if "d_ema200" not in off:
                if np.isnan(d_ema200[i]) or c[i] <= d_ema200[i]:
                    continue

            # ── 3. Daily ADX > threshold ──
            if "d_adx" not in off:
                if np.isnan(d_adx[i]) or d_adx[i] < p["d_adx_min"]:
                    continue

            # ── 4. Daily HalfTrend pullback continuation ──
            # HT must be UP (0) AND have flipped up RECENTLY (within 10 daily bars)
            # This is the core pullback→continuation signal:
            #   trend was up → price pulled back (HT flipped down) →
            #   price recovered (HT flipped back up) → enter within window
            if "d_ht_pullback" not in off:
                if np.isnan(d_ht_dir[i]) or int(d_ht_dir[i]) != 0:
                    continue
                if d_bars_since_ht[i] > 10:  # Must be within 10 days of flip
                    continue

            # ── 5. 1H price near pullback EMA (within ATR distance) ──
            # Price should be near EMA50 support (not extended far above)
            if "h_pullback_zone" not in off:
                ema_ref = h_ema_slow[i]  # EMA50 as pullback zone
                atr_i = h_atr[i]
                if np.isnan(ema_ref) or np.isnan(atr_i) or atr_i <= 0:
                    continue
                dist = abs(c[i] - ema_ref) / atr_i
                if dist > p["pullback_atr_dist"]:
                    continue

            # ── 6. 1H EMA trend alignment ──
            if "h_ema_trend" not in off:
                if np.isnan(h_ema_fast[i]) or np.isnan(h_ema_slow[i]):
                    continue
                if h_ema_fast[i] <= h_ema_slow[i]:
                    continue

            # ── 7. 1H volume confirmation ──
            if "h_volume" not in off:
                if np.isnan(h_vol_ma[i]) or h_vol_ma[i] <= 0:
                    continue
                if v[i] <= h_vol_ma[i] * p["h_vol_multiplier"]:
                    continue

            # ── 8. 1H bullish candle quality ──
            if "h_candle" not in off:
                if c[i] <= o[i]:  # Must be green
                    continue
                if h_body_ratio[i] < p["h_body_ratio_min"]:
                    continue

            # ── 9. 1H RSI filter ──
            if "h_rsi" not in off:
                rsi_val = h_rsi[i]
                if np.isnan(rsi_val):
                    continue
                if rsi_val < p["h_rsi_min"] or rsi_val > p["h_rsi_max"]:
                    continue

            # ── 10. Volatility filter (avoid dead markets) ──
            if "volatility" not in off:
                atr_i = h_atr[i]
                if np.isnan(atr_i) or c[i] <= 0:
                    continue
                if atr_i / c[i] < p["min_atr_pct"]:
                    continue

            # ═══ All conditions passed → LONG signal ═══
            signals.iloc[i] = 1
            last_signal = i
            in_cycle = True

            # Compute SL: swing low of last N bars on 1H
            swing_low = roll_low[i]
            atr_i = h_atr[i] if not np.isnan(h_atr[i]) else 1.0
            min_distance = p["atr_sl_mult"] * atr_i
            if np.isnan(swing_low) or c[i] - swing_low < min_distance:
                swing_low = c[i] - min_distance
            df.iloc[i, df.columns.get_loc("signal_sl")] = swing_low

        # Cleanup temp columns
        df.drop(columns=["_roll_low"], inplace=True, errors="ignore")

        return signals
