"""
Volume-Price Breakout v2 — High Win-Rate Edition
===================================================
Enhanced strategy targeting ≥75% win rate via:

  1. Triple EMA alignment: EMA28 > EMA50 > EMA100 (long-only)
  2. Consecutive volume ramp: 2-3 bars of increasing volume
  3. Two-step breakout: skip first breakout, wait for pullback
     to base_high, confirm support, enter on second breakout
  4. Strong breakout candle: body > 0.6×ATR, close in top 25%
  5. Session filter: skip first/last 30 min of US market
  6. SL = pullback low, TP = 1.5R–2R (favour win rate over RR)
  7. Long-only in this version (shorts had 30% WR in v1)
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from strategies.futures import indicators as ind


# ═══════════════════════════════════════════════════════════════════════
# Default v2 Parameters
# ═══════════════════════════════════════════════════════════════════════

DEFAULT_VPB2_PARAMS: dict = {
    # ── Triple EMA trend ──
    "ema_fast": 28,
    "ema_mid": 50,
    "ema_slow": 100,
    "ema_slope_lookback": 5,
    "ema_slope_min": 0.0005,          # min slope (avoid flat)

    # ── ATR ──
    "atr_period": 14,

    # ── Consolidation ──
    "consol_window": 15,
    "consol_range_atr_mult": 5.0,

    # ── Base candle ──
    "vol_period": 20,
    "vol_multiplier": 1.2,
    "body_ratio_min": 0.60,

    # ── Volume ramp: N consecutive increasing volume bars (0 = disabled) ──
    "vol_ramp_bars": 0,               # 0 = disabled; use vol_spike only

    # ── Two-step breakout ──
    "require_retest": True,           # require pullback retest before entry
    "retest_max_bars": 10,            # max bars to wait for pullback
    "retest_tolerance_atr": 1.0,      # pullback low must be within X×ATR of base_high

    # ── Breakout candle strength ──
    "body_atr_min": 0.3,             # body > 0.3 × ATR
    "close_near_high_pct": 0.40,     # close must be in top 40% of range

    # ── Session filter ──
    "use_session_filter": True,
    "session_skip_first_min": 15,     # skip first 15 min
    "session_skip_last_min": 15,      # skip last 15 min

    # ── Risk management ──
    "tp_r_multiple": 1.0,            # 1R TP for higher WR
    "atr_sl_mult": 1.0,              # fallback min SL distance
    "use_atr_tp": False,
    "atr_tp_mult": 2.0,

    # ── Trailing / Breakeven ──
    "use_breakeven": True,
    "be_atr_mult": 0.8,
    "be_offset_atr": 0.1,
    "use_trailing": True,
    "trailing_atr_mult": 1.0,

    # ── Direction ──
    "long_only": True,                # shorts had very poor WR in v1

    # ── Cooldown ──
    "cooldown_bars": 5,
}


class VPBv2Strategy:
    """Enhanced Volume-Price Breakout — high win-rate edition."""

    def __init__(self, params: dict | None = None):
        self.p = {**DEFAULT_VPB2_PARAMS, **(params or {})}

    # ═══════════════════════════════════════════════════════════════════
    # Indicators
    # ═══════════════════════════════════════════════════════════════════

    def compute_indicators(self, df: pd.DataFrame) -> pd.DataFrame:
        p = self.p
        c = df["close"]
        h = df["high"]
        l_ = df["low"]
        o = df["open"]
        v = df["volume"]

        # ── ATR ──
        df["atr"] = ind.atr(h, l_, c, p["atr_period"])

        # ── Triple EMA ──
        df["ema_fast"] = ind.ema(c, p["ema_fast"])
        df["ema_mid"] = ind.ema(c, p["ema_mid"])
        df["ema_slow"] = ind.ema(c, p["ema_slow"])

        # ── EMA slope (fast) ──
        lb = p["ema_slope_lookback"]
        ema_shift = df["ema_fast"].shift(lb)
        df["ema_slope"] = ((df["ema_fast"] - ema_shift) / ema_shift.replace(0, np.nan)).fillna(0)

        # ── Volume MA + ramp ──
        vp = p["vol_period"]
        df["vol_ma"] = v.rolling(vp, min_periods=vp).mean()

        # Consecutive increasing volume bars
        ramp_n = p["vol_ramp_bars"]
        vol_inc = (v > v.shift(1)).astype(int)
        df["vol_ramp"] = vol_inc.rolling(ramp_n, min_periods=ramp_n).sum()

        # ── Candle metrics ──
        candle_range = h - l_
        body = (c - o).abs()
        df["body_ratio"] = (body / candle_range.replace(0, np.nan)).fillna(0)
        df["body_atr_ratio"] = (body / df["atr"].replace(0, np.nan)).fillna(0)

        # Close position within candle (0 = at low, 1 = at high)
        df["close_position"] = ((c - l_) / candle_range.replace(0, np.nan)).fillna(0.5)

        # ── Consolidation ──
        cw = p["consol_window"]
        rolling_high = h.rolling(cw, min_periods=cw).max()
        rolling_low = l_.rolling(cw, min_periods=cw).min()
        consol_range = rolling_high - rolling_low
        df["consol_ratio"] = (consol_range / df["atr"].replace(0, np.nan)).fillna(999)

        # ── Base candle detection ──
        vol_ok = v > (df["vol_ma"] * p["vol_multiplier"])
        body_ok = df["body_ratio"] >= p["body_ratio_min"]
        consol_ok = df["consol_ratio"] <= p["consol_range_atr_mult"]
        df["is_base"] = (vol_ok & body_ok & consol_ok).astype(int)

        # Forward-fill base high/low
        df["base_high"] = np.nan
        df["base_low"] = np.nan
        df["base_bar_idx"] = np.nan

        base_mask = df["is_base"] == 1
        df.loc[base_mask, "base_high"] = h[base_mask]
        df.loc[base_mask, "base_low"] = l_[base_mask]
        df.loc[base_mask, "base_bar_idx"] = np.arange(len(df))[base_mask.values]

        df["base_high"] = df["base_high"].ffill()
        df["base_low"] = df["base_low"].ffill()
        df["base_bar_idx"] = df["base_bar_idx"].ffill()

        # ── Session filter columns ──
        if p["use_session_filter"] and hasattr(df.index, "hour"):
            # US market: 09:30–16:00 ET
            # Skip first N min and last N min
            skip_first = p["session_skip_first_min"]
            skip_last = p["session_skip_last_min"]
            bar_hour = df.index.hour
            bar_min = df.index.minute
            bar_total_min = bar_hour * 60 + bar_min
            # 09:30 = 570, 16:00 = 960
            market_open = 9 * 60 + 30   # 570
            market_close = 16 * 60       # 960
            ok_start = market_open + skip_first
            ok_end = market_close - skip_last
            df["in_session"] = ((bar_total_min >= ok_start) & (bar_total_min < ok_end)).astype(int)
        else:
            df["in_session"] = 1

        return df

    # ═══════════════════════════════════════════════════════════════════
    # Signal Generation — Two-Step Breakout
    # ═══════════════════════════════════════════════════════════════════

    def generate_signals(
        self, df: pd.DataFrame, disabled: set[str] | None = None,
    ) -> pd.Series:
        """
        +1 = LONG (two-step confirmed breakout), 0 = no signal.
        -1 = SHORT (only if long_only=False).
        """
        p = self.p
        off = disabled or set()
        n = len(df)
        signals = pd.Series(0, index=df.index)

        c = df["close"].values
        h = df["high"].values
        l_ = df["low"].values
        o = df["open"].values
        ema_f = df["ema_fast"].values
        ema_m = df["ema_mid"].values
        ema_s = df["ema_slow"].values
        ema_slope = df["ema_slope"].values
        base_high = df["base_high"].values
        base_low = df["base_low"].values
        base_idx = df["base_bar_idx"].values
        atr_val = df["atr"].values
        vol = df["volume"].values
        vol_ma = df["vol_ma"].values
        vol_ramp = df["vol_ramp"].values
        body_atr = df["body_atr_ratio"].values
        close_pos = df["close_position"].values
        in_session = df["in_session"].values

        ema_slope_min = p["ema_slope_min"]
        body_atr_min = p["body_atr_min"]
        close_hi_pct = p["close_near_high_pct"]
        ramp_n = p["vol_ramp_bars"]
        cooldown = p["cooldown_bars"]
        require_retest = p.get("require_retest", True)
        retest_max = p.get("retest_max_bars", 10)
        retest_tol = p.get("retest_tolerance_atr", 0.3)
        long_only = p.get("long_only", True)
        vol_mult = p["vol_multiplier"]

        last_signal_bar = -cooldown - 1

        # ── State machine for two-step breakout ──
        # Phase 0: waiting for first breakout
        # Phase 1: first breakout seen, waiting for pullback to base_high
        # Phase 2: pullback confirmed, waiting for second breakout
        phase = 0
        phase_base_high = 0.0
        phase_base_low = 0.0
        phase_pullback_low = 0.0
        phase_start_bar = 0
        phase_direction = 0  # 1=long, -1=short

        for i in range(1, n):
            # Cooldown after signal
            if i - last_signal_bar <= cooldown:
                phase = 0
                continue

            # Need valid base
            if np.isnan(base_high[i]) or np.isnan(base_idx[i]):
                continue
            if int(base_idx[i]) == i:
                continue

            # Base changed → reset state machine
            cur_base_idx = int(base_idx[i])
            if phase > 0 and cur_base_idx != int(base_idx[phase_start_bar]) if phase_start_bar < n else True:
                phase = 0

            # ── PHASE 0: look for first breakout ──
            if phase == 0:
                # LONG first breakout
                if c[i] > base_high[i]:
                    if not require_retest:
                        # Direct entry (no retest required) — apply all filters
                        if self._check_long_filters(
                            i, c, h, l_, o, ema_f, ema_m, ema_s, ema_slope,
                            atr_val, vol, vol_ma, vol_ramp, body_atr,
                            close_pos, in_session, off, p
                        ):
                            signals.iloc[i] = 1
                            last_signal_bar = i
                        continue

                    # Two-step: record first breakout, move to phase 1
                    phase = 1
                    phase_direction = 1
                    phase_base_high = base_high[i]
                    phase_base_low = base_low[i]
                    phase_pullback_low = l_[i]
                    phase_start_bar = i
                    continue

                # SHORT first breakout (if enabled)
                if not long_only and c[i] < base_low[i]:
                    if not require_retest:
                        if self._check_short_filters(
                            i, c, h, l_, o, ema_f, ema_m, ema_s, ema_slope,
                            atr_val, vol, vol_ma, vol_ramp, body_atr,
                            close_pos, in_session, off, p
                        ):
                            signals.iloc[i] = -1
                            last_signal_bar = i
                        continue

                    phase = 1
                    phase_direction = -1
                    phase_base_high = base_high[i]
                    phase_base_low = base_low[i]
                    phase_pullback_low = h[i]  # for short, track high
                    phase_start_bar = i
                    continue

            # ── PHASE 1: waiting for pullback to base level ──
            elif phase == 1:
                bars_since = i - phase_start_bar
                if bars_since > retest_max:
                    phase = 0
                    continue

                if phase_direction == 1:
                    # Track pullback low
                    if l_[i] < phase_pullback_low:
                        phase_pullback_low = l_[i]

                    # Pullback condition: price pulled back near base_high
                    tolerance = retest_tol * atr_val[i] if atr_val[i] > 0 else 0
                    pulled_back = l_[i] <= phase_base_high + tolerance

                    # Support held: didn't close below base_low
                    support_held = c[i] >= phase_base_low

                    if pulled_back and support_held:
                        phase = 2
                        continue
                else:
                    # Short pullback
                    if h[i] > phase_pullback_low:
                        phase_pullback_low = h[i]

                    tolerance = retest_tol * atr_val[i] if atr_val[i] > 0 else 0
                    pulled_back = h[i] >= phase_base_low - tolerance
                    support_held = c[i] <= phase_base_high

                    if pulled_back and support_held:
                        phase = 2
                        continue

            # ── PHASE 2: waiting for second breakout ──
            elif phase == 2:
                bars_since = i - phase_start_bar
                if bars_since > retest_max * 2:
                    phase = 0
                    continue

                if phase_direction == 1 and c[i] > phase_base_high:
                    # Second breakout — lighter filters (vol/body already
                    # validated on the base candle in Phase 0)
                    if self._check_retest_entry_long(
                        i, c, o, ema_f, ema_m, ema_s, ema_slope,
                        in_session, off, p
                    ):
                        signals.iloc[i] = 1
                        last_signal_bar = i
                        phase = 0
                        continue
                    phase = 0
                    continue

                elif phase_direction == -1 and c[i] < phase_base_low:
                    if self._check_retest_entry_short(
                        i, c, o, ema_f, ema_m, ema_s, ema_slope,
                        in_session, off, p
                    ):
                        signals.iloc[i] = -1
                        last_signal_bar = i
                        phase = 0
                        continue
                    phase = 0
                    continue

        # ── Store pullback low for backtester SL computation ──
        # We need a second pass to mark pullback_low for each signal bar
        df["pullback_low"] = np.nan
        df["pullback_high"] = np.nan
        self._compute_pullback_levels(df, signals)

        return signals

    def _compute_pullback_levels(self, df: pd.DataFrame, signals: pd.Series) -> None:
        """For each signal bar, look back to find the pullback low/high."""
        h = df["high"].values
        l_ = df["low"].values
        base_high = df["base_high"].values
        n = len(df)
        retest_max = self.p.get("retest_max_bars", 10) * 2

        for i in range(n):
            if signals.iloc[i] == 1:
                # Look back to find pullback low since the base
                lookback = min(i, retest_max + 5)
                pb_low = l_[i]
                for j in range(i - 1, max(i - lookback, 0) - 1, -1):
                    if l_[j] < pb_low:
                        pb_low = l_[j]
                    # Stop at the base candle
                    if not np.isnan(base_high[j]) and h[j] >= base_high[i]:
                        break
                df.iloc[i, df.columns.get_loc("pullback_low")] = pb_low
            elif signals.iloc[i] == -1:
                lookback = min(i, retest_max + 5)
                pb_high = h[i]
                for j in range(i - 1, max(i - lookback, 0) - 1, -1):
                    if h[j] > pb_high:
                        pb_high = h[j]
                    if not np.isnan(base_high[j]):
                        break
                df.iloc[i, df.columns.get_loc("pullback_high")] = pb_high

    @staticmethod
    def _check_long_filters(
        i, c, h, l_, o, ema_f, ema_m, ema_s, ema_slope,
        atr_val, vol, vol_ma, vol_ramp, body_atr,
        close_pos, in_session, off, p,
    ) -> bool:
        """Check all quality filters for a LONG signal."""
        # 1. Triple EMA alignment: fast > mid > slow
        if "ema_alignment" not in off:
            if not (ema_f[i] > ema_m[i] > ema_s[i]):
                return False

        # 2. EMA slope positive (not flat)
        if "ema_slope" not in off:
            if ema_slope[i] < p["ema_slope_min"]:
                return False

        # 3. Close above EMA fast
        if "ema_trend" not in off:
            if c[i] <= ema_f[i]:
                return False

        # 4. Volume ramp: N consecutive increasing bars (skip if 0)
        if "vol_ramp" not in off:
            ramp_n = p["vol_ramp_bars"]
            if ramp_n > 0 and vol_ramp[i] < ramp_n:
                return False

        # 5. Breakout volume is highest (above vol MA × multiplier)
        if "vol_spike" not in off:
            if vol[i] <= vol_ma[i] * p["vol_multiplier"]:
                return False

        # 6. Strong candle body: body > body_atr_min × ATR
        if "body_strength" not in off:
            if body_atr[i] < p["body_atr_min"]:
                return False

        # 7. Close near high (top X%)
        if "close_near_high" not in off:
            if close_pos[i] < (1.0 - p["close_near_high_pct"]):
                return False

        # 8. Bullish candle (close > open)
        if "bullish_candle" not in off:
            if c[i] <= o[i]:
                return False

        # 9. Session filter
        if "session" not in off:
            if in_session[i] == 0:
                return False

        return True

    @staticmethod
    def _check_short_filters(
        i, c, h, l_, o, ema_f, ema_m, ema_s, ema_slope,
        atr_val, vol, vol_ma, vol_ramp, body_atr,
        close_pos, in_session, off, p,
    ) -> bool:
        """Check all quality filters for a SHORT signal."""
        if "ema_alignment" not in off:
            if not (ema_f[i] < ema_m[i] < ema_s[i]):
                return False
        if "ema_slope" not in off:
            if ema_slope[i] > -p["ema_slope_min"]:
                return False
        if "ema_trend" not in off:
            if c[i] >= ema_f[i]:
                return False
        if "vol_ramp" not in off:
            ramp_n = p["vol_ramp_bars"]
            if ramp_n > 0 and vol_ramp[i] < ramp_n:
                return False
        if "vol_spike" not in off:
            if vol[i] <= vol_ma[i] * p["vol_multiplier"]:
                return False
        if "body_strength" not in off:
            if body_atr[i] < p["body_atr_min"]:
                return False
        if "close_near_high" not in off:
            if close_pos[i] > p["close_near_high_pct"]:
                return False
        if "bullish_candle" not in off:
            if c[i] >= o[i]:
                return False
        if "session" not in off:
            if in_session[i] == 0:
                return False
        return True

    # ── Lighter filters for Phase-2 retest entry ────────────────────
    # Vol/body quality was already validated on the base candle.
    # Here we only need trend direction + bullish candle + session.

    @staticmethod
    def _check_retest_entry_long(i, c, o, ema_f, ema_m, ema_s, ema_slope,
                                  in_session, off, p) -> bool:
        if "ema_alignment" not in off:
            if not (ema_f[i] > ema_m[i] > ema_s[i]):
                return False
        if "ema_slope" not in off:
            if ema_slope[i] < p["ema_slope_min"]:
                return False
        if "ema_trend" not in off:
            if c[i] <= ema_f[i]:
                return False
        if "bullish_candle" not in off:
            if c[i] <= o[i]:
                return False
        if "session" not in off:
            if in_session[i] == 0:
                return False
        return True

    @staticmethod
    def _check_retest_entry_short(i, c, o, ema_f, ema_m, ema_s, ema_slope,
                                   in_session, off, p) -> bool:
        if "ema_alignment" not in off:
            if not (ema_f[i] < ema_m[i] < ema_s[i]):
                return False
        if "ema_slope" not in off:
            if ema_slope[i] > -p["ema_slope_min"]:
                return False
        if "ema_trend" not in off:
            if c[i] >= ema_f[i]:
                return False
        if "bullish_candle" not in off:
            if c[i] >= o[i]:
                return False
        if "session" not in off:
            if in_session[i] == 0:
                return False
        return True
