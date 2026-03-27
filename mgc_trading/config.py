"""
MGC Scalping System — Configuration
====================================
Micro Gold Futures (MGC) automated trading system settings.
"""
from __future__ import annotations

# ═══════════════════════════════════════════════════════════════════════
# Contract Specifications
# ═══════════════════════════════════════════════════════════════════════
SYMBOL_YF = "MGC=F"          # Yahoo Finance continuous front-month
CONTRACT_SYMBOL = "MGC"      # Tiger / broker symbol
CONTRACT_SIZE = 10           # 10 troy ounces per Micro Gold contract
TICK_SIZE = 0.10             # Minimum price increment ($0.10)
TICK_VALUE = 1.00            # Value of one tick ($1.00)

# ═══════════════════════════════════════════════════════════════════════
# Default Strategy Parameters
# ═══════════════════════════════════════════════════════════════════════
DEFAULT_PARAMS: dict = {
    # Trend filter  ── optimised for 15m MGC scalping ──
    "ema_fast": 20,
    "ema_slow": 100,
    # RSI
    "rsi_period": 14,
    "rsi_low": 35,               # RSI recovery threshold
    "rsi_high": 48,              # RSI strength threshold
    # ATR for SL / TP
    "atr_period": 14,
    "atr_sl_mult": 1.5,         # Stop-loss = 1.5 × ATR below entry
    "atr_tp_mult": 2.5,         # Take-profit = 2.5 × ATR above entry
    # Pullback filter
    "pullback_atr_mult": 5.0,   # Price within 5.0 ATR of EMA fast
    # Volume filter
    "vol_period": 20,
    "vol_mult": 0.8,            # Volume > 0.8× moving average
    # Trailing stop (optional)
    "trailing_atr_mult": 1.5,
    "use_trailing": False,
    # Supertrend (optional overlay)
    "st_period": 10,
    "st_mult": 3.0,
    "use_supertrend": False,     # Use supertrend instead of EMA cross
}

# ── Optimisation Result (2026-03-27, 60d 15m, 864 combos) ──
# Win rate:  56.6 %  |  Return: +21.76 %  |  Max DD: 4.70 %
# Sharpe:    2.43    |  PF: 2.01          |  R:R = 1:1.54
# Trades:    53      |  Winners: 30       |  Losers: 23

# ═══════════════════════════════════════════════════════════════════════
# Risk Management
# ═══════════════════════════════════════════════════════════════════════
RISK_PER_TRADE = 0.01        # Max 1 % account risk per position
MAX_CONSECUTIVE_LOSSES = 5   # Pause after 5 consecutive losers
MAX_DAILY_TRADES = 10        # Hard cap per session
INITIAL_CAPITAL = 50_000.0   # Default backtest starting equity (USD)

# ═══════════════════════════════════════════════════════════════════════
# Data Defaults
# ═══════════════════════════════════════════════════════════════════════
DEFAULT_INTERVAL = "15m"     # 15-minute bars
DATA_PERIOD = "60d"          # Max intraday history from yfinance

# ═══════════════════════════════════════════════════════════════════════
# Tiger Open API  (fill in before live / demo trading)
# ═══════════════════════════════════════════════════════════════════════
TIGER_ID = "20158240"                # Your Tiger developer ID
TIGER_PRIVATE_KEY = "mgc_trading/tiger_private.pem"  # RSA private-key PEM file
TIGER_ACCOUNT = "21216597850872657"           # Trading account number
TIGER_IS_SANDBOX = False     # sandbox_debug deprecated in newer SDK

# ═══════════════════════════════════════════════════════════════════════
# Webhook Server
# ═══════════════════════════════════════════════════════════════════════
WEBHOOK_HOST = "0.0.0.0"
WEBHOOK_PORT = 5001
WEBHOOK_SECRET = ""          # Optional shared secret for auth
