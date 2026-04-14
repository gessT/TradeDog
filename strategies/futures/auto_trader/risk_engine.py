"""
Risk Engine — Position sizing, drawdown control, trade validation
==================================================================

Responsibilities:
  1. Position sizing — risk-based (1% account per trade) using ATR
  2. Pre-trade validation — all checks before order placement
  3. Drawdown monitoring — daily loss, consecutive loss tracking
  4. Slippage estimation — realistic spread/slippage for paper trades

Signal flow:
  Scanner → Signal → RiskEngine.evaluate() → RiskDecision(approved/rejected)
"""
from __future__ import annotations

import logging
import threading
from dataclasses import dataclass
from datetime import date
from typing import Optional

from ..config import CONTRACT_SIZE, RISK_PER_TRADE, TICK_SIZE

logger = logging.getLogger(__name__)


@dataclass
class RiskDecision:
    """Result of risk evaluation."""
    approved: bool
    qty: int = 0
    reason: str = ""
    adjusted_sl: float = 0.0
    adjusted_tp: float = 0.0
    risk_amount: float = 0.0    # $ at risk
    risk_pct: float = 0.0       # % of account
    max_loss: float = 0.0       # $ max loss this trade


class RiskEngine:
    """Centralized risk management for futures trading.

    All trades — paper or live — must pass through evaluate() before execution.
    """

    def __init__(self, symbol: str = "MGC") -> None:
        self.symbol = symbol
        self._lock = threading.Lock()

        # Account
        self._account_balance: float = 50_000.0
        self._risk_per_trade: float = RISK_PER_TRADE  # 1%

        # Daily limits
        self._daily_loss_limit: float = 350.0
        self._daily_pnl: float = 0.0
        self._daily_date: str = ""
        self._daily_trades: int = 0
        self._max_daily_trades: int = 10

        # Consecutive loss tracking
        self._consec_losses: int = 0
        self._max_consec_losses: int = 3

        # Trade size limits
        self._max_qty: int = 5
        self._min_risk_reward: float = 1.0

        # Slippage simulation
        self._spread_ticks: float = 1.0     # 1 tick spread ($0.10 for MGC)
        self._slippage_ticks: float = 0.5   # 0.5 tick avg slippage

    # ── Pre-trade evaluation ────────────────────────────────────────

    def evaluate(
        self,
        direction: str,
        entry_price: float,
        stop_loss: float,
        take_profit: float,
        strength: int = 5,
        current_tiger_qty: int = 0,
    ) -> RiskDecision:
        """Full pre-trade risk check. Returns approved/rejected with sizing."""
        with self._lock:
            self._reset_daily_if_needed()

            # Gate 1: daily loss limit
            if self._daily_loss_limit > 0 and self._daily_pnl <= -self._daily_loss_limit:
                return RiskDecision(
                    approved=False,
                    reason=f"daily_loss_limit (${self._daily_pnl:.2f} / -${self._daily_loss_limit:.0f})",
                )

            # Gate 2: consecutive losses
            if self._consec_losses >= self._max_consec_losses:
                return RiskDecision(
                    approved=False,
                    reason=f"consecutive_losses ({self._consec_losses}/{self._max_consec_losses})",
                )

            # Gate 3: daily trade count
            if self._daily_trades >= self._max_daily_trades:
                return RiskDecision(
                    approved=False,
                    reason=f"daily_trade_limit ({self._daily_trades}/{self._max_daily_trades})",
                )

            # Gate 4: existing position
            if current_tiger_qty > 0 and current_tiger_qty >= self._max_qty:
                return RiskDecision(
                    approved=False,
                    reason=f"max_qty_reached ({current_tiger_qty}/{self._max_qty})",
                )

            # Gate 5: valid SL/TP
            if stop_loss <= 0 or take_profit <= 0:
                return RiskDecision(approved=False, reason="missing_sl_tp")

            # Gate 6: risk/reward ratio
            risk_dist = abs(entry_price - stop_loss)
            reward_dist = abs(take_profit - entry_price)
            if risk_dist <= 0:
                return RiskDecision(approved=False, reason="zero_risk_distance")
            rr = reward_dist / risk_dist
            if rr < self._min_risk_reward:
                return RiskDecision(
                    approved=False,
                    reason=f"low_risk_reward ({rr:.2f} < {self._min_risk_reward:.1f})",
                )

            # Gate 7: direction consistency
            if direction == "CALL":
                if stop_loss >= entry_price or take_profit <= entry_price:
                    return RiskDecision(approved=False, reason="invalid_sl_tp_direction")
            else:
                if stop_loss <= entry_price or take_profit >= entry_price:
                    return RiskDecision(approved=False, reason="invalid_sl_tp_direction")

            # ── Position sizing ─────────────────────────────────────
            risk_amount = self._account_balance * self._risk_per_trade
            risk_per_contract = risk_dist * CONTRACT_SIZE
            qty = max(1, min(self._max_qty, int(risk_amount / risk_per_contract)))

            # Use SL/TP as-is from scanner (matches backtest exactly)
            adjusted_sl = round(stop_loss, 2)
            adjusted_tp = round(take_profit, 2)

            max_loss = risk_per_contract * qty

            return RiskDecision(
                approved=True,
                qty=qty,
                reason="approved",
                adjusted_sl=adjusted_sl,
                adjusted_tp=adjusted_tp,
                risk_amount=round(risk_amount, 2),
                risk_pct=round(self._risk_per_trade * 100, 2),
                max_loss=round(max_loss, 2),
            )

    # ── Post-trade recording ────────────────────────────────────────

    def record_trade_result(self, pnl: float) -> None:
        """Record trade P&L for risk tracking."""
        with self._lock:
            self._reset_daily_if_needed()
            self._daily_pnl += pnl
            self._daily_trades += 1
            if pnl > 0:
                self._consec_losses = 0
            else:
                self._consec_losses += 1
            logger.info("[%s] Risk: trade pnl=$%.2f | daily=$%.2f | consec_losses=%d",
                        self.symbol, pnl, self._daily_pnl, self._consec_losses)

    def update_balance(self, balance: float) -> None:
        """Update account balance (from broker sync)."""
        with self._lock:
            self._account_balance = balance

    # ── Slippage simulation (for paper trading) ─────────────────────

    def simulate_slippage(self, direction: str, entry_price: float) -> tuple[float, float]:
        """Simulate realistic entry with spread + slippage.

        Returns (simulated_entry_price, slippage_cost_per_contract).
        """
        spread_impact = self._spread_ticks * TICK_SIZE / 2
        slippage_impact = self._slippage_ticks * TICK_SIZE

        if direction == "CALL":
            sim_price = entry_price + spread_impact + slippage_impact
        else:
            sim_price = entry_price - spread_impact - slippage_impact

        cost = (spread_impact + slippage_impact) * CONTRACT_SIZE
        return round(sim_price, 2), round(cost, 2)

    # ── Config ──────────────────────────────────────────────────────

    def update_config(self, **kwargs) -> dict:
        with self._lock:
            if "risk_per_trade" in kwargs:
                self._risk_per_trade = max(0.001, min(0.05, float(kwargs["risk_per_trade"])))
            if "daily_loss_limit" in kwargs:
                self._daily_loss_limit = max(0, float(kwargs["daily_loss_limit"]))
            if "max_consec_losses" in kwargs:
                self._max_consec_losses = max(1, int(kwargs["max_consec_losses"]))
            if "max_daily_trades" in kwargs:
                self._max_daily_trades = max(1, int(kwargs["max_daily_trades"]))
            if "max_qty" in kwargs:
                self._max_qty = max(1, int(kwargs["max_qty"]))
            if "min_risk_reward" in kwargs:
                self._min_risk_reward = max(0, float(kwargs["min_risk_reward"]))
            return self.get_config()

    def get_config(self) -> dict:
        return {
            "risk_per_trade": self._risk_per_trade,
            "daily_loss_limit": self._daily_loss_limit,
            "max_consec_losses": self._max_consec_losses,
            "max_daily_trades": self._max_daily_trades,
            "max_qty": self._max_qty,
            "min_risk_reward": self._min_risk_reward,
            "account_balance": self._account_balance,
            "daily_pnl": round(self._daily_pnl, 2),
            "daily_trades": self._daily_trades,
            "consec_losses": self._consec_losses,
        }

    def manual_reset(self) -> None:
        """Reset consecutive losses and daily counters."""
        with self._lock:
            self._consec_losses = 0
            self._daily_pnl = 0.0
            self._daily_trades = 0

    # ── Internals ───────────────────────────────────────────────────

    def _round_to_tick(self, price: float) -> float:
        return round(round(price / TICK_SIZE) * TICK_SIZE, 2)

    def _reset_daily_if_needed(self) -> None:
        today = str(date.today())
        if self._daily_date != today:
            self._daily_date = today
            self._daily_pnl = 0.0
            self._daily_trades = 0


# ── Singleton ───────────────────────────────────────────────────────
_engines: dict[str, RiskEngine] = {}
_lock = threading.Lock()


def get_risk_engine(symbol: str = "MGC") -> RiskEngine:
    with _lock:
        if symbol not in _engines:
            _engines[symbol] = RiskEngine(symbol)
        return _engines[symbol]
