"""
MTF Strategy — Configuration
=============================
Daily trend (SuperTrend + HalfTrend) with 4H entry.
Mid-to-long-term, LONG-only.
"""

INITIAL_CAPITAL = 5000.0
RISK_PER_TRADE = 0.02         # 2 % equity risk per trade

DEFAULT_MTF_PARAMS: dict = {
    # ── Daily trend indicators ──────────────────────
    "st_period":         10,       # SuperTrend ATR period
    "st_mult":           3.0,     # SuperTrend multiplier
    "ht_amplitude":      5,       # HalfTrend amplitude
    "ht_channel_dev":    2.0,     # HalfTrend channel deviation
    "ht_atr_length":     100,     # HalfTrend ATR length
    "sma_slow":          50,      # Daily SMA for trend filter / cut-loss

    # ── 4H entry indicators ────────────────────────
    "ema_fast":          9,       # 4H fast EMA
    "ema_slow":          21,      # 4H slow EMA
    "rsi_period":        14,
    "rsi_low":           40,      # RSI buy zone lower bound
    "rsi_high":          70,      # RSI buy zone upper bound
    "atr_period":        14,

    # ── Risk management ─────────────────────────────
    "atr_sl_mult":       2.0,     # ATR-based stop loss multiplier
    "tp1_r_mult":        1.5,     # TP1 R-multiple (50 % exit)
    "tp2_r_mult":        3.0,     # TP2 R-multiple (remaining)
    "tp1_exit_pct":      0.5,     # fraction closed at TP1
    "trail_after_tp1":   True,    # move SL to breakeven after TP1

    # ── Exit signals ────────────────────────────────
    "exit_on_st_flip":   True,    # close if daily SuperTrend flips bearish
    "exit_on_ht_flip":   True,    # close if daily HalfTrend flips down
    "exit_on_sma_cross": True,    # close if daily close < SMA slow

    # ── Session / holding ───────────────────────────
    "max_hold_bars":     60,      # max 4H bars to hold (≈ 15 trading days)
}

HOT_SYMBOLS = [
    "NVDA", "TSLA", "AAPL", "MSFT", "META",
    "AMZN", "GOOGL", "AMD", "PLTR", "COIN",
]
