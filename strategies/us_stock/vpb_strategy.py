"""
Volume-Price Breakout (VPB) Strategy — 1-Hour US Stocks
=========================================================
Identifies consolidation phases with low volatility, then enters on
volume-confirmed breakouts from a "base candle".

Strategy Logic:
  1. Consolidation detection: tight price range + low ATR over N bars
  2. Base candle: volume > X × 20-bar average + strong body ratio
  3. Entry: price breaks base_high (long) or base_low (short)
     with close near candle extreme + EMA trend filter
  4. SL: breakout candle low/high; TP: 2R or ATR-based
  5. Filters: skip flat EMA, skip low-volume markets
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from strategies.futures import indicators as ind

# ═══════════════════════════════════════════════════════════════════════
# Default Parameters
# ═══════════════════════════════════════════════════════════════════════

DEFAULT_VPB_PARAMS: dict = {
    # ── Consolidation ──
    "consol_window": 15,              # lookback for consolidation detection
    "consol_range_atr_mult": 5.0,     # max range = X × ATR (tight range)
    "atr_period": 14,

    # ── Base candle ──
    "vol_period": 20,                 # volume MA lookback
    "vol_multiplier": 1.5,            # base candle volume > X × avg
    "body_ratio_min": 0.55,           # min body/range ratio (strong candle)

    # ── Trend filter ──
    "ema_period": 28,                 # EMA for trend direction
    "ema_slope_lookback": 5,          # bars to check EMA slope
    "ema_slope_min": 0.0005,          # min abs slope (avoid flat)

    # ── Breakout confirmation ──
    "close_near_extreme_pct": 0.30,   # close within top/bottom 30% of range

    # ── Risk management ──
    "atr_sl_mult": 1.5,              # fallback SL if candle-based SL too tight
    "tp_r_multiple": 2.0,            # TP = R-multiple of risk
    "use_atr_tp": False,             # use ATR-based TP instead of R-multiple
    "atr_tp_mult": 3.0,              # TP = X × ATR (if use_atr_tp)

    # ── Trailing / Breakeven ──
    "use_breakeven": False,
    "be_atr_mult": 1.0,
    "be_offset_atr": 0.1,
    "use_trailing": False,
    "trailing_atr_mult": 1.5,

    # ── Cooldown ──
    "cooldown_bars": 3,               # bars to wait after a trade
}


class VPBStrategy:
    """Volume-Price Breakout strategy engine."""

    def __init__(self, params: dict | None = None):
        self.p = {**DEFAULT_VPB_PARAMS, **(params or {})}

    # ═══════════════════════════════════════════════════════════════════
    # Indicators
    # ═══════════════════════════════════════════════════════════════════

    def compute_indicators(self, df: pd.DataFrame) -> pd.DataFrame:
        p = self.p
        c = df["close"]
        h = df["high"]
        l = df["low"]
        v = df["volume"]

        # ── ATR ──
        df["atr"] = ind.atr(h, l, c, p["atr_period"])

        # ── EMA trend ──
        df["ema"] = ind.ema(c, p["ema_period"])

        # ── EMA slope: normalised change over N bars ──
        lb = p["ema_slope_lookback"]
        ema_shift = df["ema"].shift(lb)
        df["ema_slope"] = (df["ema"] - ema_shift) / ema_shift.replace(0, np.nan)
        df["ema_slope"] = df["ema_slope"].fillna(0)

        # ── Volume MA ──
        vp = p["vol_period"]
        df["vol_ma"] = v.rolling(vp, min_periods=vp).mean()

        # ── Candle body ratio (body / total range) ──
        candle_range = h - l
        body = (c - df["open"]).abs()
        df["body_ratio"] = (body / candle_range.replace(0, np.nan)).fillna(0)

        # ── Consolidation: price range over window / ATR ──
        cw = p["consol_window"]
        rolling_high = h.rolling(cw, min_periods=cw).max()
        rolling_low = l.rolling(cw, min_periods=cw).min()
        consol_range = rolling_high - rolling_low
        df["consol_ratio"] = consol_range / df["atr"].replace(0, np.nan)
        df["consol_ratio"] = df["consol_ratio"].fillna(999)

        # ── Base candle detection ──
        # Volume spike + strong body + within consolidation phase
        vol_ok = v > (df["vol_ma"] * p["vol_multiplier"])
        body_ok = df["body_ratio"] >= p["body_ratio_min"]
        consol_ok = df["consol_ratio"] <= p["consol_range_atr_mult"]
        df["is_base"] = (vol_ok & body_ok & consol_ok).astype(int)

        # ── Base candle high/low (forward-fill until next base) ──
        df["base_high"] = np.nan
        df["base_low"] = np.nan
        df["base_bar_idx"] = np.nan

        base_mask = df["is_base"] == 1
        df.loc[base_mask, "base_high"] = h[base_mask]
        df.loc[base_mask, "base_low"] = l[base_mask]
        df.loc[base_mask, "base_bar_idx"] = np.arange(len(df))[base_mask.values]

        df["base_high"] = df["base_high"].ffill()
        df["base_low"] = df["base_low"].ffill()
        df["base_bar_idx"] = df["base_bar_idx"].ffill()

        return df

    # ═══════════════════════════════════════════════════════════════════
    # Signal Generation
    # ═══════════════════════════════════════════════════════════════════

    def generate_signals(
        self, df: pd.DataFrame, disabled: set[str] | None = None,
    ) -> pd.Series:
        """
        +1 = LONG breakout, -1 = SHORT breakout, 0 = no signal.
        Signals at bar[i] → entry at bar[i+1] open (no lookahead).
        """
        p = self.p
        off = disabled or set()
        n = len(df)
        signals = pd.Series(0, index=df.index)

        c = df["close"].values
        h = df["high"].values
        l = df["low"].values
        o = df["open"].values
        ema_val = df["ema"].values
        ema_slope = df["ema_slope"].values
        base_high = df["base_high"].values
        base_low = df["base_low"].values
        base_idx = df["base_bar_idx"].values
        atr_val = df["atr"].values
        body_r = df["body_ratio"].values

        ema_slope_min = p["ema_slope_min"]
        near_pct = p["close_near_extreme_pct"]
        cooldown = p["cooldown_bars"]

        last_signal_bar = -cooldown - 1

        for i in range(1, n):
            # Cooldown
            if i - last_signal_bar <= cooldown:
                continue

            # Must have a valid base candle (not the base bar itself)
            if np.isnan(base_high[i]) or np.isnan(base_idx[i]):
                continue
            # Don't enter on the base candle itself
            if int(base_idx[i]) == i:
                continue

            bar_range = h[i] - l[i]
            if bar_range <= 0:
                continue

            # ── LONG: close breaks above base_high ──
            if c[i] > base_high[i]:
                reject = False
                # Trend filter: close > EMA
                if "ema_trend" not in off and c[i] <= ema_val[i]:
                    reject = True
                # Flat EMA filter
                if "ema_flat" not in off and abs(ema_slope[i]) < ema_slope_min:
                    reject = True
                # Close near high of breakout candle
                if "close_near_extreme" not in off and (h[i] - c[i]) / bar_range > near_pct:
                    reject = True

                if not reject:
                    signals.iloc[i] = 1
                    last_signal_bar = i
                    continue

            # ── SHORT: close breaks below base_low ──
            if c[i] < base_low[i]:
                reject = False
                # Trend filter: close < EMA
                if "ema_trend" not in off and c[i] >= ema_val[i]:
                    reject = True
                # Flat EMA filter
                if "ema_flat" not in off and abs(ema_slope[i]) < ema_slope_min:
                    reject = True
                # Close near low of breakout candle
                if "close_near_extreme" not in off and (c[i] - l[i]) / bar_range > near_pct:
                    reject = True

                if not reject:
                    signals.iloc[i] = -1
                    last_signal_bar = i

        return signals
