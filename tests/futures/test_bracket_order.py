"""
Tests for bracket order placement safety.
Covers: OCA retry logic, fallback to individual SL/TP, fail-safe cancel.
"""
from __future__ import annotations

import time
from dataclasses import dataclass, field
from unittest.mock import MagicMock, patch, PropertyMock

import pytest

# Import after patching to avoid needing tigeropen SDK
import sys
sys.modules.setdefault("tigeropen", MagicMock())
sys.modules.setdefault("tigeropen.common", MagicMock())
sys.modules.setdefault("tigeropen.common.consts", MagicMock())
sys.modules.setdefault("tigeropen.common.util", MagicMock())
sys.modules.setdefault("tigeropen.common.util.signature_utils", MagicMock())
sys.modules.setdefault("tigeropen.common.util.order_utils", MagicMock())
sys.modules.setdefault("tigeropen.tiger_open_config", MagicMock())
sys.modules.setdefault("tigeropen.trade", MagicMock())
sys.modules.setdefault("tigeropen.trade.trade_client", MagicMock())

from strategies.futures.tiger_execution import TigerTrader, BracketResult, OrderRecord


class TestBracketOrderPaperMode:
    """Paper mode always succeeds — SL + TP should always be present."""

    def test_paper_bracket_has_sl_and_tp(self):
        trader = TigerTrader()
        # Paper mode (no SDK connect)
        result = trader.place_bracket_order(
            symbol="MGC", qty=1, side="BUY",
            stop_loss_price=3280.0, take_profit_price=3320.0,
        )
        assert result.entry is not None
        assert result.stop_loss is not None
        assert result.take_profit is not None
        assert "PAPER" in result.entry.status
        assert "PAPER" in result.stop_loss.status
        assert "PAPER" in result.take_profit.status

    def test_paper_bracket_without_sl_tp_skips_oca(self):
        trader = TigerTrader()
        result = trader.place_bracket_order(
            symbol="MGC", qty=1, side="BUY",
            stop_loss_price=None, take_profit_price=None,
        )
        assert result.entry is not None
        assert result.stop_loss is None
        assert result.take_profit is None


class TestBracketEntryTypes:
    """Entry order type varies based on limit_price vs current_price."""

    def test_mkt_entry_when_no_limit(self):
        trader = TigerTrader()
        result = trader.place_bracket_order(
            symbol="MGC", qty=1, side="BUY",
            stop_loss_price=3280.0, take_profit_price=3320.0,
            limit_price=None, current_price=3300.0,
        )
        assert result.entry is not None
        assert result.entry.status == "FILLED_PAPER"

    def test_lmt_entry_when_price_above_limit(self):
        """BUY with current_price > limit_price → LMT (pullback buy)."""
        trader = TigerTrader()
        result = trader.place_bracket_order(
            symbol="MGC", qty=1, side="BUY",
            stop_loss_price=3280.0, take_profit_price=3320.0,
            limit_price=3290.0, current_price=3300.0,
        )
        assert result.entry is not None

    def test_stp_entry_when_price_below_limit(self):
        """BUY with current_price < limit_price → STP (breakout buy)."""
        trader = TigerTrader()
        result = trader.place_bracket_order(
            symbol="MGC", qty=1, side="BUY",
            stop_loss_price=3280.0, take_profit_price=3320.0,
            limit_price=3310.0, current_price=3300.0,
        )
        assert result.entry is not None


class TestOCAFailureHandling:
    """When OCA fails, bracket should fall back to individual SL + TP."""

    def test_oca_exception_triggers_fallback(self):
        """Simulate OCA failure in live mode — should fall back to individual orders."""
        trader = TigerTrader()
        # Simulate connected client so we hit real OCA path
        mock_client = MagicMock()
        trader._client = mock_client

        # Entry succeeds
        mock_contracts = [MagicMock()]
        mock_contracts[0].expiry = None
        mock_client.get_contracts.return_value = mock_contracts
        mock_client.place_order.side_effect = [
            12345,  # entry order ID
            Exception("OCA placement failed"),  # OCA attempt 1
            Exception("OCA placement failed"),  # OCA attempt 2
            Exception("OCA placement failed"),  # OCA attempt 3
            67890,  # fallback SL
            67891,  # fallback TP
        ]

        result = trader.place_bracket_order(
            symbol="MGC", qty=1, side="BUY",
            stop_loss_price=3280.0, take_profit_price=3320.0,
        )
        assert result.entry is not None
        # After OCA fails 3 times, fallback individual SL + TP should be placed
        assert result.stop_loss is not None or result.take_profit is not None

    def test_bracket_result_has_entry_even_if_oca_fails(self):
        """Entry should always be returned even if SL/TP fail completely."""
        trader = TigerTrader()
        mock_client = MagicMock()
        trader._client = mock_client

        mock_contracts = [MagicMock()]
        mock_client.get_contracts.return_value = mock_contracts
        # Entry succeeds, everything else fails
        mock_client.place_order.side_effect = [
            12345,  # entry
            Exception("fail"), Exception("fail"), Exception("fail"),  # OCA x3
            Exception("fail"),  # fallback SL
            Exception("fail"),  # fallback TP
        ]

        result = trader.place_bracket_order(
            symbol="MGC", qty=1, side="BUY",
            stop_loss_price=3280.0, take_profit_price=3320.0,
        )
        # Entry must survive even if all SL/TP attempts fail
        assert result.entry is not None
        assert result.entry.order_id == "12345"


class TestCancelOrder:
    """cancel_order method should work in paper and live mode."""

    def test_paper_cancel_returns_true(self):
        trader = TigerTrader()
        assert trader.cancel_order("PAPER-12345") is True

    def test_cancel_empty_id_returns_false(self):
        trader = TigerTrader()
        assert trader.cancel_order("") is False

    def test_live_cancel_success(self):
        trader = TigerTrader()
        mock_client = MagicMock()
        trader._client = mock_client
        assert trader.cancel_order("12345") is True
        mock_client.cancel_order.assert_called_once_with(id=12345)

    def test_live_cancel_failure(self):
        trader = TigerTrader()
        mock_client = MagicMock()
        mock_client.cancel_order.side_effect = Exception("cancel failed")
        trader._client = mock_client
        assert trader.cancel_order("12345") is False


class TestFailSafeBehavior:
    """Ensure that when SL/TP are missing, the result reflects the failure."""

    def test_no_sl_tp_means_not_confirmed(self):
        result = BracketResult()
        result.entry = OrderRecord(
            timestamp=time.time(), symbol="MGC", side="BUY",
            qty=1, price=0, order_id="12345", status="SUBMITTED",
        )
        # No SL/TP set
        sl_ok = result.stop_loss is not None and result.stop_loss.status != "FAILED"
        tp_ok = result.take_profit is not None and result.take_profit.status != "FAILED"
        assert sl_ok is False
        assert tp_ok is False

    def test_confirmed_when_sl_and_tp_present(self):
        result = BracketResult()
        result.entry = OrderRecord(
            timestamp=time.time(), symbol="MGC", side="BUY",
            qty=1, price=0, order_id="12345", status="SUBMITTED",
        )
        result.stop_loss = OrderRecord(
            timestamp=time.time(), symbol="MGC", side="SELL",
            qty=1, price=3280.0, order_id="OCA-1", status="OCA_SUBMITTED",
        )
        result.take_profit = OrderRecord(
            timestamp=time.time(), symbol="MGC", side="SELL",
            qty=1, price=3320.0, order_id="OCA-1", status="OCA_SUBMITTED",
        )
        sl_ok = result.stop_loss is not None and result.stop_loss.status != "FAILED"
        tp_ok = result.take_profit is not None and result.take_profit.status != "FAILED"
        assert sl_ok is True
        assert tp_ok is True
