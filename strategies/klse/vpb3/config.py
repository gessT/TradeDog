"""
config.py — VPB3 Malaysia (量价突破) defaults for KLSE/Bursa Malaysia.

Daily-only strategy (no 1H data needed).
Optimised on 15 major KLSE stocks with H_tight config:
  - 2Y: 35% WR, PF 1.74, 5% MaxDD
  - Best suited for recent market regimes (1-2Y lookback)
"""
from __future__ import annotations

# Risk management
RISK_PER_TRADE = 0.05  # 5% per trade

# NOTE: The canonical DEFAULT_PARAMS lives in strategy.py.
# This file kept for reference only.
