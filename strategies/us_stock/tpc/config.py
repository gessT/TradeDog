"""
TPC Strategy — Configuration
=============================
Trend-Pullback-Continuation: Weekly trend + 1H pullback entry.
Mid-to-long-term, LONG-only.

Design philosophy:
  ≥65% win rate, maximise ROI, minimal trades, controlled drawdown.
"""

INITIAL_CAPITAL = 5000.0
RISK_PER_TRADE = 0.03         # 3% equity risk per trade (higher edge → larger size)

DEFAULT_TPC_PARAMS: dict = {
    # ── Weekly trend filter ──────────────────────────
    "w_st_period":       10,      # Weekly SuperTrend ATR period
    "w_st_mult":         3.0,     # Weekly SuperTrend multiplier

    # ── Trend strength filters ───────────────────────
    "d_ema_trend":       200,     # Daily EMA for trend strength
    "d_adx_period":      14,      # ADX period
    "d_adx_min":         20,      # Minimum ADX for trend strength

    # ── HalfTrend (daily) — pullback detection ───────
    "d_ht_amplitude":    5,       # HalfTrend amplitude
    "d_ht_channel_dev":  2.0,
    "d_ht_atr_length":   100,

    # ── 1H entry indicators ──────────────────────────
    "h_ema_fast":        20,      # 1H EMA for pullback proximity
    "h_ema_slow":        50,      # 1H slower EMA for trend
    "h_rsi_period":      14,
    "h_rsi_min":         30,      # Avoid deep oversold (trend broken)
    "h_rsi_max":         70,      # Avoid overbought (exhaustion)
    "h_atr_period":      14,
    "h_vol_period":      20,      # Volume MA period

    # ── Entry conditions ─────────────────────────────
    "h_vol_multiplier":  1.0,     # Volume > X × vol_ma
    "h_body_ratio_min":  0.30,    # Minimum candle body ratio
    "pullback_ema":      50,      # Pullback near this EMA (within ATR distance)
    "pullback_atr_dist": 2.5,     # Max distance from pullback EMA in ATR units

    # ── Risk management ──────────────────────────────
    "atr_sl_mult":       2.0,     # ATR-based stop loss
    "tp1_r_mult":        1.0,     # TP1 at 1.0R (exit 50%) — lock in early
    "tp2_r_mult":        2.5,     # TP2 at 2.5R (exit remainder)
    "tp1_exit_pct":      0.5,     # Fraction closed at TP1
    "trail_after_tp1":   True,    # Move SL to BE after TP1

    # ── ATR trailing stop ────────────────────────────
    "use_trailing":      True,
    "trailing_atr_mult": 2.5,     # Trail distance: X × ATR from peak

    # ── Exit on weekly/daily signals ─────────────────
    "exit_on_w_st_flip": True,    # Hard exit on weekly SuperTrend flip
    "exit_on_d_ht_flip": True,    # Exit on daily HalfTrend flip down
    "exit_on_ema200":    True,    # Exit if daily close < EMA200

    # ── Trade frequency control ──────────────────────
    "one_per_cycle":     False,   # Allow multiple entries per trend cycle
    "cooldown_bars":     10,      # Min bars between trades (1H)
    "max_hold_bars":     120,     # Max 1H bars ≈ ~17 trading days

    # ── Volatility filter ────────────────────────────
    "min_atr_pct":       0.003,   # Min ATR as % of price (avoid dead markets)
}
