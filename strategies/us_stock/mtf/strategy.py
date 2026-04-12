"""
MTF Strategy — Signal Generation
==================================
Multi-timeframe, LONG-only, mid-to-long-term.

Daily bar   → trend filter (SuperTrend + HalfTrend + SMA)
4H bar      → entry signal (EMA cross/pullback + RSI + bullish candle)

Entry logic (all on PREVIOUS bar to avoid repaint):
  1. Daily SuperTrend = bullish  (+1)
  2. Daily HalfTrend  = up       (0)
  3. Daily Close > SMA(50)
  4. HT Re-confirm — when HT just flipped back to up, wait for daily
     bullish candle (close > open) before re-entering
  5. 4H EMA fast > EMA slow  (trend aligned)
  6. 4H RSI in [40, 70]      (not overbought)
  7. 4H bullish candle        (close > open)

Each condition can be individually disabled from the frontend.
"""
from __future__ import annotations

import pandas as pd

from .config import DEFAULT_MTF_PARAMS
from .indicators import ema, sma, rsi, atr, supertrend, halftrend


class MTFStrategy:
    """Multi-timeframe strategy: Daily trend + 4H entry."""

    DISABLEABLE = {
        "st_trend",        # Daily SuperTrend must be bullish
        "ht_trend",        # Daily HalfTrend must be up
        "ht_reconfirm",    # After HT flips back up, require daily bullish candle
        "sma_trend",       # Daily close > SMA
        "ema_alignment",   # 4H EMA fast > EMA slow
        "rsi_filter",      # 4H RSI in buy zone
        "bullish_candle",  # 4H close > open
    }

    def __init__(self, params: dict | None = None):
        self.p = {**DEFAULT_MTF_PARAMS, **(params or {})}

    # ── Daily indicators ──────────────────────────────────────────────

    def compute_daily(self, df_d: pd.DataFrame) -> pd.DataFrame:
        """Add trend indicators to daily DataFrame.

        Columns added: st_line, st_dir, ht_line, ht_dir, sma_slow
        """
        p = self.p
        df_d = df_d.copy()

        st_line, st_dir = supertrend(
            df_d["high"], df_d["low"], df_d["close"],
            period=p["st_period"], multiplier=p["st_mult"],
        )
        df_d["st_line"] = st_line
        df_d["st_dir"] = st_dir

        ht_line, ht_dir, ht_high, ht_low = halftrend(
            df_d["high"], df_d["low"], df_d["close"],
            amplitude=p["ht_amplitude"],
            channel_deviation=p["ht_channel_dev"],
            atr_length=p["ht_atr_length"],
        )
        df_d["ht_line"] = ht_line
        df_d["ht_dir"] = ht_dir
        df_d["ht_high"] = ht_high
        df_d["ht_low"] = ht_low

        df_d["sma_slow"] = sma(df_d["close"], p["sma_slow"])

        # HT previous direction (for detecting fresh flip back to uptrend)
        df_d["ht_dir_prev"] = df_d["ht_dir"].shift(1)
        # Daily bullish candle flag
        df_d["d_bullish"] = (df_d["close"] > df_d["open"]).astype(int)

        return df_d

    # ── 4H indicators ────────────────────────────────────────────────

    def compute_4h(self, df_4h: pd.DataFrame) -> pd.DataFrame:
        """Add entry indicators to 4H DataFrame.

        Columns added: ema_fast, ema_slow, rsi, atr
        """
        p = self.p
        df_4h = df_4h.copy()

        df_4h["ema_fast"] = ema(df_4h["close"], p["ema_fast"])
        df_4h["ema_slow"] = ema(df_4h["close"], p["ema_slow"])
        df_4h["rsi"] = rsi(df_4h["close"], p["rsi_period"])
        df_4h["atr"] = atr(df_4h["high"], df_4h["low"], df_4h["close"], p["atr_period"])

        return df_4h

    # ── Merge daily trend into 4H ─────────────────────────────────

    @staticmethod
    def merge_daily_into_4h(
        df_4h: pd.DataFrame,
        df_d: pd.DataFrame,
    ) -> pd.DataFrame:
        """Forward-fill daily columns (st_dir, ht_dir, sma_slow, st_line,
        ht_line) into 4H rows.  Uses the PREVIOUS completed daily bar
        to prevent look-ahead bias.
        """
        daily_cols = ["st_dir", "ht_dir", "sma_slow", "st_line", "ht_line",
                      "ht_dir_prev", "d_bullish"]
        available = [c for c in daily_cols if c in df_d.columns]

        # Shift daily by 1 so we use yesterday's values (no look-ahead)
        daily_shifted = df_d[available].shift(1)

        # Reindex to 4H timestamps with forward-fill
        daily_reindexed = daily_shifted.reindex(df_4h.index, method="ffill")
        for col in available:
            df_4h[f"d_{col}"] = daily_reindexed[col]

        # Also bring daily close for SMA comparison
        daily_close_shifted = df_d["close"].shift(1)
        df_4h["d_close"] = daily_close_shifted.reindex(df_4h.index, method="ffill")

        return df_4h

    # ── Signal generation ─────────────────────────────────────────

    def generate_signals(
        self,
        df_4h: pd.DataFrame,
        disabled: set[str] | None = None,
    ) -> pd.Series:
        """Generate entry signals on 4H bars.

        Returns Series: +1 = LONG entry, 0 = no signal.
        Uses PREVIOUS bar's values to avoid repainting.
        """
        p = self.p
        off = disabled or set()
        n = len(df_4h)
        signal = pd.Series(0, index=df_4h.index, dtype=int)

        for i in range(1, n):
            prev = df_4h.iloc[i - 1]

            # ── Daily filters (from merged columns) ──

            if "st_trend" not in off:
                d_st = prev.get("d_st_dir")
                if pd.isna(d_st) or int(d_st) != 1:  # +1 = bullish
                    continue

            if "ht_trend" not in off:
                d_ht = prev.get("d_ht_dir")
                if pd.isna(d_ht) or int(d_ht) != 0:  # 0 = up
                    continue

            if "sma_trend" not in off:
                d_close = prev.get("d_close")
                d_sma = prev.get("d_sma_slow")
                if pd.isna(d_close) or pd.isna(d_sma) or d_close <= d_sma:
                    continue

            # ── HT re-confirmation after flip ──
            # When HT just flipped back to uptrend (prev was down → now up),
            # require the daily candle to also be bullish before re-entering
            if "ht_reconfirm" not in off:
                d_ht = prev.get("d_ht_dir")
                d_ht_prev = prev.get("d_ht_dir_prev")
                if (not pd.isna(d_ht) and not pd.isna(d_ht_prev)
                        and int(d_ht) == 0 and int(d_ht_prev) == 1):
                    # Fresh flip — require daily bullish candle
                    d_bull = prev.get("d_d_bullish")
                    if pd.isna(d_bull) or int(d_bull) != 1:
                        continue

            # ── 4H entry filters ──

            if "ema_alignment" not in off:
                ef = prev.get("ema_fast")
                es = prev.get("ema_slow")
                if pd.isna(ef) or pd.isna(es) or ef <= es:
                    continue

            if "rsi_filter" not in off:
                r = prev.get("rsi")
                if pd.isna(r) or r < p["rsi_low"] or r > p["rsi_high"]:
                    continue

            if "bullish_candle" not in off:
                if prev["close"] <= prev["open"]:
                    continue

            signal.iloc[i] = 1

        return signal
