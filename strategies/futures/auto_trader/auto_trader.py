"""
Futures Auto-Trader — Tick-driven orchestrator
===============================================

Combines all 4 layers into a single tick() loop:

  ┌─────────────┐    ┌──────────────┐    ┌─────────────┐    ┌──────────────┐
  │ Signal       │ →  │ Validation   │ →  │ Risk        │ →  │ Execution    │
  │ (scanner)    │    │ (freshness,  │    │ (sizing,    │    │ (paper or    │
  │              │    │  market cond)│    │  limits)    │    │  Tiger API)  │
  └─────────────┘    └──────────────┘    └─────────────┘    └──────────────┘

Modes:
  - "paper" : signals execute as paper trades (same prices as backtest)
  - "live"  : signals execute via Tiger bracket orders
  - "off"   : no polling, manual only

Tick loop (called by frontend every 10s + at 5m bar close):
  1. BLOCKED? → return blocked snapshot
  2. COOLDOWN? → check elapsed → IDLE
  3. IN_TRADE? → check SL/TP via live price → exit if hit
  4. IDLE + bar_close? → scan → validate → risk check → execute
"""
from __future__ import annotations

import logging
import threading
from dataclasses import dataclass, field
from typing import Optional

import pandas as pd

from .state_machine import (
    TradingState,
    TradingStateMachine,
    StateSnapshot,
    TradeRecord,
    get_machine,
)
from .risk_engine import RiskEngine, RiskDecision, get_risk_engine
from .paper_trader import PaperTrader, get_paper_trader
from ..scanner_5min import ScanResult5Min, scan_5min
from ..execution_engine import get_engine
from ..config import CONTRACT_SIZE

logger = logging.getLogger(__name__)


@dataclass
class TickResult:
    """Result from a single tick() call."""
    action: str = "NONE"       # NONE / SCAN / SIGNAL / ENTRY / EXIT / COOLDOWN / BLOCKED
    signal: Optional[dict] = None
    trade: Optional[dict] = None
    risk: Optional[dict] = None
    snapshot: Optional[dict] = None
    message: str = ""


class FuturesAutoTrader:
    """Production-grade tick-driven auto-trading orchestrator.

    Flow: tick() → scan → validate → risk_check → execute (paper/live)
    """

    def __init__(self, symbol: str = "MGC") -> None:
        self.symbol = symbol
        self._machine = get_machine(symbol)
        self._risk = get_risk_engine(symbol)
        self._paper = get_paper_trader(symbol)
        self._exec_engine = get_engine(symbol)
        self._lock = threading.Lock()

        # Scanner config
        self._disabled_conditions: set[str] = set()
        self._sl_mult: float = 4.0
        self._tp_mult: float = 3.0

    # ═══════════════════════════════════════════════════════════════
    # Main tick loop
    # ═══════════════════════════════════════════════════════════════

    def tick(
        self,
        live_price: float = 0.0,
        df_5m: Optional[pd.DataFrame] = None,
        is_bar_close: bool = False,
        tiger_qty: int = 0,
    ) -> TickResult:
        """Process one tick. Called by frontend polling."""
        with self._lock:
            if not self._machine.started:
                return TickResult(
                    action="NONE",
                    message="Auto-trader not started",
                    snapshot=self._snap(),
                )

            state = self._machine.state

            # ── BLOCKED ──
            if state == TradingState.BLOCKED:
                return TickResult(
                    action="BLOCKED",
                    message=f"Trading blocked: {self._machine._blocked_reason}",
                    snapshot=self._snap(),
                )

            # ── COOLDOWN ──
            if state == TradingState.COOLDOWN:
                if self._machine.check_cooldown():
                    return TickResult(
                        action="COOLDOWN",
                        message="Cooldown ended → IDLE",
                        snapshot=self._snap(),
                    )
                snap = self._machine.snapshot()
                return TickResult(
                    action="COOLDOWN",
                    message=f"Cooldown ({snap.cooldown_remaining:.0f}s)",
                    snapshot=self._snap(),
                )

            # ── IN_TRADE: monitor SL/TP ──
            if state == TradingState.IN_TRADE:
                return self._handle_in_trade(live_price, tiger_qty)

            # ── IDLE: scan + execute ──
            if state == TradingState.IDLE:
                if not is_bar_close or df_5m is None:
                    return TickResult(
                        action="NONE",
                        message="Waiting for bar close",
                        snapshot=self._snap(),
                    )
                return self._handle_idle_scan(df_5m, live_price)

        return TickResult(action="NONE", snapshot=self._snap())

    # ═══════════════════════════════════════════════════════════════
    # State handlers
    # ═══════════════════════════════════════════════════════════════

    def _handle_in_trade(self, live_price: float, tiger_qty: int) -> TickResult:
        """Monitor position for SL/TP exit."""
        mode = self._machine.mode

        # Paper mode: check paper trader
        if mode == "paper":
            exit_reason = self._paper.check_exit(live_price)
            if exit_reason:
                paper_trade = self._paper.execute_exit(live_price, exit_reason)
                if paper_trade:
                    trade = self._machine.on_exit(
                        paper_trade.exit_price, exit_reason,
                        CONTRACT_SIZE, 0.0, is_paper=True,
                    )
                    self._risk.record_trade_result(paper_trade.pnl)
                    return TickResult(
                        action="EXIT",
                        message=f"PAPER {exit_reason} @ ${paper_trade.exit_price:.2f} pnl=${paper_trade.pnl:.2f}",
                        trade=self._trade_dict(trade),
                        snapshot=self._snap(),
                    )

        # Live mode: check state machine SL/TP + broker sync
        elif mode == "live":
            # Sync: broker closed position externally
            if tiger_qty == 0 and self._machine.state == TradingState.IN_TRADE:
                exit_reason = self._machine.check_exit(live_price) or "BROKER_CLOSE"
                self._exec_engine.sync_with_broker(0, live_price, CONTRACT_SIZE)
                trade = self._machine.on_exit(live_price, exit_reason, CONTRACT_SIZE)
                if trade:
                    self._risk.record_trade_result(trade.pnl)
                return TickResult(
                    action="EXIT",
                    message=f"Broker closed: {exit_reason} @ ${live_price:.2f}",
                    trade=self._trade_dict(trade),
                    snapshot=self._snap(),
                )

            # Check SL/TP
            exit_reason = self._machine.check_exit(live_price)
            if exit_reason:
                self._exec_engine.record_exit(exit_reason, live_price, CONTRACT_SIZE)
                trade = self._machine.on_exit(live_price, exit_reason, CONTRACT_SIZE)
                if trade:
                    self._risk.record_trade_result(trade.pnl)
                return TickResult(
                    action="EXIT",
                    message=f"{exit_reason} HIT @ ${live_price:.2f}",
                    trade=self._trade_dict(trade),
                    snapshot=self._snap(),
                )

        return TickResult(
            action="NONE",
            message="In position — monitoring",
            snapshot=self._snap(),
        )

    def _handle_idle_scan(self, df_5m: pd.DataFrame, live_price: float) -> TickResult:
        """Scan for signals and execute if approved."""
        # Layer 1: Signal Engine
        params = {"atr_sl_mult": self._sl_mult, "atr_tp_mult": self._tp_mult}
        scan = scan_5min(df_5m, params=params, disabled=self._disabled_conditions or None)

        if not scan.found:
            return TickResult(
                action="SCAN",
                message="No signal found",
                snapshot=self._snap(),
            )

        # Layer 2: Validation (state machine gates)
        accepted = self._machine.accept_signal(scan)
        if not accepted:
            return TickResult(
                action="SCAN",
                message=f"Signal rejected (str={scan.strength}, fresh={scan.is_fresh})",
                snapshot=self._snap(),
            )

        # Layer 3: Risk Engine
        risk = self._risk.evaluate(
            direction=scan.direction,
            entry_price=scan.entry_price,
            stop_loss=scan.stop_loss,
            take_profit=scan.take_profit,
            strength=scan.strength,
        )

        if not risk.approved:
            self._machine.cancel_signal()
            return TickResult(
                action="SCAN",
                message=f"Risk rejected: {risk.reason}",
                risk={"approved": False, "reason": risk.reason},
                snapshot=self._snap(),
            )

        # Layer 4: Execution
        mode = self._machine.mode
        signal = self._machine.signal

        if mode == "paper":
            return self._execute_paper(signal, risk)
        elif mode == "live":
            # Live execution — return signal for API to execute
            return TickResult(
                action="SIGNAL",
                signal=self._machine._signal_to_dict(),
                risk={
                    "approved": True,
                    "qty": risk.qty,
                    "sl": risk.adjusted_sl,
                    "tp": risk.adjusted_tp,
                    "risk_amount": risk.risk_amount,
                    "max_loss": risk.max_loss,
                },
                message=f"Signal: {scan.direction} @ ${scan.entry_price:.2f} (qty={risk.qty})",
                snapshot=self._snap(),
            )

        return TickResult(action="NONE", snapshot=self._snap())

    def _execute_paper(self, signal, risk: RiskDecision) -> TickResult:
        """Execute a paper trade immediately."""
        if signal is None:
            return TickResult(action="NONE", snapshot=self._snap())

        paper_trade = self._paper.execute_entry(
            direction=signal.direction,
            entry_price=signal.entry_price,
            stop_loss=risk.adjusted_sl,
            take_profit=risk.adjusted_tp,
            qty=risk.qty,
            bar_time=signal.bar_time,
            strength=signal.strength,
        )

        if paper_trade is None:
            self._machine.cancel_signal()
            return TickResult(
                action="SCAN",
                message="Paper execution failed (already in position?)",
                snapshot=self._snap(),
            )

        self._machine.on_entry_filled(
            entry_price=paper_trade.entry_price,
            sl=paper_trade.stop_loss,
            tp=paper_trade.take_profit,
            qty=paper_trade.qty,
            direction=paper_trade.direction,
        )

        return TickResult(
            action="ENTRY",
            signal=self._machine._signal_to_dict(),
            message=f"PAPER {signal.direction} {risk.qty}x @ ${paper_trade.entry_price:.2f}",
            snapshot=self._snap(),
        )

    # ═══════════════════════════════════════════════════════════════
    # External actions (called by API endpoints)
    # ═══════════════════════════════════════════════════════════════

    def on_live_entry_filled(self, entry_price: float, sl: float, tp: float,
                             qty: int, direction: str) -> None:
        """Called after Tiger bracket order fills."""
        self._machine.on_entry_filled(entry_price, sl, tp, qty, direction)

    def on_live_exit(self, exit_price: float, reason: str = "TP") -> Optional[TradeRecord]:
        """Called when live position exits."""
        trade = self._machine.on_exit(exit_price, reason, CONTRACT_SIZE)
        if trade:
            self._risk.record_trade_result(trade.pnl)
        return trade

    def emergency_stop(self, live_price: float = 0.0) -> dict:
        """Emergency: close paper position + stop machine."""
        result = {"paper_closed": False, "machine_stopped": True}
        if self._machine.mode == "paper" and self._paper.has_position:
            trade = self._paper.close_position(live_price)
            if trade:
                self._machine.on_exit(trade.exit_price, "EMERGENCY", CONTRACT_SIZE, is_paper=True)
                result["paper_closed"] = True
                result["paper_pnl"] = trade.pnl
        self._machine.emergency_stop()
        return result

    # ═══════════════════════════════════════════════════════════════
    # Controls
    # ═══════════════════════════════════════════════════════════════

    def start(self, mode: str = "paper") -> dict:
        self._machine.start(mode)
        return self._snap()

    def stop(self) -> dict:
        self._machine.stop()
        return self._snap()

    def reset(self) -> dict:
        self._machine.reset()
        self._paper.reset()
        self._risk.manual_reset()
        return self._snap()

    def unblock(self) -> dict:
        self._machine.unblock()
        self._risk.manual_reset()
        return self._snap()

    def update_config(
        self,
        disabled_conditions: Optional[set[str]] = None,
        sl_mult: Optional[float] = None,
        tp_mult: Optional[float] = None,
        **kwargs,
    ) -> dict:
        if disabled_conditions is not None:
            self._disabled_conditions = disabled_conditions
        if sl_mult is not None:
            self._sl_mult = sl_mult
        if tp_mult is not None:
            self._tp_mult = tp_mult

        # Split kwargs between machine and risk engine
        machine_keys = {"cooldown_secs", "min_strength", "max_consec_losses", "daily_limit", "daily_loss_limit"}
        risk_keys = {"risk_per_trade", "max_qty", "min_risk_reward", "max_daily_trades"}

        machine_kwargs = {k: v for k, v in kwargs.items() if k in machine_keys}
        risk_kwargs = {k: v for k, v in kwargs.items() if k in risk_keys}

        if machine_kwargs:
            self._machine.update_config(**machine_kwargs)
        if risk_kwargs:
            self._risk.update_config(**risk_kwargs)

        return {
            "scanner": {
                "disabled_conditions": list(self._disabled_conditions),
                "sl_mult": self._sl_mult,
                "tp_mult": self._tp_mult,
            },
            "machine": self._machine.snapshot().config,
            "risk": self._risk.get_config(),
        }

    # ═══════════════════════════════════════════════════════════════
    # State accessors
    # ═══════════════════════════════════════════════════════════════

    @property
    def state(self) -> TradingState:
        return self._machine.state

    @property
    def mode(self) -> str:
        return self._machine.mode

    @property
    def trades(self) -> list[TradeRecord]:
        return self._machine.trades

    def get_full_state(self) -> dict:
        """Complete state for API — machine + risk + paper."""
        return {
            **self._snap(),
            "risk": self._risk.get_config(),
            "paper": self._paper.get_summary(),
        }

    def _snap(self) -> dict:
        return self._machine.snapshot().__dict__

    @staticmethod
    def _trade_dict(t: Optional[TradeRecord]) -> Optional[dict]:
        if t is None:
            return None
        return {
            "direction": t.direction,
            "entry_price": t.entry_price,
            "exit_price": t.exit_price,
            "stop_loss": t.stop_loss,
            "take_profit": t.take_profit,
            "qty": t.qty,
            "pnl": t.pnl,
            "exit_reason": t.exit_reason,
            "entry_time": t.entry_time,
            "exit_time": t.exit_time,
            "slippage": t.slippage,
            "is_paper": t.is_paper,
        }


# ── Singleton ───────────────────────────────────────────────────────
_traders: dict[str, FuturesAutoTrader] = {}
_traders_lock = threading.Lock()


def get_auto_trader(symbol: str = "MGC") -> FuturesAutoTrader:
    with _traders_lock:
        if symbol not in _traders:
            _traders[symbol] = FuturesAutoTrader(symbol)
        return _traders[symbol]
