"""
Futures Auto-Trader — 4-Layer Production Trading System
=======================================================

Architecture:
  Layer 1: Signal Engine     — scanner_5min detects signals
  Layer 2: Validation Layer  — market condition + freshness filter
  Layer 3: Risk Engine       — position sizing, drawdown, consecutive loss
  Layer 4: Execution Engine  — order placement via Tiger API

State Machine: IDLE → IN_TRADE → COOLDOWN → BLOCKED
"""
from .state_machine import TradingState, TradingStateMachine, get_machine
from .risk_engine import RiskEngine, RiskDecision, get_risk_engine
from .paper_trader import PaperTrader, PaperTrade, get_paper_trader
from .auto_trader import FuturesAutoTrader, TickResult, get_auto_trader

__all__ = [
    "TradingState",
    "TradingStateMachine",
    "get_machine",
    "RiskEngine",
    "RiskDecision",
    "get_risk_engine",
    "PaperTrader",
    "PaperTrade",
    "get_paper_trader",
    "FuturesAutoTrader",
    "TickResult",
    "get_auto_trader",
]
