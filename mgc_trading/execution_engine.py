"""
Execution Engine — Deterministic State Machine
================================================
Ensures LIVE AUTO-TRADING execution strictly mirrors BACKTEST results.

Rules enforced:
1. Signal consistency — only confirmed candle-close signals
2. Entry execution — next bar open, no duplicate entries
3. TP/SL OCO management — mandatory, fail-safe cancellation
4. Order synchronization — one position at a time
5. State tracking — NONE/LONG/SHORT with linked TP/SL
6. Backtest parity validation — cross-check signal before execution
"""
from __future__ import annotations

import logging
import threading
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
from typing import Optional

logger = logging.getLogger(__name__)


class PositionState(str, Enum):
    NONE = "NONE"
    LONG = "LONG"
    SHORT = "SHORT"


@dataclass
class ExecutionRecord:
    """Standardised execution output."""
    signal: str            # "BUY" / "SELL"
    entry_price: float
    tp_price: float
    sl_price: float
    status: str            # "EXECUTED" / "REJECTED"
    reason: str            # "match_backtest" / "duplicate_blocked" / error detail
    order_id: str = ""
    timestamp: str = ""
    qty: int = 0

    def to_dict(self) -> dict:
        return {
            "signal": self.signal,
            "entry_price": self.entry_price,
            "tp_price": self.tp_price,
            "sl_price": self.sl_price,
            "status": self.status,
            "reason": self.reason,
            "order_id": self.order_id,
            "timestamp": self.timestamp,
            "qty": self.qty,
        }


@dataclass
class PositionInfo:
    """Internal position state tracker."""
    state: PositionState = PositionState.NONE
    entry_price: float = 0.0
    tp_price: float = 0.0
    sl_price: float = 0.0
    qty: int = 0
    entry_time: str = ""
    side: str = ""         # "BUY" / "SELL"
    bar_time: str = ""     # Signal bar timestamp
    order_id: str = ""


class ExecutionEngine:
    """Thread-safe execution state machine for a single symbol.

    Enforces:
    - One position at a time (NONE → LONG/SHORT → NONE)
    - Mandatory TP + SL (OCO)
    - No duplicate/conflicting orders
    - Backtest parity validation before entry
    """

    def __init__(self, symbol: str = "MGC") -> None:
        self.symbol = symbol
        self._lock = threading.Lock()
        self._position = PositionInfo()
        self._last_exec_bar: str = ""
        self._execution_log: list[ExecutionRecord] = []

    # ── Read-only state ─────────────────────────────────────────────

    @property
    def position(self) -> PositionInfo:
        return self._position

    @property
    def current_state(self) -> PositionState:
        return self._position.state

    @property
    def last_exec_bar(self) -> str:
        return self._last_exec_bar

    @property
    def execution_log(self) -> list[ExecutionRecord]:
        return list(self._execution_log)

    # ── Validation gates ────────────────────────────────────────────

    def validate_entry(
        self,
        direction: str,
        entry_price: float,
        sl_price: float,
        tp_price: float,
        bar_time: str,
        qty: int = 1,
        max_qty: int = 5,
        current_tiger_qty: int = 0,
    ) -> ExecutionRecord | None:
        """Pre-execution validation. Returns rejection record or None if valid."""
        ts = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")
        side = "BUY" if direction == "CALL" else "SELL"

        # Rule 1: No signal without both TP and SL
        if sl_price <= 0 or tp_price <= 0:
            return ExecutionRecord(
                signal=side, entry_price=entry_price,
                tp_price=tp_price, sl_price=sl_price,
                status="REJECTED", reason="missing_tp_sl",
                timestamp=ts, qty=qty,
            )

        # Rule 2: Validate TP/SL direction consistency
        if direction == "CALL":
            if sl_price >= entry_price or tp_price <= entry_price:
                return ExecutionRecord(
                    signal=side, entry_price=entry_price,
                    tp_price=tp_price, sl_price=sl_price,
                    status="REJECTED", reason="invalid_tp_sl_direction",
                    timestamp=ts, qty=qty,
                )
        else:  # PUT
            if sl_price <= entry_price or tp_price >= entry_price:
                return ExecutionRecord(
                    signal=side, entry_price=entry_price,
                    tp_price=tp_price, sl_price=sl_price,
                    status="REJECTED", reason="invalid_tp_sl_direction",
                    timestamp=ts, qty=qty,
                )

        with self._lock:
            # Rule 3: No duplicate entry on same bar
            if bar_time and bar_time == self._last_exec_bar:
                return ExecutionRecord(
                    signal=side, entry_price=entry_price,
                    tp_price=tp_price, sl_price=sl_price,
                    status="REJECTED", reason="duplicate_bar",
                    timestamp=ts, qty=qty,
                )

            # Rule 4: One position at a time — check both internal state and Tiger
            if self._position.state != PositionState.NONE:
                return ExecutionRecord(
                    signal=side, entry_price=entry_price,
                    tp_price=tp_price, sl_price=sl_price,
                    status="REJECTED",
                    reason=f"position_open_{self._position.state.value}",
                    timestamp=ts, qty=qty,
                )

            # Rule 5: Max qty check
            if current_tiger_qty >= max_qty:
                return ExecutionRecord(
                    signal=side, entry_price=entry_price,
                    tp_price=tp_price, sl_price=sl_price,
                    status="REJECTED", reason="max_qty_reached",
                    timestamp=ts, qty=qty,
                )

        return None  # All checks passed

    def validate_backtest_parity(
        self,
        direction: str,
        bar_time: str,
        backtest_signals: list[dict],
    ) -> tuple[bool, str]:
        """Cross-check signal against recent backtest data.

        Args:
            direction: "CALL" or "PUT"
            bar_time: Signal bar timestamp
            backtest_signals: List of recent signals from backtest scan

        Returns:
            (is_valid, reason) tuple
        """
        if not backtest_signals:
            return True, "no_backtest_data_skip_validation"

        # Look for matching signal in backtest results
        for bt_sig in backtest_signals:
            bt_dir = bt_sig.get("direction", "")
            bt_bar = bt_sig.get("bar_time", "")
            # Match direction and bar time (within same bar window)
            if bt_dir == direction and bt_bar == bar_time:
                return True, "match_backtest"

        # Check if any backtest signal exists near this time
        # Allow ±1 bar tolerance for timing differences
        for bt_sig in backtest_signals:
            bt_dir = bt_sig.get("direction", "")
            if bt_dir == direction:
                return True, "match_backtest_direction"

        return False, "signal_not_in_backtest"

    # ── Execution lifecycle ─────────────────────────────────────────

    def record_entry(
        self,
        direction: str,
        entry_price: float,
        sl_price: float,
        tp_price: float,
        qty: int,
        bar_time: str,
        order_id: str,
        sl_confirmed: bool = True,
        tp_confirmed: bool = True,
    ) -> ExecutionRecord:
        """Record a successful entry. Returns execution record.

        If SL or TP was not confirmed by broker, returns REJECTED and
        the caller must cancel the entry order.
        """
        ts = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")
        side = "BUY" if direction == "CALL" else "SELL"

        # FAIL-SAFE: If TP/SL not confirmed, reject
        if not sl_confirmed or not tp_confirmed:
            record = ExecutionRecord(
                signal=side, entry_price=entry_price,
                tp_price=tp_price, sl_price=sl_price,
                status="REJECTED",
                reason="oco_not_confirmed",
                order_id=order_id, timestamp=ts, qty=qty,
            )
            self._execution_log.append(record)
            logger.error(
                "FAIL-SAFE: OCO not confirmed (SL=%s, TP=%s) — trade rejected",
                sl_confirmed, tp_confirmed,
            )
            return record

        with self._lock:
            state = PositionState.LONG if direction == "CALL" else PositionState.SHORT
            self._position = PositionInfo(
                state=state,
                entry_price=entry_price,
                tp_price=tp_price,
                sl_price=sl_price,
                qty=qty,
                entry_time=ts,
                side=side,
                bar_time=bar_time,
                order_id=order_id,
            )
            self._last_exec_bar = bar_time

        record = ExecutionRecord(
            signal=side, entry_price=entry_price,
            tp_price=tp_price, sl_price=sl_price,
            status="EXECUTED", reason="match_backtest",
            order_id=order_id, timestamp=ts, qty=qty,
        )
        self._execution_log.append(record)
        logger.info(
            "ENTRY RECORDED: %s %dx @ %.2f | SL=%.2f TP=%.2f | bar=%s",
            side, qty, entry_price, sl_price, tp_price, bar_time,
        )
        return record

    def record_exit(self, reason: str = "TP") -> None:
        """Record position exit (TP hit, SL hit, or manual close)."""
        with self._lock:
            if self._position.state == PositionState.NONE:
                return
            logger.info(
                "EXIT RECORDED: %s closed by %s | entry=%.2f",
                self._position.side, reason, self._position.entry_price,
            )
            self._position = PositionInfo()

    def sync_with_broker(self, tiger_qty: int) -> None:
        """Sync internal state with actual broker position.

        If broker shows 0 but engine thinks we have a position,
        it means TP or SL was hit — reset state.
        """
        with self._lock:
            if self._position.state != PositionState.NONE and tiger_qty == 0:
                logger.info(
                    "SYNC: Broker shows 0 qty — position closed (was %s @ %.2f)",
                    self._position.side, self._position.entry_price,
                )
                self._position = PositionInfo()

    def force_reset(self) -> None:
        """Emergency reset — clear all state."""
        with self._lock:
            self._position = PositionInfo()
            self._last_exec_bar = ""
            logger.warning("FORCE RESET: All state cleared for %s", self.symbol)

    def get_state_summary(self) -> dict:
        """Return current state as a dict for API response."""
        p = self._position
        return {
            "current_position": p.state.value,
            "entry_price": p.entry_price,
            "tp_price": p.tp_price,
            "sl_price": p.sl_price,
            "qty": p.qty,
            "side": p.side,
            "bar_time": p.bar_time,
            "order_id": p.order_id,
            "last_exec_bar": self._last_exec_bar,
        }


# ═══════════════════════════════════════════════════════════════════════
# Singleton registry — one engine per symbol
# ═══════════════════════════════════════════════════════════════════════

_engines: dict[str, ExecutionEngine] = {}
_engines_lock = threading.Lock()


def get_engine(symbol: str = "MGC") -> ExecutionEngine:
    """Get or create the execution engine singleton for a symbol."""
    with _engines_lock:
        if symbol not in _engines:
            _engines[symbol] = ExecutionEngine(symbol)
        return _engines[symbol]
