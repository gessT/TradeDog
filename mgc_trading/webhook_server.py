"""
MGC Webhook Server — TradingView → Tiger Auto-Trader
=====================================================
Full-featured webhook server that receives TradingView alerts,
manages positions with SL/TP, and executes via Tiger API.

Supports TradingView alert formats:
  1. Strategy alerts:  {{strategy.order.action}}, {{strategy.order.price}}
  2. Custom alerts:    {"action":"BUY", "price":3050.0}
  3. Pine alerts:      {"action":"{{strategy.order.action}}", ...}

Usage:
    python -m mgc_trading.webhook_server
    python -m mgc_trading.webhook_server --paper       # paper mode
    python -m mgc_trading.webhook_server --qty 2       # fixed qty
"""
from __future__ import annotations

import argparse
import hmac
import json
import logging
import threading
import time
from dataclasses import dataclass, field
from datetime import datetime

from flask import Flask, Response, jsonify, request

from .config import (
    CONTRACT_SYMBOL,
    DEFAULT_PARAMS,
    SYMBOL_YF,
    WEBHOOK_HOST,
    WEBHOOK_PORT,
    WEBHOOK_SECRET,
)
from .data_loader import load_yfinance
from .strategy import MGCStrategy
from .tiger_execution import TigerTrader

logger = logging.getLogger(__name__)

app = Flask(__name__)


# ═══════════════════════════════════════════════════════════════════════
# Position Tracker
# ═══════════════════════════════════════════════════════════════════════

@dataclass
class Position:
    side: str              # "LONG"
    entry_price: float
    qty: int
    stop_loss: float
    take_profit: float
    entry_time: str
    order_id: str


@dataclass
class TradeLog:
    side: str
    entry_price: float
    exit_price: float
    qty: int
    pnl: float
    entry_time: str
    exit_time: str


# ═══════════════════════════════════════════════════════════════════════
# Server State
# ═══════════════════════════════════════════════════════════════════════

class ServerState:
    """Thread-safe global state for positions and trade history."""

    def __init__(self) -> None:
        self.trader: TigerTrader | None = None
        self.strategy = MGCStrategy(DEFAULT_PARAMS)
        self.position: Position | None = None
        self.trade_log: list[TradeLog] = []
        self.paper: bool = False
        self.default_qty: int = 1
        self._lock = threading.Lock()
        self.stats = {"signals": 0, "orders": 0, "wins": 0, "losses": 0}

    @property
    def win_rate(self) -> float:
        total = self.stats["wins"] + self.stats["losses"]
        return (self.stats["wins"] / total * 100) if total > 0 else 0.0

    @property
    def total_pnl(self) -> float:
        return sum(t.pnl for t in self.trade_log)


state = ServerState()


# ═══════════════════════════════════════════════════════════════════════
# Parse TradingView Alert  (supports many formats)
# ═══════════════════════════════════════════════════════════════════════

def parse_tv_alert(data: dict) -> dict:
    """Normalise various TradingView alert formats into a standard dict.

    Handles:
      - {"action":"BUY", "price":3050}                        (simple)
      - {"strategy.order.action":"buy", "close":3050}         (Pine vars)
      - {"alert":"buy MGC at 3050"}                           (text-based)
      - {"ticker":"MGC", "action":"buy", "sl":3030, "tp":3090}  (full)
    """
    result = {
        "symbol": CONTRACT_SYMBOL,
        "action": "",
        "price": 0.0,
        "qty": 0,
        "sl": 0.0,
        "tp": 0.0,
        "strategy": "",
    }

    # Symbol
    for key in ("symbol", "ticker", "contract"):
        if key in data:
            result["symbol"] = str(data[key]).upper().replace("=F", "")
            break

    # Action — try many common field names
    action_raw = ""
    for key in ("action", "side", "order", "strategy.order.action", "order_action"):
        if key in data:
            action_raw = str(data[key]).strip().upper()
            break

    # Map various action strings
    buy_words = {"BUY", "LONG", "ENTER_LONG", "ENTRY", "OPEN"}
    sell_words = {"SELL", "SHORT", "EXIT_LONG", "CLOSE", "CLOSE_LONG", "EXIT", "FLATTEN"}
    if action_raw in buy_words:
        result["action"] = "BUY"
    elif action_raw in sell_words:
        result["action"] = "SELL"
    else:
        result["action"] = action_raw  # pass through

    # Price
    for key in ("price", "close", "last", "strategy.order.price", "fill_price"):
        if key in data:
            try:
                result["price"] = float(data[key])
            except (ValueError, TypeError):
                pass
            break

    # Qty
    for key in ("qty", "quantity", "contracts", "size", "strategy.order.contracts"):
        if key in data:
            try:
                result["qty"] = int(float(data[key]))
            except (ValueError, TypeError):
                pass
            break

    # SL / TP (TradingView can send these)
    for key in ("sl", "stop_loss", "stoploss", "stop"):
        if key in data:
            try:
                result["sl"] = float(data[key])
            except (ValueError, TypeError):
                pass
            break
    for key in ("tp", "take_profit", "takeprofit", "target"):
        if key in data:
            try:
                result["tp"] = float(data[key])
            except (ValueError, TypeError):
                pass
            break

    result["strategy"] = str(data.get("strategy", data.get("alert_name", "")))

    return result


# ═══════════════════════════════════════════════════════════════════════
# ATR-based SL/TP from live data
# ═══════════════════════════════════════════════════════════════════════

def compute_sl_tp(entry_price: float) -> tuple[float, float]:
    """Fetch latest MGC data and compute ATR-based SL/TP levels."""
    try:
        df = load_yfinance(symbol=SYMBOL_YF, interval="15m", period="5d")
        df = state.strategy.compute_indicators(df)
        latest_atr = df["atr"].iloc[-1]
        sl = entry_price - DEFAULT_PARAMS["atr_sl_mult"] * latest_atr
        tp = entry_price + DEFAULT_PARAMS["atr_tp_mult"] * latest_atr
        logger.info("  ATR $%.2f → SL $%.2f  TP $%.2f", latest_atr, sl, tp)
        return sl, tp
    except Exception:
        logger.exception("Failed to compute SL/TP — using defaults")
        sl = entry_price * 0.995   # 0.5% below
        tp = entry_price * 1.008   # 0.8% above
        return sl, tp


# ═══════════════════════════════════════════════════════════════════════
# Health check
# ═══════════════════════════════════════════════════════════════════════

@app.route("/health", methods=["GET"])
def health() -> tuple[Response, int]:
    return jsonify({"status": "ok", "time": time.time()}), 200


# ═══════════════════════════════════════════════════════════════════════
# Dashboard — view position, stats, trade log
# ═══════════════════════════════════════════════════════════════════════

@app.route("/status", methods=["GET"])
def status() -> tuple[Response, int]:
    pos_info = None
    if state.position:
        p = state.position
        pos_info = {
            "side": p.side,
            "entry_price": p.entry_price,
            "qty": p.qty,
            "stop_loss": p.stop_loss,
            "take_profit": p.take_profit,
            "entry_time": p.entry_time,
            "order_id": p.order_id,
        }

    recent_trades = [
        {
            "side": t.side,
            "entry": t.entry_price,
            "exit": t.exit_price,
            "pnl": round(t.pnl, 2),
            "time": t.exit_time,
        }
        for t in state.trade_log[-10:]
    ]

    return jsonify({
        "mode": "PAPER" if state.paper else "LIVE",
        "position": pos_info,
        "stats": {
            **state.stats,
            "win_rate": round(state.win_rate, 1),
            "total_pnl": round(state.total_pnl, 2),
        },
        "recent_trades": recent_trades,
    }), 200


# ═══════════════════════════════════════════════════════════════════════
# Webhook endpoint — TradingView integration
# ═══════════════════════════════════════════════════════════════════════

@app.route("/webhook", methods=["POST"])
def webhook() -> tuple[Response, int]:
    """Receive TradingView alert → manage position → execute on Tiger.

    TradingView Alert Message (paste this in your TradingView alert):

        For strategy alerts:
        {
            "action": "{{strategy.order.action}}",
            "price": {{close}},
            "qty": {{strategy.order.contracts}},
            "ticker": "{{ticker}}"
        }

        For simple alerts:
        {"action": "BUY", "price": {{close}}}
        {"action": "SELL", "price": {{close}}}
    """
    # ── Auth ───────────────────────────────────────────────────────
    if WEBHOOK_SECRET:
        sig = request.headers.get("X-Signature", "")
        body = request.get_data()
        expected = hmac.new(WEBHOOK_SECRET.encode(), body, "sha256").hexdigest()
        if not hmac.compare_digest(sig, expected):
            logger.warning("🚫 Invalid signature — rejecting webhook")
            return jsonify({"error": "unauthorized"}), 401

    data = request.get_json(silent=True)
    if not data:
        return jsonify({"error": "invalid JSON body"}), 400

    # ── Parse TradingView alert ────────────────────────────────────
    alert = parse_tv_alert(data)
    state.stats["signals"] += 1

    action = alert["action"]
    price = alert["price"]
    qty = alert["qty"] if alert["qty"] > 0 else state.default_qty
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    logger.info("═" * 50)
    logger.info("📨 TradingView Alert #%d", state.stats["signals"])
    logger.info("   Action: %s  Price: $%.2f  Qty: %d", action, price, qty)

    if action not in ("BUY", "SELL"):
        return jsonify({"error": f"unknown action: {action}"}), 400

    if state.trader is None:
        return jsonify({"error": "trader not initialised"}), 503

    # ── BUY: open long position ────────────────────────────────────
    if action == "BUY":
        if state.position is not None:
            logger.info("   ⏭️ Already in position — ignoring BUY")
            return jsonify({"status": "already_in_position", "position": state.position.side}), 200

        # Compute SL/TP from real ATR data (or use alert-provided values)
        if alert["sl"] > 0 and alert["tp"] > 0:
            sl, tp = alert["sl"], alert["tp"]
            logger.info("   Using alert SL/TP: SL $%.2f  TP $%.2f", sl, tp)
        else:
            sl, tp = compute_sl_tp(price)

        # Place order
        result = _place_order(CONTRACT_SYMBOL, qty, "BUY", price)
        if result is None:
            return jsonify({"error": "order rejected or failed"}), 200

        state.position = Position(
            side="LONG",
            entry_price=price,
            qty=qty,
            stop_loss=sl,
            take_profit=tp,
            entry_time=now,
            order_id=result.order_id,
        )
        logger.info("   🟢 LONG opened ×%d @ $%.2f  SL $%.2f  TP $%.2f",
                     qty, price, sl, tp)

        return jsonify({
            "status": result.status,
            "order_id": result.order_id,
            "side": "BUY",
            "qty": qty,
            "stop_loss": round(sl, 2),
            "take_profit": round(tp, 2),
        }), 200

    # ── SELL: close long position ──────────────────────────────────
    if action == "SELL":
        if state.position is None:
            logger.info("   ⏭️ No open position — ignoring SELL")
            return jsonify({"status": "no_position"}), 200

        pos = state.position
        close_qty = pos.qty

        result = _place_order(CONTRACT_SYMBOL, close_qty, "SELL", price)
        if result is None:
            return jsonify({"error": "close order rejected or failed"}), 200

        # Calculate PnL
        pnl = (price - pos.entry_price) * close_qty * 10  # $10 per point per contract
        is_win = pnl > 0

        trade = TradeLog(
            side="LONG",
            entry_price=pos.entry_price,
            exit_price=price,
            qty=close_qty,
            pnl=pnl,
            entry_time=pos.entry_time,
            exit_time=now,
        )
        state.trade_log.append(trade)
        state.position = None

        if is_win:
            state.stats["wins"] += 1
            state.trader.record_win()
            logger.info("   🟢 WIN  PnL: +$%.2f", pnl)
        else:
            state.stats["losses"] += 1
            state.trader.record_loss()
            logger.info("   🔴 LOSS  PnL: -$%.2f", abs(pnl))

        logger.info("   Stats: %d W / %d L  (%.1f%%)  Total PnL: $%.2f",
                     state.stats["wins"], state.stats["losses"],
                     state.win_rate, state.total_pnl)

        return jsonify({
            "status": result.status,
            "order_id": result.order_id,
            "side": "SELL",
            "qty": close_qty,
            "pnl": round(pnl, 2),
            "win_rate": round(state.win_rate, 1),
        }), 200

    return jsonify({"error": "unexpected"}), 400


# ═══════════════════════════════════════════════════════════════════════
# SL/TP Monitor (background thread)
# ═══════════════════════════════════════════════════════════════════════

def _sl_tp_monitor() -> None:
    """Check every 30s if price hit SL or TP, auto-close if so."""
    while True:
        time.sleep(30)
        if state.position is None or state.trader is None:
            continue
        try:
            df = load_yfinance(symbol=SYMBOL_YF, interval="1m", period="1d")
            if df is None or df.empty:
                continue
            current_price = float(df["close"].iloc[-1])
            pos = state.position

            if current_price <= pos.stop_loss:
                logger.info("⚠️  SL HIT — price $%.2f <= SL $%.2f", current_price, pos.stop_loss)
                _auto_close(current_price, "STOP_LOSS")
            elif current_price >= pos.take_profit:
                logger.info("🎯 TP HIT — price $%.2f >= TP $%.2f", current_price, pos.take_profit)
                _auto_close(current_price, "TAKE_PROFIT")
            else:
                # Trailing stop update
                if DEFAULT_PARAMS.get("use_trailing") and current_price > pos.entry_price:
                    latest_atr = df["close"].rolling(14).std().iloc[-1] * 1.5  # quick ATR proxy
                    new_sl = current_price - DEFAULT_PARAMS["trailing_atr_mult"] * latest_atr
                    if new_sl > pos.stop_loss:
                        pos.stop_loss = new_sl
                        logger.info("📈 Trailing SL → $%.2f", new_sl)

        except Exception:
            logger.exception("SL/TP monitor error")


def _auto_close(exit_price: float, reason: str) -> None:
    """Auto-close position when SL/TP is hit."""
    pos = state.position
    if pos is None:
        return

    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    result = _place_order(CONTRACT_SYMBOL, pos.qty, "SELL", exit_price)

    pnl = (exit_price - pos.entry_price) * pos.qty * 10
    is_win = pnl > 0

    trade = TradeLog(
        side="LONG",
        entry_price=pos.entry_price,
        exit_price=exit_price,
        qty=pos.qty,
        pnl=pnl,
        entry_time=pos.entry_time,
        exit_time=now,
    )
    state.trade_log.append(trade)
    state.position = None

    if is_win:
        state.stats["wins"] += 1
        if state.trader:
            state.trader.record_win()
    else:
        state.stats["losses"] += 1
        if state.trader:
            state.trader.record_loss()

    logger.info("🔒 Auto-closed (%s): PnL $%.2f  [%d W / %d L = %.1f%%]",
                reason, pnl, state.stats["wins"], state.stats["losses"], state.win_rate)


# ═══════════════════════════════════════════════════════════════════════
# Order helper
# ═══════════════════════════════════════════════════════════════════════

def _place_order(symbol: str, qty: int, side: str, price: float):
    """Place order via Tiger (or paper-log)."""
    state.stats["orders"] += 1
    if state.trader is None:
        return None
    return state.trader.place_order(
        symbol=symbol,
        qty=qty,
        side=side,
        order_type="MKT",  # market orders for speed
    )


# ═══════════════════════════════════════════════════════════════════════
# Server start
# ═══════════════════════════════════════════════════════════════════════

def start_server(paper: bool = False, qty: int = 1) -> None:
    """Initialise Tiger trader and start Flask."""
    state.paper = paper
    state.default_qty = qty
    state.trader = TigerTrader()

    if paper:
        logger.info("🟡 PAPER-TRADE mode — no real orders sent to Tiger")
    else:
        state.trader.connect()

    # Start SL/TP background monitor
    monitor = threading.Thread(target=_sl_tp_monitor, daemon=True)
    monitor.start()
    logger.info("🛡️  SL/TP monitor started (checks every 30s)")

    logger.info("═" * 60)
    logger.info("  🚀  MGC TradingView Webhook Server")
    logger.info("  Endpoint: POST http://%s:%d/webhook", WEBHOOK_HOST, WEBHOOK_PORT)
    logger.info("  Dashboard: GET  http://%s:%d/status", WEBHOOK_HOST, WEBHOOK_PORT)
    logger.info("  Mode: %s  |  Default Qty: %d", "PAPER" if paper else "LIVE", qty)
    logger.info("  SL: %.1fx ATR  |  TP: %.1fx ATR",
                DEFAULT_PARAMS["atr_sl_mult"], DEFAULT_PARAMS["atr_tp_mult"])
    logger.info("═" * 60)
    logger.info("")
    logger.info("  📋 TradingView Alert Message (copy this):")
    logger.info('  {"action":"{{strategy.order.action}}","price":{{close}},"ticker":"{{ticker}}"}')
    logger.info("")

    app.run(host=WEBHOOK_HOST, port=WEBHOOK_PORT, debug=False)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s  %(levelname)s  %(message)s")

    parser = argparse.ArgumentParser(description="MGC TradingView Webhook Server")
    parser.add_argument("--paper", action="store_true", help="Paper-trade mode")
    parser.add_argument("--qty", type=int, default=1, help="Default contract qty")
    args = parser.parse_args()

    start_server(paper=args.paper, qty=args.qty)
