"""
Tests for Live Trading auto-entry logic.
Covers: auto-polling cycle, position detection, SL/TP pass-through,
duplicate prevention, Open trade excluded until filled.
"""
from __future__ import annotations

import time
from dataclasses import dataclass
from datetime import datetime, timedelta

import pytest


# ── Mock types to replicate frontend/backend data ─────────────────
@dataclass
class MockOpenPosition:
    direction: str
    entry_price: float
    sl: float
    tp: float
    entry_time: str
    signal_type: str = "PULLBACK"


@dataclass
class MockExecuteResult:
    executed: bool
    order_id: str = ""
    status: str = "SUBMITTED"
    reason: str = ""


def simulate_auto_trading_cycle(
    bt_open_position: MockOpenPosition | None,
    tiger_current_qty: int,
    last_auto_entry: str,
    auto_trading: bool,
) -> dict:
    """Simulate one auto-trading cycle (same logic as Strategy5MinPanel useEffect).

    Returns dict with: should_execute, direction, sl, tp, entry_price, skip_reason
    """
    result = {
        "should_execute": False,
        "direction": "",
        "sl": 0.0,
        "tp": 0.0,
        "entry_price": 0.0,
        "skip_reason": "",
    }

    if not auto_trading:
        result["skip_reason"] = "auto_trading_off"
        return result

    pos = bt_open_position
    if pos is None or not pos.entry_time:
        result["skip_reason"] = "no_open_position"
        return result

    # Duplicate prevention
    if last_auto_entry == pos.entry_time:
        result["skip_reason"] = "already_executed"
        return result

    # Already holding on Tiger
    if abs(tiger_current_qty) > 0:
        result["skip_reason"] = "already_holding"
        return result

    # Execute!
    result["should_execute"] = True
    result["direction"] = pos.direction
    result["entry_price"] = pos.entry_price
    result["sl"] = pos.sl
    result["tp"] = pos.tp
    return result


def validate_bracket_params(direction: str, entry: float, sl: float, tp: float) -> list[str]:
    """Validate that SL/TP are on the correct side of entry for the direction."""
    errors = []
    if entry <= 0:
        errors.append("entry_price must be > 0")
    if sl <= 0:
        errors.append("sl must be > 0")
    if tp <= 0:
        errors.append("tp must be > 0")
    if direction == "CALL":
        if sl >= entry:
            errors.append(f"CALL SL ({sl}) must be below entry ({entry})")
        if tp <= entry:
            errors.append(f"CALL TP ({tp}) must be above entry ({entry})")
    elif direction == "PUT":
        if sl <= entry:
            errors.append(f"PUT SL ({sl}) must be above entry ({entry})")
        if tp >= entry:
            errors.append(f"PUT TP ({tp}) must be below entry ({entry})")
    return errors


# ── Tests ─────────────────────────────────────────────────────────

class TestAutoTradingToggle:
    """Auto-trading must only execute when toggle is ON."""

    def test_off_does_not_execute(self):
        pos = MockOpenPosition("CALL", 3300.0, 3280.0, 3320.0, "2026-04-10 10:00")
        result = simulate_auto_trading_cycle(pos, 0, "", auto_trading=False)
        assert result["should_execute"] is False
        assert result["skip_reason"] == "auto_trading_off"

    def test_on_with_signal_executes(self):
        pos = MockOpenPosition("CALL", 3300.0, 3280.0, 3320.0, "2026-04-10 10:00")
        result = simulate_auto_trading_cycle(pos, 0, "", auto_trading=True)
        assert result["should_execute"] is True
        assert result["direction"] == "CALL"

    def test_on_without_signal_skips(self):
        result = simulate_auto_trading_cycle(None, 0, "", auto_trading=True)
        assert result["should_execute"] is False
        assert result["skip_reason"] == "no_open_position"


class TestDuplicatePrevention:
    """Must not execute the same entry twice."""

    def test_same_entry_time_skipped(self):
        pos = MockOpenPosition("CALL", 3300.0, 3280.0, 3320.0, "2026-04-10 10:00")
        result = simulate_auto_trading_cycle(pos, 0, "2026-04-10 10:00", auto_trading=True)
        assert result["should_execute"] is False
        assert result["skip_reason"] == "already_executed"

    def test_new_entry_time_executes(self):
        pos = MockOpenPosition("CALL", 3300.0, 3280.0, 3320.0, "2026-04-10 10:15")
        result = simulate_auto_trading_cycle(pos, 0, "2026-04-10 10:00", auto_trading=True)
        assert result["should_execute"] is True

    def test_empty_last_entry_executes(self):
        pos = MockOpenPosition("PUT", 3300.0, 3320.0, 3280.0, "2026-04-10 10:00")
        result = simulate_auto_trading_cycle(pos, 0, "", auto_trading=True)
        assert result["should_execute"] is True


class TestPositionCheck:
    """Must not enter if already holding on Tiger."""

    def test_already_holding_long_skips(self):
        pos = MockOpenPosition("CALL", 3300.0, 3280.0, 3320.0, "2026-04-10 10:00")
        result = simulate_auto_trading_cycle(pos, 1, "", auto_trading=True)
        assert result["should_execute"] is False
        assert result["skip_reason"] == "already_holding"

    def test_already_holding_short_skips(self):
        pos = MockOpenPosition("PUT", 3300.0, 3320.0, 3280.0, "2026-04-10 10:00")
        result = simulate_auto_trading_cycle(pos, -1, "", auto_trading=True)
        assert result["should_execute"] is False
        assert result["skip_reason"] == "already_holding"

    def test_no_position_allows_entry(self):
        pos = MockOpenPosition("CALL", 3300.0, 3280.0, 3320.0, "2026-04-10 10:00")
        result = simulate_auto_trading_cycle(pos, 0, "", auto_trading=True)
        assert result["should_execute"] is True


class TestSLTPPassthrough:
    """SL and TP from backtest must be passed through to execution."""

    def test_call_sl_tp_correct(self):
        pos = MockOpenPosition("CALL", 3300.0, 3280.0, 3320.0, "2026-04-10 10:00")
        result = simulate_auto_trading_cycle(pos, 0, "", auto_trading=True)
        assert result["sl"] == 3280.0
        assert result["tp"] == 3320.0
        assert result["entry_price"] == 3300.0

    def test_put_sl_tp_correct(self):
        pos = MockOpenPosition("PUT", 3300.0, 3320.0, 3280.0, "2026-04-10 10:00")
        result = simulate_auto_trading_cycle(pos, 0, "", auto_trading=True)
        assert result["sl"] == 3320.0
        assert result["tp"] == 3280.0
        assert result["entry_price"] == 3300.0

    def test_direction_matches(self):
        long_pos = MockOpenPosition("CALL", 3300.0, 3280.0, 3320.0, "2026-04-10 10:00")
        short_pos = MockOpenPosition("PUT", 3300.0, 3320.0, 3280.0, "2026-04-10 10:05")
        r1 = simulate_auto_trading_cycle(long_pos, 0, "", auto_trading=True)
        r2 = simulate_auto_trading_cycle(short_pos, 0, "", auto_trading=True)
        assert r1["direction"] == "CALL"
        assert r2["direction"] == "PUT"


class TestBracketParamValidation:
    """SL/TP must be on correct side of entry."""

    def test_call_valid(self):
        errors = validate_bracket_params("CALL", 3300.0, 3280.0, 3320.0)
        assert errors == []

    def test_put_valid(self):
        errors = validate_bracket_params("PUT", 3300.0, 3320.0, 3280.0)
        assert errors == []

    def test_call_sl_above_entry_invalid(self):
        errors = validate_bracket_params("CALL", 3300.0, 3310.0, 3320.0)
        assert any("CALL SL" in e for e in errors)

    def test_call_tp_below_entry_invalid(self):
        errors = validate_bracket_params("CALL", 3300.0, 3280.0, 3290.0)
        assert any("CALL TP" in e for e in errors)

    def test_put_sl_below_entry_invalid(self):
        errors = validate_bracket_params("PUT", 3300.0, 3290.0, 3280.0)
        assert any("PUT SL" in e for e in errors)

    def test_put_tp_above_entry_invalid(self):
        errors = validate_bracket_params("PUT", 3300.0, 3320.0, 3310.0)
        assert any("PUT TP" in e for e in errors)

    def test_zero_entry_invalid(self):
        errors = validate_bracket_params("CALL", 0, 0, 0)
        assert len(errors) >= 3

    def test_negative_values_invalid(self):
        errors = validate_bracket_params("CALL", -1, -2, -3)
        assert len(errors) >= 3


class TestAutoTradingEdgeCases:
    """Edge cases for live trading logic."""

    def test_empty_entry_time_skips(self):
        pos = MockOpenPosition("CALL", 3300.0, 3280.0, 3320.0, "")
        result = simulate_auto_trading_cycle(pos, 0, "", auto_trading=True)
        assert result["should_execute"] is False
        assert result["skip_reason"] == "no_open_position"

    def test_multiple_cycles_only_first_executes(self):
        """Simulates multiple polling cycles — only first should execute."""
        pos = MockOpenPosition("CALL", 3300.0, 3280.0, 3320.0, "2026-04-10 10:00")

        # Cycle 1: fresh entry
        r1 = simulate_auto_trading_cycle(pos, 0, "", auto_trading=True)
        assert r1["should_execute"] is True

        # Cycle 2: same entry, now last_auto_entry updated
        r2 = simulate_auto_trading_cycle(pos, 0, "2026-04-10 10:00", auto_trading=True)
        assert r2["should_execute"] is False
        assert r2["skip_reason"] == "already_executed"

    def test_new_signal_after_exit_executes(self):
        """After position closes, new signal should execute."""
        pos1 = MockOpenPosition("CALL", 3300.0, 3280.0, 3320.0, "2026-04-10 10:00")
        pos2 = MockOpenPosition("PUT", 3310.0, 3330.0, 3290.0, "2026-04-10 14:30")

        # Execute first
        r1 = simulate_auto_trading_cycle(pos1, 0, "", auto_trading=True)
        assert r1["should_execute"] is True

        # Position filled on Tiger
        r_hold = simulate_auto_trading_cycle(pos1, 1, "2026-04-10 10:00", auto_trading=True)
        assert r_hold["should_execute"] is False

        # Position closed, new signal
        r2 = simulate_auto_trading_cycle(pos2, 0, "2026-04-10 10:00", auto_trading=True)
        assert r2["should_execute"] is True
        assert r2["direction"] == "PUT"
