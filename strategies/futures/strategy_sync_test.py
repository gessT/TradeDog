"""
SYNC TEST Strategy
==================
NOT for profit. Used ONLY for system validation.

PURPOSE:
  Validate timing accuracy of the execution engine and confirm that
  paper trading and live trading systems are correctly synchronized.

BEHAVIOR:
  1. ENTRY  — Open a trade on every 5-minute candle close (periodic entry).
              Direction is fixed per run: LONG, SHORT, or alternating.
  2. EXIT   — Close after exactly `hold_bars` candles (default 2 = 10 min).
              No SL/TP, no early exit.
  3. STACK  — Only 1 position at a time. Next entry only after close.

EXPECTED RESULT:
  Every entry occurs on a 5-min cycle.
  Every exit occurs after exactly 10 min holding.
  Paper and live results must match 1:1.
"""
from __future__ import annotations

import pandas as pd

DEFAULT_SYNC_PARAMS: dict = {
    # How many bars to hold before force-exit  (default 2 × 5m = 10 min)
    "hold_bars": 2,
    # Direction: "long" | "short" | "alternate"
    "direction": "long",
    # Skip first N bars to allow indicators to warm up (none needed here)
    "warmup_bars": 0,
}


class SyncTestStrategy:
    """
    Generates a periodic entry signal every bar (subject to hold cooldown).
    Signals encode direction: +1 = LONG entry, -1 = SHORT entry, 0 = flat.
    """

    def __init__(self, params: dict | None = None) -> None:
        self.params = {**DEFAULT_SYNC_PARAMS, **(params or {})}

    # ------------------------------------------------------------------
    def compute_indicators(self, df_5m: pd.DataFrame) -> pd.DataFrame:
        """No indicators needed — returns the raw OHLCV frame unchanged."""
        return df_5m.copy()

    # ------------------------------------------------------------------
    def generate_signals(self, df_ind: pd.DataFrame) -> pd.Series:
        """
        Return a Series of:
          +1  → LONG entry
          -1  → SHORT entry
           0  → no action

        Entry fires on every bar that is not within the hold window of the
        previous entry, respecting the single-position rule.
        """
        p         = self.params
        hold      = int(p["hold_bars"])
        direction = str(p["direction"]).lower()
        warmup    = int(p["warmup_bars"])
        n         = len(df_ind)

        arr       = [0] * n
        last_entry_bar = -(hold + 1)
        trade_count    = 0

        for i in range(warmup, n):
            # Only enter if previous position is closed (hold elapsed)
            if i - last_entry_bar <= hold:
                continue

            # Determine direction for this trade
            if direction == "long":
                sig = 1
            elif direction == "short":
                sig = -1
            else:  # alternate: even trades LONG, odd trades SHORT
                sig = 1 if trade_count % 2 == 0 else -1

            arr[i] = sig
            last_entry_bar = i
            trade_count += 1

        return pd.Series(arr, index=df_ind.index, name="signal")
