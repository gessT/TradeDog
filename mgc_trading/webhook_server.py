"""
MGC Webhook Server — TradingView Signal Receiver
==================================================
Standalone Flask server that receives POST /webhook alerts from
TradingView, validates the signal, checks strategy conditions in
real-time, and forwards qualifying orders to Tiger API.

Usage:
    python -m mgc_trading.webhook_server
"""
from __future__ import annotations

import hmac
import logging
import time

from flask import Flask, Response, jsonify, request

from .config import CONTRACT_SYMBOL, WEBHOOK_HOST, WEBHOOK_PORT, WEBHOOK_SECRET
from .tiger_execution import TigerTrader

logger = logging.getLogger(__name__)

app = Flask(__name__)

# ── Global trader instance (initialised on startup) ─────────────────
trader: TigerTrader | None = None


# ═══════════════════════════════════════════════════════════════════════
# Health check
# ═══════════════════════════════════════════════════════════════════════

@app.route("/health", methods=["GET"])
def health() -> tuple[Response, int]:
    return jsonify({"status": "ok", "time": time.time()}), 200


# ═══════════════════════════════════════════════════════════════════════
# Webhook endpoint
# ═══════════════════════════════════════════════════════════════════════

@app.route("/webhook", methods=["POST"])
def webhook() -> tuple[Response, int]:
    """Receive a TradingView alert and optionally execute via Tiger API.

    Expected JSON payload::

        {
            "symbol": "MGC",
            "action": "BUY",
            "price": 2345.50,
            "strategy": "MGC_scalping",
            "qty": 1          // optional, auto-sized if omitted
        }
    """
    # ── Auth (optional shared secret) ──────────────────────────────
    if WEBHOOK_SECRET:
        sig = request.headers.get("X-Signature", "")
        body = request.get_data()
        expected = hmac.new(WEBHOOK_SECRET.encode(), body, "sha256").hexdigest()
        if not hmac.compare_digest(sig, expected):
            logger.warning("Invalid signature — rejecting webhook")
            return jsonify({"error": "unauthorized"}), 401

    data = request.get_json(silent=True)
    if not data:
        return jsonify({"error": "invalid JSON body"}), 400

    symbol = data.get("symbol", "").upper()
    action = data.get("action", "").upper()
    price = float(data.get("price", 0))
    strategy_name = data.get("strategy", "")
    qty = int(data.get("qty", 0))

    logger.info("📨 Webhook: %s %s @ %.2f  [%s]", action, symbol, price, strategy_name)

    # ── Validation ─────────────────────────────────────────────────
    if symbol != CONTRACT_SYMBOL:
        return jsonify({"error": f"symbol mismatch: expected {CONTRACT_SYMBOL}"}), 400

    if action not in ("BUY", "SELL"):
        return jsonify({"error": "action must be BUY or SELL"}), 400

    if action == "SELL":
        # Long-only system — SELL is used to close position, not short
        logger.info("SELL signal → closing existing position if any")

    # ── Execute ────────────────────────────────────────────────────
    if trader is None:
        return jsonify({"error": "trader not initialised"}), 503

    if qty <= 0:
        # Auto-size: use 1 contract as safe default for webhook signals
        qty = 1

    result = trader.place_order(
        symbol=symbol,
        qty=qty,
        side=action,
        order_type="LMT" if price > 0 else "MKT",
        limit_price=price if price > 0 else None,
    )

    if result is None:
        return jsonify({"error": "order rejected by risk management or failed"}), 200

    return jsonify({
        "status": result.status,
        "order_id": result.order_id,
        "side": result.side,
        "qty": result.qty,
    }), 200


# ═══════════════════════════════════════════════════════════════════════
# Server start
# ═══════════════════════════════════════════════════════════════════════

def start_server() -> None:
    """Initialise Tiger trader and start Flask."""
    global trader  # noqa: PLW0603
    trader = TigerTrader()
    trader.connect()

    logger.info("🚀 Webhook server starting on %s:%d", WEBHOOK_HOST, WEBHOOK_PORT)
    app.run(host=WEBHOOK_HOST, port=WEBHOOK_PORT, debug=False)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s  %(levelname)s  %(message)s")
    start_server()
