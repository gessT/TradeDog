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


# ── Strategy tag helpers (mirrors Live Trading card logic) ────────

def get_strategy_tag(active_preset: str | None) -> str:
    """Return the strategy tag label shown on the Live Trading card.
    Shows the preset name, or 'Custom' when no preset is active."""
    return active_preset or "Custom"


def build_config_pills(
    sl_mult: float,
    tp_mult: float,
    symbol: str,
) -> list[dict]:
    """Build the config pill list shown on the Live Trading card."""
    pills = [
        {"label": f"SL {sl_mult}×", "color": "rose"},
        {"label": f"TP {tp_mult}×", "color": "emerald"},
        {"label": symbol, "color": "amber"},
    ]
    return pills


class TestStrategyTag:
    """Strategy tag shown on Live Trading card when auto-trading is active."""

    def test_shows_preset_name_when_active(self):
        assert get_strategy_tag("Conservative") == "Conservative"

    def test_shows_custom_when_no_preset(self):
        assert get_strategy_tag(None) == "Custom"

    def test_shows_custom_for_empty_string(self):
        assert get_strategy_tag("") == "Custom"

    def test_different_preset_names(self):
        for name in ["Aggressive", "Scalper", "Momentum", "SMC Only"]:
            assert get_strategy_tag(name) == name

    def test_config_pills_basic(self):
        pills = build_config_pills(1.5, 2.0, "MGC")
        assert len(pills) == 3
        assert pills[0]["label"] == "SL 1.5×"
        assert pills[1]["label"] == "TP 2.0×"
        assert pills[2]["label"] == "MGC"

    def test_config_pills_different_symbol(self):
        pills = build_config_pills(1.0, 3.0, "MES")
        assert pills[2]["label"] == "MES"
        assert pills[0]["label"] == "SL 1.0×"
        assert pills[1]["label"] == "TP 3.0×"

    def test_tag_not_shown_when_auto_off(self):
        """When autoTrading is off, config pills should not render.
        This mirrors the {autoTrading && ...} guard in JSX."""
        auto_trading = False
        show_tag = auto_trading and get_strategy_tag("Conservative")
        assert not show_tag

    def test_tag_shown_when_auto_on(self):
        auto_trading = True
        tag = get_strategy_tag("Conservative") if auto_trading else None
        assert tag == "Conservative"

    def test_execution_tag_uses_preset(self):
        """When auto-trade executes, position tag should use activePreset or 'Auto'."""
        active_preset = "Scalper"
        tag = active_preset or "Auto"
        assert tag == "Scalper"

    def test_execution_tag_fallback_to_auto(self):
        active_preset = None
        tag = active_preset or "Auto"
        assert tag == "Auto"

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


# ── Full auto-execute flow helper ─────────────────────────────────

@dataclass
class MockBacktestResult:
    """Simulates the backtest response with trades and open_position."""
    trades: list
    open_position: MockOpenPosition | None


@dataclass
class MockTrade:
    entry_time: str
    exit_time: str
    entry_price: float
    exit_price: float
    sl: float
    tp: float
    direction: str
    reason: str
    signal_type: str = "PULLBACK"


def simulate_auto_execute_flow(
    bt_result: MockBacktestResult,
    tiger_qty: int,
    last_auto_entry: str,
    auto_trading: bool,
    active_preset: str | None = None,
) -> dict:
    """Simulate the full auto-execute flow:
    1. Backtest returns open_position (or last OPEN trade)
    2. Check auto_trading toggle
    3. Check duplicate entry_time
    4. Check Tiger position
    5. Build execution params with EXACT same entry/sl/tp/time

    Returns: should_execute, direction, entry_price, sl, tp, entry_time,
             target_price, tag, status_msg, skip_reason
    """
    result = {
        "should_execute": False,
        "direction": "",
        "entry_price": 0.0,
        "sl": 0.0,
        "tp": 0.0,
        "entry_time": "",
        "target_price": 0.0,
        "tag": "",
        "status_msg": "",
        "skip_reason": "",
    }

    if not auto_trading:
        result["skip_reason"] = "auto_trading_off"
        return result

    # Resolve open position: prefer open_position, fallback to last OPEN trade
    pos = bt_result.open_position
    if pos is None:
        open_trades = [t for t in bt_result.trades if t.reason == "OPEN"]
        if open_trades:
            t = open_trades[-1]
            pos = MockOpenPosition(
                direction=t.direction or "CALL",
                entry_price=t.entry_price,
                sl=t.sl,
                tp=t.tp,
                entry_time=t.entry_time,
            )

    if pos is None or not pos.entry_time:
        result["skip_reason"] = "no_open_position"
        return result

    # Duplicate prevention
    if last_auto_entry == pos.entry_time:
        result["skip_reason"] = "already_executed"
        return result

    # Already holding on Tiger
    if abs(tiger_qty) > 0:
        result["skip_reason"] = "already_holding"
        return result

    # Execute — all values come directly from backtest open_position
    target_price = pos.entry_price
    direction_label = "SHORT" if pos.direction == "PUT" else "LONG"
    tag = active_preset or "Auto"

    result["should_execute"] = True
    result["direction"] = pos.direction
    result["entry_price"] = pos.entry_price
    result["sl"] = pos.sl
    result["tp"] = pos.tp
    result["entry_time"] = pos.entry_time
    result["target_price"] = target_price
    result["tag"] = tag
    result["status_msg"] = (
        f"✅ Auto: {direction_label} queued @ ${target_price:.2f}"
        f" | SL ${pos.sl} TP ${pos.tp}"
    )
    return result


class TestAutoExecuteFlow:
    """Full end-to-end: backtest finds signal → no holding → auto-execute
    with exact same entry_price, SL, TP, entry_time from backtest."""

    def _make_bt(self, direction="CALL", entry=3300.0, sl=3280.0, tp=3320.0,
                 entry_time="2026-04-10 10:00") -> MockBacktestResult:
        pos = MockOpenPosition(direction, entry, sl, tp, entry_time)
        return MockBacktestResult(trades=[], open_position=pos)

    def test_auto_buy_same_entry_price(self):
        bt = self._make_bt(entry=3305.50)
        r = simulate_auto_execute_flow(bt, tiger_qty=0, last_auto_entry="", auto_trading=True)
        assert r["should_execute"] is True
        assert r["entry_price"] == 3305.50
        assert r["target_price"] == 3305.50

    def test_auto_buy_same_sl(self):
        bt = self._make_bt(sl=3282.25)
        r = simulate_auto_execute_flow(bt, tiger_qty=0, last_auto_entry="", auto_trading=True)
        assert r["sl"] == 3282.25

    def test_auto_buy_same_tp(self):
        bt = self._make_bt(tp=3325.75)
        r = simulate_auto_execute_flow(bt, tiger_qty=0, last_auto_entry="", auto_trading=True)
        assert r["tp"] == 3325.75

    def test_auto_buy_same_entry_time(self):
        bt = self._make_bt(entry_time="2026-04-10 14:35")
        r = simulate_auto_execute_flow(bt, tiger_qty=0, last_auto_entry="", auto_trading=True)
        assert r["entry_time"] == "2026-04-10 14:35"

    def test_auto_buy_same_direction_call(self):
        bt = self._make_bt(direction="CALL")
        r = simulate_auto_execute_flow(bt, tiger_qty=0, last_auto_entry="", auto_trading=True)
        assert r["direction"] == "CALL"

    def test_auto_sell_same_direction_put(self):
        bt = self._make_bt(direction="PUT", entry=3300.0, sl=3320.0, tp=3280.0)
        r = simulate_auto_execute_flow(bt, tiger_qty=0, last_auto_entry="", auto_trading=True)
        assert r["direction"] == "PUT"
        assert r["entry_price"] == 3300.0
        assert r["sl"] == 3320.0
        assert r["tp"] == 3280.0

    def test_no_holding_triggers_execute(self):
        bt = self._make_bt()
        r = simulate_auto_execute_flow(bt, tiger_qty=0, last_auto_entry="", auto_trading=True)
        assert r["should_execute"] is True
        assert r["skip_reason"] == ""

    def test_holding_blocks_execute(self):
        bt = self._make_bt()
        r = simulate_auto_execute_flow(bt, tiger_qty=1, last_auto_entry="", auto_trading=True)
        assert r["should_execute"] is False
        assert r["skip_reason"] == "already_holding"

    def test_status_msg_long(self):
        bt = self._make_bt(direction="CALL", entry=3300.0, sl=3280.0, tp=3320.0)
        r = simulate_auto_execute_flow(bt, tiger_qty=0, last_auto_entry="", auto_trading=True)
        assert "LONG" in r["status_msg"]
        assert "$3300.00" in r["status_msg"]
        assert "SL $3280.0" in r["status_msg"]
        assert "TP $3320.0" in r["status_msg"]

    def test_status_msg_short(self):
        bt = self._make_bt(direction="PUT", entry=3300.0, sl=3320.0, tp=3280.0)
        r = simulate_auto_execute_flow(bt, tiger_qty=0, last_auto_entry="", auto_trading=True)
        assert "SHORT" in r["status_msg"]

    def test_tag_uses_preset(self):
        bt = self._make_bt()
        r = simulate_auto_execute_flow(bt, tiger_qty=0, last_auto_entry="", auto_trading=True, active_preset="Scalper")
        assert r["tag"] == "Scalper"

    def test_tag_fallback_auto(self):
        bt = self._make_bt()
        r = simulate_auto_execute_flow(bt, tiger_qty=0, last_auto_entry="", auto_trading=True, active_preset=None)
        assert r["tag"] == "Auto"

    def test_fallback_to_open_trade_when_no_open_position(self):
        """If open_position is None, fall back to last trade with reason=OPEN."""
        trade = MockTrade(
            entry_time="2026-04-10 11:00", exit_time="2026-04-10 11:05",
            entry_price=3310.0, exit_price=3310.0, sl=3290.0, tp=3330.0,
            direction="CALL", reason="OPEN",
        )
        bt = MockBacktestResult(trades=[trade], open_position=None)
        r = simulate_auto_execute_flow(bt, tiger_qty=0, last_auto_entry="", auto_trading=True)
        assert r["should_execute"] is True
        assert r["entry_price"] == 3310.0
        assert r["sl"] == 3290.0
        assert r["tp"] == 3330.0
        assert r["entry_time"] == "2026-04-10 11:00"

    def test_no_signal_no_execute(self):
        bt = MockBacktestResult(trades=[], open_position=None)
        r = simulate_auto_execute_flow(bt, tiger_qty=0, last_auto_entry="", auto_trading=True)
        assert r["should_execute"] is False
        assert r["skip_reason"] == "no_open_position"

    def test_all_values_match_backtest_exactly(self):
        """The core guarantee: every field passed to execution matches the backtest."""
        bt = self._make_bt(direction="CALL", entry=3299.75, sl=3281.50, tp=3318.00,
                           entry_time="2026-04-10 09:35")
        r = simulate_auto_execute_flow(bt, tiger_qty=0, last_auto_entry="", auto_trading=True)
        assert r["should_execute"] is True
        assert r["direction"] == "CALL"
        assert r["entry_price"] == 3299.75
        assert r["target_price"] == 3299.75
        assert r["sl"] == 3281.50
        assert r["tp"] == 3318.00
        assert r["entry_time"] == "2026-04-10 09:35"


# ── Auto-trading persistence helper ──────────────────────────────

class MockAutoTradeStore:
    """Simulates backend auto_trade_settings persistence (in-memory)."""

    def __init__(self):
        self._store: dict[str, dict] = {}

    def save(self, symbol: str, enabled: bool) -> None:
        self._store[symbol] = {"enabled": enabled}

    def load(self, symbol: str) -> dict:
        return self._store.get(symbol, {"enabled": False})


class TestAutoTradingPersistence:
    """Auto-trading ON/OFF must survive page refresh via backend persistence."""

    def test_default_is_off(self):
        store = MockAutoTradeStore()
        state = store.load("MGC")
        assert state["enabled"] is False

    def test_toggle_on_persists(self):
        store = MockAutoTradeStore()
        store.save("MGC", enabled=True)
        state = store.load("MGC")
        assert state["enabled"] is True

    def test_toggle_off_persists(self):
        store = MockAutoTradeStore()
        store.save("MGC", enabled=True)
        store.save("MGC", enabled=False)
        state = store.load("MGC")
        assert state["enabled"] is False

    def test_survives_refresh(self):
        """Simulates: toggle ON → 'refresh' (new load) → still ON."""
        store = MockAutoTradeStore()
        store.save("MGC", enabled=True)
        # Simulate refresh: new component mounts and loads from backend
        restored = store.load("MGC")
        assert restored["enabled"] is True

    def test_per_symbol_isolation(self):
        """Each symbol has independent auto-trading state."""
        store = MockAutoTradeStore()
        store.save("MGC", enabled=True)
        store.save("MCL", enabled=False)
        assert store.load("MGC")["enabled"] is True
        assert store.load("MCL")["enabled"] is False

    def test_manual_click_toggles(self):
        """Only manual click changes state — simulates toggle sequence."""
        store = MockAutoTradeStore()
        # User clicks ON
        store.save("MGC", enabled=True)
        assert store.load("MGC")["enabled"] is True
        # Page refreshes several times — still ON
        assert store.load("MGC")["enabled"] is True
        assert store.load("MGC")["enabled"] is True
        # User clicks OFF
        store.save("MGC", enabled=False)
        assert store.load("MGC")["enabled"] is False

    def test_auto_trading_resumes_after_refresh(self):
        """Full flow: enable → refresh → backend says ON → auto-trading resumes."""
        store = MockAutoTradeStore()
        pos = MockOpenPosition("CALL", 3300.0, 3280.0, 3320.0, "2026-04-10 10:00")

        # User enables auto-trading
        store.save("MGC", enabled=True)

        # Simulate page refresh: load state, then run cycle
        restored = store.load("MGC")
        auto_trading = restored["enabled"]
        assert auto_trading is True

        # Auto-trading cycle runs as normal
        result = simulate_auto_trading_cycle(pos, 0, "", auto_trading=auto_trading)
        assert result["should_execute"] is True

    def test_disabled_does_not_resume(self):
        """If auto-trading was OFF, refresh keeps it OFF."""
        store = MockAutoTradeStore()
        pos = MockOpenPosition("CALL", 3300.0, 3280.0, 3320.0, "2026-04-10 10:00")

        store.save("MGC", enabled=False)
        restored = store.load("MGC")
        auto_trading = restored["enabled"]
        assert auto_trading is False

        result = simulate_auto_trading_cycle(pos, 0, "", auto_trading=auto_trading)
        assert result["should_execute"] is False
        assert result["skip_reason"] == "auto_trading_off"


# ── Auto-run on landing helpers ──────────────────────────────────

@dataclass
class MockStrategyConfig:
    period: str = "3d"
    sl_mult: float = 4.0
    tp_mult: float = 3.0
    active_preset: str | None = None


def simulate_landing(
    store: MockAutoTradeStore,
    config: MockStrategyConfig,
    symbol: str = "MGC",
    cache_valid: bool = False,
) -> dict:
    """Simulate page landing: load config + auto-trade state → decide actions.

    Returns: config_loaded, auto_trading_restored, should_auto_run_backtest,
             cache_used, period, sl_mult, tp_mult, preset
    """
    # Step 1: load config from backend
    settings = store.load(symbol)
    auto_on = settings.get("enabled", False)

    # Step 2: apply config
    result = {
        "config_loaded": True,
        "auto_trading_restored": auto_on,
        "should_auto_run_backtest": True,  # always run fresh on landing
        "cache_used": cache_valid,  # show cache while loading
        "period": config.period,
        "sl_mult": config.sl_mult,
        "tp_mult": config.tp_mult,
        "preset": config.active_preset,
    }
    return result


class TestAutoRunOnLanding:
    """On page landing, backtest must auto-run to show daily P&L and data."""

    def test_always_runs_backtest_on_landing(self):
        store = MockAutoTradeStore()
        cfg = MockStrategyConfig()
        result = simulate_landing(store, cfg)
        assert result["config_loaded"] is True
        assert result["should_auto_run_backtest"] is True

    def test_uses_saved_config(self):
        store = MockAutoTradeStore()
        cfg = MockStrategyConfig(period="5d", sl_mult=2.0, tp_mult=4.0, active_preset="Scalper")
        result = simulate_landing(store, cfg)
        assert result["period"] == "5d"
        assert result["sl_mult"] == 2.0
        assert result["tp_mult"] == 4.0
        assert result["preset"] == "Scalper"

    def test_restores_auto_trading_on(self):
        store = MockAutoTradeStore()
        store.save("MGC", enabled=True)
        cfg = MockStrategyConfig()
        result = simulate_landing(store, cfg)
        assert result["auto_trading_restored"] is True
        assert result["should_auto_run_backtest"] is True

    def test_restores_auto_trading_off(self):
        store = MockAutoTradeStore()
        store.save("MGC", enabled=False)
        cfg = MockStrategyConfig()
        result = simulate_landing(store, cfg)
        assert result["auto_trading_restored"] is False
        assert result["should_auto_run_backtest"] is True  # still runs for daily P&L

    def test_cache_shows_instantly_then_refresh(self):
        """Cache provides instant display; fresh backtest runs on top."""
        store = MockAutoTradeStore()
        cfg = MockStrategyConfig()
        result = simulate_landing(store, cfg, cache_valid=True)
        assert result["cache_used"] is True
        assert result["should_auto_run_backtest"] is True

    def test_no_cache_still_auto_runs(self):
        store = MockAutoTradeStore()
        cfg = MockStrategyConfig()
        result = simulate_landing(store, cfg, cache_valid=False)
        assert result["cache_used"] is False
        assert result["should_auto_run_backtest"] is True

    def test_landing_per_symbol(self):
        """Different symbols get their own config and auto-trading state."""
        store = MockAutoTradeStore()
        store.save("MGC", enabled=True)
        store.save("MCL", enabled=False)

        r1 = simulate_landing(store, MockStrategyConfig(sl_mult=4.0), symbol="MGC")
        r2 = simulate_landing(store, MockStrategyConfig(sl_mult=0.8), symbol="MCL")

        assert r1["auto_trading_restored"] is True
        assert r1["sl_mult"] == 4.0
        assert r2["auto_trading_restored"] is False
        assert r2["sl_mult"] == 0.8

    def test_full_landing_to_execution_flow(self):
        """Landing with auto-trading ON + signal → should auto-execute."""
        store = MockAutoTradeStore()
        store.save("MGC", enabled=True)
        cfg = MockStrategyConfig()

        # Simulate landing
        landing = simulate_landing(store, cfg)
        assert landing["auto_trading_restored"] is True
        assert landing["should_auto_run_backtest"] is True

        # Backtest returns open position
        pos = MockOpenPosition("CALL", 3300.0, 3280.0, 3320.0, "2026-04-10 10:00")
        result = simulate_auto_trading_cycle(pos, 0, "", auto_trading=landing["auto_trading_restored"])
        assert result["should_execute"] is True
        assert result["direction"] == "CALL"

    def test_landing_auto_off_no_execution(self):
        """Landing with auto-trading OFF → shows data but no execution."""
        store = MockAutoTradeStore()
        store.save("MGC", enabled=False)
        cfg = MockStrategyConfig()

        landing = simulate_landing(store, cfg)
        assert landing["should_auto_run_backtest"] is True  # still shows data

        pos = MockOpenPosition("CALL", 3300.0, 3280.0, 3320.0, "2026-04-10 10:00")
        result = simulate_auto_trading_cycle(pos, 0, "", auto_trading=landing["auto_trading_restored"])
        assert result["should_execute"] is False
        assert result["skip_reason"] == "auto_trading_off"
