"""
TPC Strategy — Weekly SuperTrend Trend Following
===================================================
Single condition: Weekly SuperTrend direction.

  Buy  → Weekly SuperTrend flips to bullish (+1)
  Sell → Weekly SuperTrend flips to bearish (-1)

One trade per SuperTrend cycle. No other filters.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from .config import DEFAULT_TPC_PARAMS
from .indicators import ema, rsi, atr, supertrend, halftrend


class TPCStrategy:
    """Weekly SuperTrend trend-following strategy."""

    DISABLEABLE: set[str] = {
        "w_st_trend",       # Weekly SuperTrend must be bullish
        "ht_trend",         # 1H HalfTrend must be bullish (up)
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
    # 1H indicators (for chart display + ATR-based SL)
    # ═══════════════════════════════════════════════════════

    def compute_1h(self, df_1h: pd.DataFrame) -> pd.DataFrame:
        """Add EMA, RSI, ATR to 1H bars for chart + risk management."""
        p = self.p
        df_1h = df_1h.copy()
        df_1h["h_ema_fast"] = ema(df_1h["close"], p["h_ema_fast"])
        df_1h["h_ema_slow"] = ema(df_1h["close"], p["h_ema_slow"])
        df_1h["h_rsi"] = rsi(df_1h["close"], p["h_rsi_period"])
        df_1h["h_atr"] = atr(df_1h["high"], df_1h["low"], df_1h["close"], p["h_atr_period"])
        return df_1h

    # ═══════════════════════════════════════════════════════
    # Daily HalfTrend (matches PineScript — HT on daily bars)
    # ═══════════════════════════════════════════════════════

    def compute_daily(self, df_d: pd.DataFrame) -> pd.DataFrame:
        """Compute HalfTrend on daily OHLCV — matches TradingView."""
        p = self.p
        df_d = df_d.copy()
        ht_line, ht_dir, ht_high, ht_low = halftrend(
            df_d["high"], df_d["low"], df_d["close"],
            amplitude=p["ht_amplitude"],
            channel_deviation=p["ht_channel_deviation"],
            atr_length=100,
        )
        df_d["ht_line"] = ht_line
        df_d["ht_dir"] = ht_dir
        df_d["ht_high"] = ht_high
        df_d["ht_low"] = ht_low
        return df_d

    @staticmethod
    def merge_daily_into_1h(df_1h: pd.DataFrame, df_d: pd.DataFrame) -> pd.DataFrame:
        """Forward-fill daily HalfTrend into 1H bars."""
        daily_cols = ["ht_line", "ht_dir", "ht_high", "ht_low"]
        available = [c for c in daily_cols if c in df_d.columns]
        daily_reindexed = df_d[available].reindex(df_1h.index, method="ffill")
        for col in available:
            df_1h[col] = daily_reindexed[col]
        return df_1h

    # ═══════════════════════════════════════════════════════
    # Merge weekly data into 1H
    # ═══════════════════════════════════════════════════════

    @staticmethod
    def merge_weekly_into_1h(df_1h: pd.DataFrame, df_w: pd.DataFrame) -> pd.DataFrame:
        """Forward-fill weekly SuperTrend into 1H bars.

        Uses CURRENT weekly bar (matches PineScript lookahead=barmerge.lookahead_on).
        """
        weekly_cols = ["w_st_dir", "w_st_line"]
        available = [c for c in weekly_cols if c in df_w.columns]

        # No shift — use current week's live value (like PineScript lookahead_on)
        weekly_reindexed = df_w[available].reindex(df_1h.index, method="ffill")
        for col in available:
            df_1h[col] = weekly_reindexed[col]

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

        Matches PineScript logic:
          [st30, dir30] = request.security(syminfo.tickerid, "W", f_supertrend(factor, atrPeriod), lookahead=barmerge.lookahead_on)
          bigTrendFlipUp   = dir30[1] == 1 and dir30 == -1   (bearish → bullish)
          bigTrendFlipDown = dir30[1] == -1 and dir30 == 1   (bullish → bearish)

        PineScript dir: -1 = bullish, +1 = bearish  (inverted from our Python convention)
        Python dir:     +1 = bullish, -1 = bearish

        Returns Series: +1 = LONG entry (bigTrendFlipUp), 0 = no signal.
        """
        off = disabled or set()
        n = len(df)
        signals = pd.Series(0, index=df.index)

        w_st_dir = df["w_st_dir"].values if "w_st_dir" in df else np.ones(n)
        ht_dir = df["ht_dir"].values if "ht_dir" in df else np.zeros(n)
        ht_line = df["ht_line"].values if "ht_line" in df else np.full(n, np.nan)
        closes = df["close"].values
        h_atr = df["h_atr"].values if "h_atr" in df else np.ones(n)
        ht_price_gap = self.p.get("ht_price_gap", 10.0)

        prev_w_st = -1  # Start as bearish so first bullish flip triggers
        in_position = False

        for i in range(1, n):
            cur_st = w_st_dir[i]
            if np.isnan(cur_st):
                continue

            cur_st = int(cur_st)

            # bigTrendFlipDown: bullish(+1) → bearish(-1) → close position
            if cur_st == -1:
                in_position = False
                prev_w_st = cur_st
                continue

            # bigTrendFlipUp: bearish(-1) → bullish(+1) → open LONG
            if "w_st_trend" not in off:
                if cur_st == 1 and prev_w_st != 1 and not in_position:
                    if not np.isnan(h_atr[i]) and h_atr[i] > 0:
                        # HalfTrend filter: 1H HT must be bullish (dir=0) + within price gap
                        if "ht_trend" not in off:
                            if ht_dir[i] != 0:
                                prev_w_st = cur_st
                                continue
                            if not np.isnan(ht_line[i]) and abs(closes[i] - ht_line[i]) > ht_price_gap:
                                prev_w_st = cur_st
                                continue
                        signals.iloc[i] = 1
                        in_position = True

            prev_w_st = cur_st

        return signals
