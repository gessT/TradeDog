"""
TPC Strategy — Configuration
=============================
Simple weekly SuperTrend trend-following.
Buy when Weekly SuperTrend flips positive, sell when it flips negative.
"""

INITIAL_CAPITAL = 5000.0
RISK_PER_TRADE = 0.03         # 3% equity risk per trade

DEFAULT_TPC_PARAMS: dict = {
    # ── Weekly SuperTrend ────────────────────────────
    "w_st_period":       10,      # Weekly SuperTrend ATR period
    "w_st_mult":         3.0,     # Weekly SuperTrend multiplier

    # ── Risk management ──────────────────────────────
    "atr_sl_mult":       2.0,     # ATR-based stop loss (1H ATR)
    "tp1_r_mult":        1.0,     # TP1 at 1.0R (exit 50%)
    "tp2_r_mult":        2.5,     # TP2 at 2.5R (exit remainder)
    "tp1_exit_pct":      0.5,     # Fraction closed at TP1
    "trail_after_tp1":   True,    # Move SL to BE after TP1

    # ── ATR trailing stop ────────────────────────────
    "use_trailing":      True,
    "trailing_atr_mult": 2.5,     # Trail distance: X × ATR from peak

    # ── 1H indicators (for ATR / chart display) ──────
    "h_ema_fast":        20,
    "h_ema_slow":        50,
    "h_rsi_period":      14,
    "h_atr_period":      14,

    # ── HalfTrend ────────────────────────────────────
    "ht_amplitude":       5,
    "ht_channel_deviation": 2.0,
    "ht_price_gap":       10.0,   # Max $ distance from HT line to enter
}
