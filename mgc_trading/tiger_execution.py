"""
Tiger Open API — Execution Module
===================================
Handles connection, position sizing, order placement, and risk controls
for Micro Gold Futures (MGC) via Tiger Brokers demo or live account.

Requires: pip install tigeropen
If tigeropen is not installed, falls back to paper-trade logging.
"""
from __future__ import annotations

import hashlib
import logging
import time
from dataclasses import dataclass, field
from datetime import date

from .config import (
    CONTRACT_SIZE,
    MAX_CONSECUTIVE_LOSSES,
    MAX_DAILY_TRADES,
    RISK_PER_TRADE,
    TIGER_ACCOUNT,
    TIGER_ID,
    TIGER_IS_SANDBOX,
    TIGER_PRIVATE_KEY,
)

logger = logging.getLogger(__name__)

# ── Lazy Tiger SDK import ──────────────────────────────────────────
_tiger_available = False
try:
    from tigeropen.common.consts import Language, Market  # noqa: F401
    from tigeropen.common.util.signature_utils import read_private_key
    from tigeropen.tiger_open_config import TigerOpenClientConfig
    from tigeropen.trade.trade_client import TradeClient
    _tiger_available = True
except ImportError:
    logger.warning("tigeropen SDK not installed — using paper-trade mode")


# ═══════════════════════════════════════════════════════════════════════
# Data
# ═══════════════════════════════════════════════════════════════════════

@dataclass
class OrderRecord:
    timestamp: float
    symbol: str
    side: str
    qty: int
    price: float
    order_id: str
    status: str


# ═══════════════════════════════════════════════════════════════════════
# Tiger Trader
# ═══════════════════════════════════════════════════════════════════════

class TigerTrader:
    """Wrapper around Tiger Open API with built-in risk controls."""

    def __init__(
        self,
        tiger_id: str = TIGER_ID,
        private_key_path: str = TIGER_PRIVATE_KEY,
        account: str = TIGER_ACCOUNT,
        sandbox: bool = TIGER_IS_SANDBOX,
        risk_per_trade: float = RISK_PER_TRADE,
        max_consec_losses: int = MAX_CONSECUTIVE_LOSSES,
        max_daily_trades: int = MAX_DAILY_TRADES,
    ) -> None:
        self.tiger_id = tiger_id
        self.private_key_path = private_key_path
        self.account = account
        self.sandbox = sandbox
        self.risk_per_trade = risk_per_trade
        self.max_consec_losses = max_consec_losses
        self.max_daily_trades = max_daily_trades

        self._client: TradeClient | None = None  # type: ignore[name-defined]
        self._order_log: list[OrderRecord] = []
        self._recent_hashes: set[str] = set()
        self._consec_losses: int = 0
        self._daily_trades: dict[str, int] = {}

    # ── Connection ──────────────────────────────────────────────────
    def connect(self) -> bool:
        """Initialise Tiger API client. Returns True on success."""
        if not _tiger_available:
            logger.info("Paper-trade mode — no real connection")
            return True

        if not self.tiger_id or not self.private_key_path:
            logger.error("Tiger credentials not configured in config.py")
            return False

        try:
            config = TigerOpenClientConfig()
            config.tiger_id = self.tiger_id
            config.language = Language.en_US
            config.private_key = read_private_key(self.private_key_path)
            config.account = self.account
            self._client = TradeClient(config)
            logger.info("Connected to Tiger (account: %s)", self.account)
            return True
        except Exception:
            logger.exception("Failed to connect to Tiger API")
            return False

    # ── Account info ────────────────────────────────────────────────
    def get_account_balance(self) -> float:
        """Return current account cash balance (USD)."""
        if self._client is None:
            logger.warning("Not connected — returning default $50k")
            return 50_000.0
        try:
            assets = self._client.get_assets(account=self.account)
            for asset in assets:
                if hasattr(asset, "net_liquidation"):
                    return float(asset.net_liquidation)
            return 50_000.0
        except Exception:
            logger.exception("Failed to get account balance")
            return 50_000.0

    # ── Position sizing ─────────────────────────────────────────────
    def calculate_qty(self, entry_price: float, sl_price: float) -> int:
        """Risk-based position sizing: risk_per_trade % of account equity."""
        balance = self.get_account_balance()
        risk_amount = balance * self.risk_per_trade
        risk_per_contract = abs(entry_price - sl_price) * CONTRACT_SIZE
        if risk_per_contract <= 0:
            return 1
        qty = max(1, int(risk_amount / risk_per_contract))
        return qty

    # ── Duplicate prevention ────────────────────────────────────────
    def _order_hash(self, symbol: str, side: str, qty: int) -> str:
        """Deterministic hash to prevent duplicate orders within 60 s."""
        minute = int(time.time() / 60)
        raw = f"{symbol}:{side}:{qty}:{minute}"
        return hashlib.sha256(raw.encode()).hexdigest()[:16]

    # ── Risk gates ──────────────────────────────────────────────────
    def _check_risk_gates(self) -> bool:
        today = str(date.today())

        if self._consec_losses >= self.max_consec_losses:
            logger.warning("⚠️  Max consecutive losses (%d) reached — BLOCKING", self.max_consec_losses)
            return False

        if self._daily_trades.get(today, 0) >= self.max_daily_trades:
            logger.warning("⚠️  Max daily trades (%d) reached — BLOCKING", self.max_daily_trades)
            return False

        return True

    # ── Place order ─────────────────────────────────────────────────
    def place_order(
        self,
        symbol: str,
        qty: int,
        side: str = "BUY",
        order_type: str = "MKT",
        limit_price: float | None = None,
        retries: int = 3,
    ) -> OrderRecord | None:
        """Place an order via Tiger API (or paper-log if SDK absent).

        Args:
            symbol: e.g. "MGC2406" (specific contract) or "MGC" (front-month)
            qty: number of contracts
            side: "BUY" or "SELL"
            order_type: "MKT" or "LMT"
            limit_price: required for LMT orders
            retries: retry count on transient failures

        Returns:
            OrderRecord on success, None on failure.
        """
        # Duplicate guard
        h = self._order_hash(symbol, side, qty)
        if h in self._recent_hashes:
            logger.warning("Duplicate order blocked: %s %s ×%d", side, symbol, qty)
            return None
        self._recent_hashes.add(h)

        # Risk gates
        if not self._check_risk_gates():
            return None

        record = OrderRecord(
            timestamp=time.time(),
            symbol=symbol,
            side=side,
            qty=qty,
            price=limit_price or 0.0,
            order_id="",
            status="PENDING",
        )

        # ── Paper-trade fallback ────────────────────────────────────
        if self._client is None:
            record.order_id = f"PAPER-{int(time.time())}"
            record.status = "FILLED_PAPER"
            logger.info("📝 PAPER %s %s ×%d  @ %s", side, symbol, qty, limit_price or "MKT")
            self._register_fill(record)
            return record

        # ── Real Tiger execution ────────────────────────────────────
        from tigeropen.common.util.order_utils import market_order, limit_order

        for attempt in range(1, retries + 1):
            try:
                contracts = self._client.get_contracts(symbol, sec_type="FUT")
                if not contracts:
                    logger.error("No contract found for %s", symbol)
                    return None
                contract = contracts[0]
                contract.expiry = None  # deprecated in SDK v3.5.7

                if order_type == "LMT" and limit_price is not None:
                    order = limit_order(
                        account=self.account,
                        contract=contract,
                        action=side,
                        quantity=qty,
                        limit_price=limit_price,
                    )
                else:
                    order = market_order(
                        account=self.account,
                        contract=contract,
                        action=side,
                        quantity=qty,
                    )

                result = self._client.place_order(order)
                record.order_id = str(result)
                record.status = "SUBMITTED"
                logger.info("✅ ORDER %s %s ×%d → %s", side, symbol, qty, record.order_id)
                self._register_fill(record)
                return record

            except Exception:
                logger.exception("Order attempt %d/%d failed", attempt, retries)
                if attempt < retries:
                    time.sleep(2 ** attempt)

        record.status = "FAILED"
        logger.error("❌ Order FAILED after %d attempts", retries)
        return None

    # ── Post-fill bookkeeping ───────────────────────────────────────
    def _register_fill(self, record: OrderRecord) -> None:
        self._order_log.append(record)
        today = str(date.today())
        self._daily_trades[today] = self._daily_trades.get(today, 0) + 1

    def record_loss(self) -> None:
        """Call after a trade closes at a loss."""
        self._consec_losses += 1

    def record_win(self) -> None:
        """Call after a trade closes at a profit."""
        self._consec_losses = 0

    def reset_daily(self) -> None:
        """Clear daily trade counter (call at start of new session)."""
        today = str(date.today())
        self._daily_trades[today] = 0
        self._recent_hashes.clear()

    # ── Diagnostics ────────────────────────────────────────────────
    def print_log(self) -> None:
        print(f"\n{'═' * 60}")
        print(f"  📋  ORDER LOG  ({len(self._order_log)} orders)")
        print(f"{'═' * 60}")
        for rec in self._order_log:
            print(f"  {rec.side:4s}  {rec.symbol:10s}  ×{rec.qty}  "
                  f"${rec.price:.2f}  {rec.status}  [{rec.order_id}]")
        print(f"{'═' * 60}")
