"""
US Stock 1-Hour System — Configuration
========================================
"""
from __future__ import annotations

# ═══════════════════════════════════════════════════════════════════════
# Stock Defaults  (no contract multiplier — shares trading)
# ═══════════════════════════════════════════════════════════════════════
SHARE_SIZE = 1               # P&L per $1 move per share
INITIAL_CAPITAL = 25_000.0   # default starting capital (USD)
RISK_PER_TRADE = 0.02        # 2% risk per trade
