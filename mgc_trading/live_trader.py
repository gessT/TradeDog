"""
MGC Live Auto-Trader  (Real-Time via Tiger API)
================================================
Fetches real-time MGC futures bars from Tiger Open API, computes
strategy signals, and places orders automatically.

Data source priority:
  1. Tiger API  — real-time, no delay (requires connection)
  2. Yahoo Finance — fallback, 15-20 min delay for futures

Usage:
    python3 -m mgc_trading.live_trader
    python3 -m mgc_trading.live_trader --paper          # paper-trade only
    python3 -m mgc_trading.live_trader --interval 5m    # 5-minute bars
"""
from __future__ import annotations

import argparse
import logging
import signal
import sys
import time
from datetime import datetime, timedelta

import pandas as pd

from .config import (
    CONTRACT_SYMBOL,
    DEFAULT_PARAMS,
    INITIAL_CAPITAL,
    SYMBOL_YF,
    TIGER_ACCOUNT,
    TIGER_ID,
    TIGER_PRIVATE_KEY,
)
from .data_loader import load_yfinance
from .strategy import MGCStrategy
from .tiger_execution import TigerTrader

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-7s  %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger(__name__)

# ═══════════════════════════════════════════════════════════════════════
# Interval mappings
# ═══════════════════════════════════════════════════════════════════════
INTERVAL_SECONDS = {
    "1m": 60, "2m": 120, "5m": 300, "15m": 900, "30m": 1800, "60m": 3600, "1h": 3600,
}

# Tiger BarPeriod mapping
_TIGER_PERIOD_MAP: dict[str, str] = {}
try:
    from tigeropen.common.consts import BarPeriod, Language
    from tigeropen.common.util.signature_utils import read_private_key
    from tigeropen.tiger_open_config import TigerOpenClientConfig
    from tigeropen.quote.quote_client import QuoteClient
    from tigeropen.trade.trade_client import TradeClient

    _TIGER_PERIOD_MAP = {
        "1m": BarPeriod.ONE_MINUTE,
        "3m": BarPeriod.THREE_MINUTES,
        "5m": BarPeriod.FIVE_MINUTES,
        "10m": BarPeriod.TEN_MINUTES,
        "15m": BarPeriod.FIFTEEN_MINUTES,
        "30m": BarPeriod.HALF_HOUR,
        "45m": BarPeriod.FORTY_FIVE_MINUTES,
        "60m": BarPeriod.ONE_HOUR,
        "1h": BarPeriod.ONE_HOUR,
    }
    _tiger_sdk = True
except ImportError:
    _tiger_sdk = False


# ═══════════════════════════════════════════════════════════════════════
# Real-time data fetcher
# ═══════════════════════════════════════════════════════════════════════

class TigerDataFeed:
    """Fetch real-time futures bars from Tiger Open API."""

    def __init__(self) -> None:
        self._quote_client: QuoteClient | None = None
        self._identifier: str | None = None  # e.g. "MGC2606"

    def connect(self) -> bool:
        if not _tiger_sdk:
            logger.warning("Tiger SDK not available — will use Yahoo Finance")
            return False
        try:
            config = TigerOpenClientConfig()
            config.tiger_id = TIGER_ID
            config.language = Language.en_US
            config.private_key = read_private_key(TIGER_PRIVATE_KEY)
            config.account = TIGER_ACCOUNT
            self._quote_client = QuoteClient(config)

            # Resolve front-month contract identifier
            trade_client = TradeClient(config)
            contracts = trade_client.get_contracts(CONTRACT_SYMBOL, sec_type="FUT")
            if contracts:
                self._identifier = contracts[0].identifier
                logger.info("📡 Tiger real-time feed: %s (%s)",
                            self._identifier, contracts[0].name)
            else:
                logger.warning("No MGC contract found — using symbol directly")
                self._identifier = CONTRACT_SYMBOL

            return True
        except Exception:
            logger.exception("Failed to connect Tiger data feed")
            return False

    def get_bars(self, interval: str, count: int = 500) -> pd.DataFrame | None:
        """Fetch real-time bars. Returns DataFrame with open/high/low/close/volume."""
        if self._quote_client is None or self._identifier is None:
            return None

        period = _TIGER_PERIOD_MAP.get(interval)
        if period is None:
            logger.warning("Unsupported interval %s for Tiger — falling back", interval)
            return None

        try:
            df = self._quote_client.get_future_bars(
                self._identifier,
                period=period,
                limit=count,
            )
            if df is None or df.empty:
                return None

            # Normalise columns to match strategy expectations
            df.index = pd.to_datetime(df["time"], unit="ms")
            df = df.rename(columns={"open": "open", "high": "high", "low": "low",
                                     "close": "close", "volume": "volume"})
            df = df[["open", "high", "low", "close", "volume"]].copy()
            df = df.sort_index()
            return df

        except Exception:
            logger.exception("Tiger data fetch failed")
            return None

    @property
    def is_connected(self) -> bool:
        return self._quote_client is not None


class LiveTrader:
    """Continuously scans for signals and executes trades."""

    def __init__(
        self,
        interval: str = "15m",
        paper: bool = False,
        params: dict | None = None,
    ) -> None:
        self.interval = interval
        self.paper = paper
        self.params = {**DEFAULT_PARAMS, **(params or {})}
        self.strategy = MGCStrategy(self.params)
        self.trader = TigerTrader()
        self.data_feed = TigerDataFeed()
        self._use_tiger_data = False
        self._running = False
        self._last_signal_time: str | None = None
        self._position: str | None = None
        self._position_qty: int = 0
        self._entry_price: float = 0.0
        self._stop_loss: float = 0.0
        self._take_profit: float = 0.0

    # ── Connect ─────────────────────────────────────────────────────
    def start(self) -> None:
        """Connect to Tiger and begin the scan loop."""
        if self.paper:
            logger.info("🟡 PAPER-TRADE mode — no real orders")
        else:
            if not self.trader.connect():
                logger.error("Cannot connect to Tiger — falling back to paper mode")
                self.paper = True

        # Try to connect real-time data feed
        self._use_tiger_data = self.data_feed.connect()

        self._running = True
        logger.info("═" * 60)
        logger.info("  🚀  MGC Live Auto-Trader Started")
        logger.info("  Data:     %s", "Tiger API (REAL-TIME)" if self._use_tiger_data
                     else "Yahoo Finance (delayed)")
        logger.info("  Interval: %s  |  Strategy: Pullback + Momentum", self.interval)
        logger.info("  Params: EMA %d/%d  RSI %d  ATR SL %.1fx  TP %.1fx",
                     self.params["ema_fast"], self.params["ema_slow"],
                     self.params["rsi_period"],
                     self.params["atr_sl_mult"], self.params["atr_tp_mult"])
        logger.info("═" * 60)

        self._loop()

    def stop(self) -> None:
        logger.info("🛑 Stopping live trader...")
        self._running = False

    # ── Main loop ───────────────────────────────────────────────────
    def _loop(self) -> None:
        cycle_seconds = INTERVAL_SECONDS.get(self.interval, 900)
        # Small buffer after bar close so data is available
        wait_after_close = 10

        while self._running:
            try:
                self._scan_and_trade()
            except KeyboardInterrupt:
                self.stop()
                break
            except Exception:
                logger.exception("Error in scan cycle")

            # Sleep until next bar close + buffer
            sleep_sec = self._seconds_until_next_bar(cycle_seconds) + wait_after_close
            if sleep_sec > 0 and self._running:
                logger.info("💤 Next scan in %d s (%.1f min)", sleep_sec, sleep_sec / 60)
                # Sleep in small chunks so we can stop quickly
                end = time.time() + sleep_sec
                while time.time() < end and self._running:
                    time.sleep(min(5, end - time.time()))

    # ── Core scan logic ─────────────────────────────────────────────
    def _scan_and_trade(self) -> None:
        # Fetch data: Tiger real-time first, Yahoo fallback
        df = None
        if self._use_tiger_data:
            logger.info("📡 Fetching real-time data from Tiger API...")
            df = self.data_feed.get_bars(self.interval, count=500)
            if df is not None:
                logger.info("   Got %d bars (real-time)  [%s → %s]",
                            len(df), df.index[0], df.index[-1])

        if df is None:
            logger.info("📊 Fetching %s from Yahoo Finance (delayed)...", SYMBOL_YF)
            df = load_yfinance(symbol=SYMBOL_YF, interval=self.interval, period="5d")

        if df is None or len(df) < 120:
            logger.warning("Not enough data (%d bars), skipping", len(df) if df is not None else 0)
            return

        # Compute indicators + signals
        df = self.strategy.compute_indicators(df)
        df["signal"] = self.strategy.generate_signals(df)

        # Get latest completed bar (second-to-last, since last may be incomplete)
        latest = df.iloc[-2]
        bar_time = str(df.index[-2])

        # Show current market state
        logger.info(
            "  Bar: %s  Close: $%.2f  RSI: %.1f  ATR: $%.2f  Signal: %s",
            bar_time, latest["close"], latest["rsi"], latest["atr"],
            "🟢 BUY" if latest["signal"] == 1 else "—"
        )

        # ── Check exits first (if in position) ─────────────────────
        if self._position == "LONG":
            self._check_exit(latest)

        # ── Check entry (if no position) ───────────────────────────
        if self._position is None and latest["signal"] == 1:
            if bar_time == self._last_signal_time:
                logger.info("  ⏭️  Already acted on this bar, skipping")
                return
            self._last_signal_time = bar_time
            self._enter_long(latest)

    # ── Enter long ──────────────────────────────────────────────────
    def _enter_long(self, bar: pd.Series) -> None:
        entry = bar["close"]
        atr_val = bar["atr"]
        sl = entry - self.params["atr_sl_mult"] * atr_val
        tp = entry + self.params["atr_tp_mult"] * atr_val

        # Position sizing
        qty = self.trader.calculate_qty(entry, sl)

        logger.info("  🟢 ENTRY SIGNAL — BUY ×%d @ $%.2f  SL $%.2f  TP $%.2f", qty, entry, sl, tp)

        if self.paper:
            logger.info("  📝 PAPER BUY ×%d @ $%.2f", qty, entry)
            self._position = "LONG"
            self._position_qty = qty
            self._entry_price = entry
            self._stop_loss = sl
            self._take_profit = tp
        else:
            record = self.trader.place_order(
                symbol=CONTRACT_SYMBOL,
                qty=qty,
                side="BUY",
                order_type="MKT",
            )
            if record and record.status in ("SUBMITTED", "FILLED_PAPER"):
                self._position = "LONG"
                self._position_qty = qty
                self._entry_price = entry
                self._stop_loss = sl
                self._take_profit = tp

    # ── Check exit conditions ───────────────────────────────────────
    def _check_exit(self, bar: pd.Series) -> None:
        price = bar["close"]
        atr_val = bar["atr"]

        # Trailing stop update
        if self.params.get("use_trailing") and price > self._entry_price:
            new_sl = price - self.params["trailing_atr_mult"] * atr_val
            if new_sl > self._stop_loss:
                self._stop_loss = new_sl
                logger.info("  📈 Trailing SL updated to $%.2f", self._stop_loss)

        pnl_pct = (price - self._entry_price) / self._entry_price * 100

        # Stop-loss hit
        if price <= self._stop_loss:
            logger.info("  🔴 STOP-LOSS HIT @ $%.2f  (PnL: %.2f%%)", price, pnl_pct)
            self._exit_position("SELL", price)
            self.trader.record_loss()
            return

        # Take-profit hit
        if price >= self._take_profit:
            logger.info("  🟢 TAKE-PROFIT HIT @ $%.2f  (PnL: +%.2f%%)", price, pnl_pct)
            self._exit_position("SELL", price)
            self.trader.record_win()
            return

        logger.info("  📍 In position: Entry $%.2f  Now $%.2f  PnL %.2f%%  SL $%.2f  TP $%.2f",
                     self._entry_price, price, pnl_pct, self._stop_loss, self._take_profit)

    # ── Exit position ───────────────────────────────────────────────
    def _exit_position(self, side: str, price: float) -> None:
        qty = self._position_qty or 1
        if self.paper:
            logger.info("  📝 PAPER %s ×%d @ $%.2f", side, qty, price)
        else:
            self.trader.place_order(
                symbol=CONTRACT_SYMBOL,
                qty=qty,
                side=side,
                order_type="MKT",
            )
        self._position = None
        self._position_qty = 0
        self._entry_price = 0.0
        self._stop_loss = 0.0
        self._take_profit = 0.0

    # ── Time helpers ────────────────────────────────────────────────
    @staticmethod
    def _seconds_until_next_bar(cycle_seconds: int) -> int:
        now = time.time()
        elapsed = now % cycle_seconds
        return max(0, int(cycle_seconds - elapsed))


# ═══════════════════════════════════════════════════════════════════════
# CLI
# ═══════════════════════════════════════════════════════════════════════

def main() -> None:
    parser = argparse.ArgumentParser(description="MGC Live Auto-Trader")
    parser.add_argument("--interval", default="15m", help="Bar interval (1m/5m/15m/30m/1h)")
    parser.add_argument("--paper", action="store_true", help="Paper-trade only, no real orders")
    args = parser.parse_args()

    trader = LiveTrader(interval=args.interval, paper=args.paper)

    # Graceful shutdown
    def handle_signal(signum, frame):
        trader.stop()
    signal.signal(signal.SIGINT, handle_signal)
    signal.signal(signal.SIGTERM, handle_signal)

    trader.start()


if __name__ == "__main__":
    main()
