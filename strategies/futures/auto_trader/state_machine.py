"""
Trading State Machine — Core lifecycle for futures auto-trading
================================================================

States:
  IDLE       — No position, scanning for signals
  IN_TRADE   — Active position, monitoring SL/TP
  COOLDOWN   — Post-exit pause (prevents whipsaw re-entry)
  BLOCKED    — Risk limit hit (daily loss, consecutive losses) — manual reset needed

Transitions:
  IDLE      → IN_TRADE  : signal validated + risk approved + order filled
  IN_TRADE  → COOLDOWN  : TP/SL hit or manual exit
  COOLDOWN  → IDLE      : cooldown timer elapsed
  COOLDOWN  → BLOCKED   : risk engine flags limit breach
  BLOCKED   → IDLE      : manual reset only
  ANY       → IDLE      : emergency stop

Anti-patterns prevented:
  - Duplicate entries on same bar
  - Opposite signal while in position (ignored)
  - Re-entry during cooldown
  - Any entry when BLOCKED
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


class TradingState(str, Enum):
    IDLE = "IDLE"
    IN_TRADE = "IN_TRADE"
    COOLDOWN = "COOLDOWN"
    BLOCKED = "BLOCKED"


@dataclass
class SignalInfo:
    """Captured signal from scanner."""
    direction: str          # "CALL" / "PUT"
    signal_type: str        # "PULLBACK" / "BREAKOUT"
    entry_price: float
    stop_loss: float
    take_profit: float
    strength: int           # 1-10
    bar_time: str
    detected_at: float = 0.0
    is_fresh: bool = True
    bars_since_first: int = 0
    risk_reward: float = 0.0


@dataclass
class TradeRecord:
    """Completed trade record."""
    direction: str
    entry_price: float
    exit_price: float
    stop_loss: float
    take_profit: float
    qty: int
    pnl: float
    exit_reason: str        # "TP" / "SL" / "MANUAL" / "EMERGENCY"
    entry_time: str
    exit_time: str
    bar_time: str
    strength: int = 0
    slippage: float = 0.0
    is_paper: bool = False


@dataclass
class StateSnapshot:
    """Full state for API response."""
    state: str
    signal: Optional[dict] = None
    position: Optional[dict] = None
    trade_count: int = 0
    cooldown_remaining: float = 0.0
    last_exit_reason: str = ""
    daily_trades: int = 0
    daily_pnl: float = 0.0
    daily_wins: int = 0
    daily_losses: int = 0
    consecutive_losses: int = 0
    blocked_reason: str = ""
    started: bool = False
    mode: str = "off"       # "off" / "paper" / "live"
    config: dict = field(default_factory=dict)


class TradingStateMachine:
    """Thread-safe 4-state trading lifecycle.

    Does NOT execute orders — only manages state transitions.
    Execution is handled by the orchestrator (auto_trader.py).
    """

    def __init__(self, symbol: str = "MGC") -> None:
        self.symbol = symbol
        self._lock = threading.Lock()
        self._state = TradingState.IDLE
        self._started = False
        self._mode = "off"              # "off" / "paper" / "live"

        # Signal
        self._signal: Optional[SignalInfo] = None
        self._last_signal_bar: str = ""

        # Position tracking (mirror of execution engine)
        self._position_entry: float = 0.0
        self._position_sl: float = 0.0
        self._position_tp: float = 0.0
        self._position_qty: int = 0
        self._position_direction: str = ""
        self._position_entry_time: str = ""
        self._entry_fill_ts: float = 0.0  # time.time() when entry filled

        # Cooldown
        self._cooldown_end: float = 0.0
        self._cooldown_secs: float = 60.0
        self._cooldown_user_set: bool = False

        # Trade history
        self._trades: list[TradeRecord] = []
        self._last_exit_reason: str = ""

        # Daily tracking
        self._daily_limit: int = 10
        self._daily_count: int = 0
        self._daily_date: str = ""
        self._daily_pnl: float = 0.0
        self._daily_wins: int = 0
        self._daily_losses: int = 0

        # Consecutive loss tracking
        self._consec_losses: int = 0
        self._max_consec_losses: int = 3
        self._blocked_reason: str = ""

        # Signal quality gates
        self._min_strength: int = 3
        self._daily_loss_limit: float = 350.0  # $ max daily loss

    # ── Properties ──────────────────────────────────────────────────

    @property
    def state(self) -> TradingState:
        return self._state

    @property
    def started(self) -> bool:
        return self._started

    @property
    def mode(self) -> str:
        return self._mode

    @property
    def signal(self) -> Optional[SignalInfo]:
        return self._signal

    @property
    def trades(self) -> list[TradeRecord]:
        return list(self._trades)

    @property
    def consecutive_losses(self) -> int:
        return self._consec_losses

    # ── Start / Stop / Reset ────────────────────────────────────────

    def start(self, mode: str = "paper") -> None:
        """Activate the state machine. mode = 'paper' or 'live'."""
        with self._lock:
            if mode not in ("paper", "live"):
                mode = "paper"
            self._started = True
            self._mode = mode
            if self._state == TradingState.BLOCKED:
                self._state = TradingState.IDLE
                self._blocked_reason = ""
            elif self._state != TradingState.IN_TRADE:
                self._state = TradingState.IDLE
            self._reset_daily_if_needed()
            logger.info("[%s] State machine STARTED (mode=%s)", self.symbol, mode)

    def stop(self) -> None:
        """Deactivate — clears signal, keeps position if IN_TRADE."""
        with self._lock:
            self._started = False
            self._mode = "off"
            self._signal = None
            if self._state != TradingState.IN_TRADE:
                self._state = TradingState.IDLE
            logger.info("[%s] State machine STOPPED", self.symbol)

    def reset(self) -> None:
        """Full reset — WARNING: does not close positions on broker."""
        with self._lock:
            self._state = TradingState.IDLE
            self._started = False
            self._mode = "off"
            self._signal = None
            self._last_signal_bar = ""
            self._cooldown_end = 0.0
            self._position_entry = 0.0
            self._position_qty = 0
            self._position_direction = ""
            self._trades.clear()
            self._last_exit_reason = ""
            self._daily_count = 0
            self._daily_pnl = 0.0
            self._daily_wins = 0
            self._daily_losses = 0
            self._daily_date = ""
            self._consec_losses = 0
            self._blocked_reason = ""
            logger.info("[%s] State machine RESET", self.symbol)

    def emergency_stop(self) -> None:
        """Emergency: go to IDLE immediately, clear everything."""
        with self._lock:
            was_in_trade = self._state == TradingState.IN_TRADE
            self._state = TradingState.IDLE
            self._started = False
            self._mode = "off"
            self._signal = None
            self._position_entry = 0.0
            self._position_qty = 0
            self._position_direction = ""
            logger.warning("[%s] EMERGENCY STOP (was_in_trade=%s)", self.symbol, was_in_trade)

    # ── IDLE → IN_TRADE ────────────────────────────────────────────

    def accept_signal(self, scan_result) -> bool:
        """Evaluate signal for acceptance. Returns True if accepted.

        Does NOT trigger execution — caller must check and execute.
        """
        with self._lock:
            if not self._started or self._state != TradingState.IDLE:
                return False

            self._reset_daily_if_needed()

            # Gate: daily trade limit
            if self._daily_count >= self._daily_limit:
                logger.info("[%s] Daily trade limit reached (%d)", self.symbol, self._daily_limit)
                return False

            # Gate: daily loss limit
            if self._daily_loss_limit > 0 and self._daily_pnl <= -self._daily_loss_limit:
                self._state = TradingState.BLOCKED
                self._blocked_reason = f"daily_loss_limit (${self._daily_pnl:.2f})"
                logger.warning("[%s] BLOCKED: daily loss limit hit", self.symbol)
                return False

            # Gate: consecutive losses
            if self._consec_losses >= self._max_consec_losses:
                self._state = TradingState.BLOCKED
                self._blocked_reason = f"consecutive_losses ({self._consec_losses})"
                logger.warning("[%s] BLOCKED: %d consecutive losses", self.symbol, self._consec_losses)
                return False

            # Gate: signal strength
            if scan_result.strength < self._min_strength:
                return False

            # Gate: freshness
            if not scan_result.is_fresh and scan_result.bars_since_first > 1:
                return False

            # Gate: no duplicate bar
            if scan_result.bar_time == self._last_signal_bar:
                return False

            self._signal = SignalInfo(
                direction=scan_result.direction,
                signal_type=scan_result.signal_type,
                entry_price=scan_result.entry_price,
                stop_loss=scan_result.stop_loss,
                take_profit=scan_result.take_profit,
                strength=scan_result.strength,
                bar_time=scan_result.bar_time,
                detected_at=time.time(),
                is_fresh=scan_result.is_fresh,
                bars_since_first=scan_result.bars_since_first,
                risk_reward=getattr(scan_result, "risk_reward", 0.0),
            )
            self._last_signal_bar = scan_result.bar_time
            logger.info("[%s] Signal accepted: %s %s @ %.2f (str=%d)",
                        self.symbol, scan_result.direction, scan_result.signal_type,
                        scan_result.entry_price, scan_result.strength)
            return True

    def on_entry_filled(self, entry_price: float, sl: float, tp: float,
                        qty: int, direction: str) -> None:
        """Called when order fills → IDLE to IN_TRADE."""
        with self._lock:
            self._state = TradingState.IN_TRADE
            self._position_entry = entry_price
            self._position_sl = sl
            self._position_tp = tp
            self._position_qty = qty
            self._position_direction = direction
            self._position_entry_time = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
            self._entry_fill_ts = time.time()
            self._daily_count += 1
            logger.info("[%s] IDLE → IN_TRADE: %s %dx @ %.2f | SL=%.2f TP=%.2f",
                        self.symbol, direction, qty, entry_price, sl, tp)

    def cancel_signal(self) -> None:
        """Cancel pending signal (rejected by risk engine or execution failure)."""
        with self._lock:
            self._signal = None

    # ── IN_TRADE → COOLDOWN ────────────────────────────────────────

    def check_exit(self, live_price: float) -> Optional[str]:
        """Check if live price hits SL or TP. Returns reason or None."""
        with self._lock:
            if self._state != TradingState.IN_TRADE:
                return None
            if live_price <= 0:
                return None

            is_long = self._position_direction == "CALL"
            if is_long:
                if live_price <= self._position_sl:
                    return "SL"
                if live_price >= self._position_tp:
                    return "TP"
            else:
                if live_price >= self._position_sl:
                    return "SL"
                if live_price <= self._position_tp:
                    return "TP"
            return None

    def on_exit(self, exit_price: float, reason: str = "TP",
                contract_size: float = 10.0, slippage: float = 0.0,
                is_paper: bool = False) -> Optional[TradeRecord]:
        """Record exit → IN_TRADE to COOLDOWN. Returns trade record."""
        with self._lock:
            if self._state != TradingState.IN_TRADE:
                return None

            # P&L
            if self._position_direction == "CALL":
                raw_pnl = (exit_price - self._position_entry) * self._position_qty * contract_size
            else:
                raw_pnl = (self._position_entry - exit_price) * self._position_qty * contract_size
            pnl = round(raw_pnl - slippage, 2)

            now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
            trade = TradeRecord(
                direction=self._position_direction,
                entry_price=self._position_entry,
                exit_price=exit_price,
                stop_loss=self._position_sl,
                take_profit=self._position_tp,
                qty=self._position_qty,
                pnl=pnl,
                exit_reason=reason,
                entry_time=self._position_entry_time,
                exit_time=now,
                bar_time=self._signal.bar_time if self._signal else "",
                strength=self._signal.strength if self._signal else 0,
                slippage=slippage,
                is_paper=is_paper,
            )
            self._trades.append(trade)
            self._daily_pnl += pnl
            self._last_exit_reason = reason

            # Track wins/losses
            if pnl > 0:
                self._daily_wins += 1
                self._consec_losses = 0
            else:
                self._daily_losses += 1
                self._consec_losses += 1

            # Transition to COOLDOWN
            self._state = TradingState.COOLDOWN
            self._cooldown_end = time.time() + self._cooldown_secs
            self._signal = None
            self._position_entry = 0.0
            self._position_qty = 0
            self._position_direction = ""

            # Check if should BLOCK
            if self._consec_losses >= self._max_consec_losses:
                self._state = TradingState.BLOCKED
                self._blocked_reason = f"consecutive_losses ({self._consec_losses})"
                logger.warning("[%s] → BLOCKED after %d consecutive losses", self.symbol, self._consec_losses)
            elif self._daily_loss_limit > 0 and self._daily_pnl <= -self._daily_loss_limit:
                self._state = TradingState.BLOCKED
                self._blocked_reason = f"daily_loss_limit (${self._daily_pnl:.2f})"
                logger.warning("[%s] → BLOCKED: daily loss $%.2f", self.symbol, self._daily_pnl)

            logger.info("[%s] EXIT: %s pnl=$%.2f reason=%s | consec_losses=%d",
                        self.symbol, trade.direction, pnl, reason, self._consec_losses)
            return trade

    # ── COOLDOWN → IDLE ────────────────────────────────────────────

    def check_cooldown(self) -> bool:
        """Check if cooldown elapsed. Returns True if transitioned to IDLE."""
        with self._lock:
            if self._state != TradingState.COOLDOWN:
                return False
            if time.time() >= self._cooldown_end:
                self._state = TradingState.IDLE
                logger.info("[%s] COOLDOWN → IDLE", self.symbol)
                return True
            return False

    # ── BLOCKED → IDLE ─────────────────────────────────────────────

    def unblock(self) -> bool:
        """Manual unblock. Returns True if unblocked."""
        with self._lock:
            if self._state != TradingState.BLOCKED:
                return False
            self._state = TradingState.IDLE
            self._blocked_reason = ""
            self._consec_losses = 0
            logger.info("[%s] UNBLOCKED → IDLE", self.symbol)
            return True

    # ── Snapshot ────────────────────────────────────────────────────

    def snapshot(self) -> StateSnapshot:
        with self._lock:
            self._reset_daily_if_needed()
            cooldown = max(0, self._cooldown_end - time.time()) if self._state == TradingState.COOLDOWN else 0

            position = None
            if self._state == TradingState.IN_TRADE and self._position_qty > 0:
                position = {
                    "direction": self._position_direction,
                    "entry_price": self._position_entry,
                    "stop_loss": self._position_sl,
                    "take_profit": self._position_tp,
                    "qty": self._position_qty,
                    "entry_time": self._position_entry_time,
                }

            return StateSnapshot(
                state=self._state.value,
                signal=self._signal_to_dict(),
                position=position,
                trade_count=len(self._trades),
                cooldown_remaining=round(cooldown, 1),
                last_exit_reason=self._last_exit_reason,
                daily_trades=self._daily_count,
                daily_pnl=round(self._daily_pnl, 2),
                daily_wins=self._daily_wins,
                daily_losses=self._daily_losses,
                consecutive_losses=self._consec_losses,
                blocked_reason=self._blocked_reason,
                started=self._started,
                mode=self._mode,
                config={
                    "cooldown_secs": self._cooldown_secs,
                    "min_strength": self._min_strength,
                    "max_consec_losses": self._max_consec_losses,
                    "daily_limit": self._daily_limit,
                    "daily_loss_limit": self._daily_loss_limit,
                },
            )

    def update_config(self, **kwargs) -> dict:
        with self._lock:
            if "cooldown_secs" in kwargs:
                self._cooldown_secs = max(0, float(kwargs["cooldown_secs"]))
                self._cooldown_user_set = kwargs.get("_user_set", True)
            if "min_strength" in kwargs:
                self._min_strength = max(1, min(10, int(kwargs["min_strength"])))
            if "max_consec_losses" in kwargs:
                self._max_consec_losses = max(1, int(kwargs["max_consec_losses"]))
            if "daily_limit" in kwargs:
                self._daily_limit = max(1, int(kwargs["daily_limit"]))
            if "daily_loss_limit" in kwargs:
                self._daily_loss_limit = max(0, float(kwargs["daily_loss_limit"]))
            return {
                "cooldown_secs": self._cooldown_secs,
                "min_strength": self._min_strength,
                "max_consec_losses": self._max_consec_losses,
                "daily_limit": self._daily_limit,
                "daily_loss_limit": self._daily_loss_limit,
            }

    # ── Internals ───────────────────────────────────────────────────

    def _signal_to_dict(self) -> Optional[dict]:
        if self._signal is None:
            return None
        return {
            "direction": self._signal.direction,
            "signal_type": self._signal.signal_type,
            "entry_price": self._signal.entry_price,
            "stop_loss": self._signal.stop_loss,
            "take_profit": self._signal.take_profit,
            "strength": self._signal.strength,
            "bar_time": self._signal.bar_time,
            "is_fresh": self._signal.is_fresh,
            "risk_reward": self._signal.risk_reward,
        }

    def _reset_daily_if_needed(self) -> None:
        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        if self._daily_date != today:
            self._daily_date = today
            self._daily_count = 0
            self._daily_pnl = 0.0
            self._daily_wins = 0
            self._daily_losses = 0
            # Don't reset consec_losses — carries across days


# ── Singleton ───────────────────────────────────────────────────────
_machines: dict[str, TradingStateMachine] = {}
_machines_lock = threading.Lock()


def get_machine(symbol: str = "MGC") -> TradingStateMachine:
    with _machines_lock:
        if symbol not in _machines:
            _machines[symbol] = TradingStateMachine(symbol)
        return _machines[symbol]
