"""
Paper Trader - Real-time simulation matching backtest logic.

Executes signals against live market data WITHOUT placing real orders.
Uses the SAME entry/SL/TP prices as the backtester for consistency:
  - Entry at signal price (bar open, same as backtest)
  - Exit at exact SL/TP level (same as backtest)
  - No simulated slippage or spread

Every paper trade flows through the same risk engine and state machine
as live trades - identical validation path.
"""
from __future__ import annotations

import logging
import threading
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Optional

from ..config import CONTRACT_SIZE, TICK_SIZE
from .state_machine import TradeRecord

logger = logging.getLogger(__name__)


@dataclass
class PaperTrade:
    """A simulated trade with full execution details."""
    id: int
    direction: str
    entry_price: float
    raw_entry_price: float
    stop_loss: float
    take_profit: float
    qty: int
    entry_time: str
    exit_time: str = ""
    exit_price: float = 0.0
    pnl: float = 0.0
    exit_reason: str = ""
    slippage_cost: float = 0.0
    spread_cost: float = 0.0
    is_open: bool = True
    bar_time: str = ""
    strength: int = 0


class PaperTrader:
    """Simulated execution engine for paper trading.

    Tracks open position, monitors SL/TP exits using live price.
    Entry/exit prices match backtester exactly (no slippage).
    """

    def __init__(self, symbol: str = "MGC") -> None:
        self.symbol = symbol
        self._lock = threading.Lock()
        self._trades: list[PaperTrade] = []
        self._open_trade: Optional[PaperTrade] = None
        self._next_id = 1
        self._contract_size: float = CONTRACT_SIZE

    def execute_entry(
        self,
        direction: str,
        entry_price: float,
        stop_loss: float,
        take_profit: float,
        qty: int = 1,
        bar_time: str = "",
        strength: int = 0,
    ) -> Optional[PaperTrade]:
        """Simulate order fill - same price as backtest (no slippage)."""
        with self._lock:
            if self._open_trade is not None:
                logger.warning("[%s] Paper: already in position - skipped", self.symbol)
                return None

            sim_entry = round(entry_price, 2)

            trade = PaperTrade(
                id=self._next_id,
                direction=direction,
                entry_price=sim_entry,
                raw_entry_price=entry_price,
                stop_loss=stop_loss,
                take_profit=take_profit,
                qty=qty,
                entry_time=datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S"),
                slippage_cost=0.0,
                spread_cost=0.0,
                bar_time=bar_time,
                strength=strength,
            )
            self._next_id += 1
            self._open_trade = trade
            self._trades.append(trade)

            logger.info("[%s] PAPER ENTRY: %s %dx @ %.2f",
                        self.symbol, direction, qty, sim_entry)
            return trade

    def check_exit(self, live_price: float) -> Optional[str]:
        """Check if paper position hit SL/TP. Returns exit reason or None."""
        with self._lock:
            if self._open_trade is None or live_price <= 0:
                return None

            t = self._open_trade
            is_long = t.direction == "CALL"

            if is_long:
                if live_price <= t.stop_loss:
                    return "SL"
                if live_price >= t.take_profit:
                    return "TP"
            else:
                if live_price >= t.stop_loss:
                    return "SL"
                if live_price <= t.take_profit:
                    return "TP"
            return None

    def execute_exit(self, exit_price: float, reason: str = "TP") -> Optional[PaperTrade]:
        """Close paper position at exact SL/TP level (matches backtest)."""
        with self._lock:
            if self._open_trade is None:
                return None

            t = self._open_trade

            # Exit at exact SL/TP level (same as backtest)
            if reason == "SL":
                sim_exit = t.stop_loss
            elif reason == "TP":
                sim_exit = t.take_profit
            else:
                sim_exit = round(exit_price, 2)

            if t.direction == "CALL":
                raw_pnl = (sim_exit - t.entry_price) * t.qty * self._contract_size
            else:
                raw_pnl = (t.entry_price - sim_exit) * t.qty * self._contract_size

            t.exit_price = sim_exit
            t.exit_time = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
            t.pnl = round(raw_pnl, 2)
            t.exit_reason = reason
            t.is_open = False

            self._open_trade = None

            logger.info("[%s] PAPER EXIT: %s @ %.2f reason=%s pnl=$%.2f",
                        self.symbol, t.direction, sim_exit, reason, t.pnl)
            return t

    def close_position(self, live_price: float) -> Optional[PaperTrade]:
        """Force close at current price."""
        return self.execute_exit(live_price, reason="MANUAL")

    @property
    def has_position(self) -> bool:
        return self._open_trade is not None

    @property
    def open_trade(self) -> Optional[PaperTrade]:
        return self._open_trade

    @property
    def trade_history(self) -> list[PaperTrade]:
        return list(self._trades)

    def get_summary(self) -> dict:
        """Summary for API response."""
        closed = [t for t in self._trades if not t.is_open]
        wins = [t for t in closed if t.pnl > 0]
        losses = [t for t in closed if t.pnl <= 0]
        total_pnl = sum(t.pnl for t in closed)

        return {
            "total_trades": len(closed),
            "open_position": self._trade_to_dict(self._open_trade),
            "wins": len(wins),
            "losses": len(losses),
            "win_rate": round(len(wins) / len(closed) * 100, 1) if closed else 0,
            "total_pnl": round(total_pnl, 2),
            "avg_pnl": round(total_pnl / len(closed), 2) if closed else 0,
            "recent_trades": [self._trade_to_dict(t) for t in closed[-10:]],
        }

    def reset(self) -> None:
        """Clear all paper trades."""
        with self._lock:
            self._trades.clear()
            self._open_trade = None
            self._next_id = 1

    @staticmethod
    def _trade_to_dict(t: Optional[PaperTrade]) -> Optional[dict]:
        if t is None:
            return None
        return {
            "id": t.id,
            "direction": t.direction,
            "entry_price": t.entry_price,
            "raw_entry_price": t.raw_entry_price,
            "exit_price": t.exit_price,
            "stop_loss": t.stop_loss,
            "take_profit": t.take_profit,
            "qty": t.qty,
            "pnl": t.pnl,
            "exit_reason": t.exit_reason,
            "entry_time": t.entry_time,
            "exit_time": t.exit_time,
            "slippage_cost": t.slippage_cost,
            "spread_cost": t.spread_cost,
            "is_open": t.is_open,
            "bar_time": t.bar_time,
            "strength": t.strength,
        }


_traders: dict[str, PaperTrader] = {}
_lock = threading.Lock()


def get_paper_trader(symbol: str = "MGC") -> PaperTrader:
    with _lock:
        if symbol not in _traders:
            _traders[symbol] = PaperTrader(symbol)
        return _traders[symbol]
