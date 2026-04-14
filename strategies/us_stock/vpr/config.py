"""
VPR Strategy — Configuration
==============================
Volume Profile + VWAP + RSI  (LONG only, US equities)
"""
from __future__ import annotations

# ═══════════════════════════════════════════════════════════════════════
# Capital & Risk
# ═══════════════════════════════════════════════════════════════════════
INITIAL_CAPITAL = 5_000.0
RISK_PER_TRADE = 0.02          # 2% risk per trade

# ═══════════════════════════════════════════════════════════════════════
# Indicator parameters
# ═══════════════════════════════════════════════════════════════════════
RSI_PERIOD = 14
RSI_LOW = 45                   # RSI must be >= this
RSI_HIGH = 65                  # RSI must be <= this
ATR_PERIOD = 14

# Volume Profile
VP_BIN_COUNT = 50              # number of price bins for profile
VP_HVN_PERCENTILE = 70        # bins above this percentile = HVN
VP_LOOKBACK = 100              # bars to build the profile over
VP_TOUCH_TOLERANCE_ATR = 0.3   # POC/HVN proximity = 0.3 × ATR

# ═══════════════════════════════════════════════════════════════════════
# Risk management
# ═══════════════════════════════════════════════════════════════════════
ATR_SL_MULT = 1.3              # SL = entry − 1.3 × ATR
TP1_R_MULT = 1.0               # partial exit at 1R
TP2_R_MULT = 1.8               # final exit at 1.8R
TP1_EXIT_PCT = 0.5             # close 50% at TP1

# ═══════════════════════════════════════════════════════════════════════
# Session / filters
# ═══════════════════════════════════════════════════════════════════════
MAX_TRADES_PER_SESSION = 1
# US regular session in ET (UTC-5 / UTC-4 DST) → 09:30-16:00 ET
SESSION_START_HOUR_UTC = 13     # 09:30 ET ≈ 13:30 UTC (approx)
SESSION_END_HOUR_UTC = 20      # 16:00 ET ≈ 20:00 UTC (approx)

# ═══════════════════════════════════════════════════════════════════════
# Default parameters dict  (for optimizer sweep)
# ═══════════════════════════════════════════════════════════════════════
DEFAULT_VPR_PARAMS: dict = {
    "rsi_period": RSI_PERIOD,
    "rsi_low": RSI_LOW,
    "rsi_high": RSI_HIGH,
    "atr_period": ATR_PERIOD,
    "atr_sl_mult": ATR_SL_MULT,
    "tp1_r_mult": TP1_R_MULT,
    "tp2_r_mult": TP2_R_MULT,
    "tp1_exit_pct": TP1_EXIT_PCT,
    "vp_bin_count": VP_BIN_COUNT,
    "vp_hvn_percentile": VP_HVN_PERCENTILE,
    "vp_lookback": VP_LOOKBACK,
    "vp_touch_tolerance_atr": VP_TOUCH_TOLERANCE_ATR,
    "max_trades_per_session": MAX_TRADES_PER_SESSION,
}

# Hot-pick symbols
HOT_SYMBOLS = [
    "NVDA", "TSLA", "AAPL", "MSFT", "META",
    "AMZN", "GOOGL", "AMD", "PLTR", "COIN",
]
