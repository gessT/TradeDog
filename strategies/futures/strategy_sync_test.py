"""
SYNC TEST Strategy
==================
NOT for profit. Used ONLY for system validation.

PURPOSE:
  Validate timing accuracy of the execution engine and confirm that
  paper trading and live trading systems are correctly synchronized.

BEHAVIOR:
  1. ENTRY  — Uses the real 5-min backtest signals (BOS/SMC conditions).
              Direction follows the backtest signal.
  2. EXIT   — Exits when price moves +pip_target pips for TP or
              -pip_target pips for SL, checked intra-bar (H/L).
  3. STACK  — Only 1 position at a time. Next entry only after close.

EXPECTED RESULT:
  Entry mirrors real strategy. Exit at exact ±pip_target.
  Paper and live results must match 1:1.
"""
from __future__ import annotations

import pandas as pd

DEFAULT_SYNC_PARAMS: dict = {
    # Pip distance for TP and SL  (default 2.0 for MGC = $2.00)
    "pip_target": 2.0,
    # Direction filter: "long" | "short" | "both"
    "direction": "both",
    # Skip first N bars to allow indicators to warm up
    "warmup_bars": 50,
    # Legacy: keep hold_bars so old code won't crash
    "hold_bars": 2,
}


class SyncTestStrategy:
    """
    Generates entry signals from the real 5-min strategy indicators.
    Signals encode direction: +1 = LONG entry, -1 = SHORT entry, 0 = flat.
    """

    def __init__(self, params: dict | None = None) -> None:
        self.params = {**DEFAULT_SYNC_PARAMS, **(params or {})}

    # ------------------------------------------------------------------
    def compute_indicators(self, df_5m: pd.DataFrame) -> pd.DataFrame:
        """Compute EMA trend + HalfTrend direction as entry gates."""
        df = df_5m.copy()

        # EMA 20 / 50 trend
        df["ema20"] = df["close"].ewm(span=20, adjust=False).mean()
        df["ema50"] = df["close"].ewm(span=50, adjust=False).mean()

        # RSI 14
        delta = df["close"].diff()
        gain = delta.clip(lower=0).rolling(14).mean()
        loss = (-delta.clip(upper=0)).rolling(14).mean()
        rs = gain / loss.replace(0, 1e-9)
        df["rsi"] = 100 - 100 / (1 + rs)

        # MACD histogram
        ema12 = df["close"].ewm(span=12, adjust=False).mean()
        ema26 = df["close"].ewm(span=26, adjust=False).mean()
        macd = ema12 - ema26
        signal_line = macd.ewm(span=9, adjust=False).mean()
        df["macd_hist"] = macd - signal_line

        return df

    # ------------------------------------------------------------------
    def generate_signals(self, df_ind: pd.DataFrame) -> pd.Series:
        """
        Return a Series of:
          +1  → LONG entry
          -1  → SHORT entry
           0  → no action

        Entry fires when EMA trend aligns + RSI in range + MACD histogram > 0.
        """
        p = self.params
        direction = str(p["direction"]).lower()
        warmup = int(p["warmup_bars"])
        n = len(df_ind)

        ema20 = df_ind["ema20"].to_numpy()
        ema50 = df_ind["ema50"].to_numpy()
        rsi = df_ind["rsi"].to_numpy()
        macd_h = df_ind["macd_hist"].to_numpy()
        closes = df_ind["close"].to_numpy()

        arr = [0] * n

        for i in range(warmup, n):
            bull = closes[i] > ema20[i] > ema50[i] and 45 <= rsi[i] <= 72 and macd_h[i] > 0
            bear = closes[i] < ema20[i] < ema50[i] and 28 <= rsi[i] <= 55 and macd_h[i] < 0

            if direction == "long" and bull:
                arr[i] = 1
            elif direction == "short" and bear:
                arr[i] = -1
            elif direction == "both":
                if bull:
                    arr[i] = 1
                elif bear:
                    arr[i] = -1

        return pd.Series(arr, index=df_ind.index, name="signal")

