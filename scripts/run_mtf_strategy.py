#!/usr/bin/env python3
"""
CLI runner for MTF Strategy
============================
Usage:
    python3 scripts/run_mtf_strategy.py AAPL
    python3 scripts/run_mtf_strategy.py AAPL --period 2y
    python3 scripts/run_mtf_strategy.py --screen            # scan 10 hot-pick stocks
"""
from __future__ import annotations

import argparse
import logging
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from strategies.futures.data_loader import load_yfinance
from strategies.us_stock.mtf.config import DEFAULT_MTF_PARAMS, HOT_SYMBOLS
from strategies.us_stock.mtf.backtest import MTFBacktester

logging.basicConfig(level=logging.INFO, format="%(message)s")
logger = logging.getLogger(__name__)


def run_single(symbol: str, period: str, capital: float, params: dict | None = None):
    """Run MTF backtest for a single symbol."""
    logger.info("=" * 60)
    logger.info("MTF Strategy Backtest: %s  (period=%s, capital=$%.0f)", symbol, period, capital)
    logger.info("=" * 60)

    # Load both timeframes
    logger.info("\n📊 Loading daily data...")
    df_daily = load_yfinance(symbol=symbol, interval="1d", period=period)
    logger.info("📊 Loading 4H data...")

    # yfinance: 4h data max ~730 days for "2y". For longer, we use "1y" or "2y"
    # Note: yfinance interval "4h" is not supported – we use "1h" and resample
    df_1h = load_yfinance(symbol=symbol, interval="1h", period=period)

    # Resample 1H → 4H
    df_4h = df_1h.resample("4h").agg({
        "open": "first",
        "high": "max",
        "low": "min",
        "close": "last",
        "volume": "sum",
    }).dropna(subset=["close"])
    logger.info("Resampled 1H → 4H: %d bars", len(df_4h))

    bt = MTFBacktester(capital=capital)
    result = bt.run(df_4h, df_daily, params=params)

    logger.info("\n" + "─" * 50)
    logger.info("📈 RESULTS")
    logger.info("─" * 50)
    logger.info("Trades:       %d", result.total_trades)
    logger.info("Win Rate:     %.1f%%", result.win_rate)
    logger.info("ROI:          %.2f%%", result.total_return_pct)
    logger.info("Profit Factor: %.2f", result.profit_factor)
    logger.info("Max Drawdown: %.2f%%", result.max_drawdown_pct)
    logger.info("Sharpe:       %.2f", result.sharpe_ratio)
    logger.info("Avg Win:      $%.2f", result.avg_win)
    logger.info("Avg Loss:     $%.2f", result.avg_loss)
    logger.info("Final Equity: $%.2f", result.final_equity)

    if result.trades:
        logger.info("\n📋 Last 10 trades:")
        logger.info("%-20s %-20s %8s %8s %8s %6s %s", "Entry", "Exit", "Entry$", "Exit$", "P&L", "R", "Reason")
        for t in result.trades[-10:]:
            logger.info(
                "%-20s %-20s %8.2f %8.2f %+8.2f %+5.1fR %s",
                str(t.entry_time)[:19], str(t.exit_time)[:19],
                t.entry_price, t.exit_price, t.pnl, t.r_multiple, t.reason,
            )

    return result


def run_screen(period: str, capital: float):
    """Screen all hot-pick stocks."""
    logger.info("=" * 60)
    logger.info("MTF Strategy — 10-Stock Screen  (period=%s)", period)
    logger.info("=" * 60)

    results = []
    for sym in HOT_SYMBOLS:
        try:
            r = run_single(sym, period, capital)
            results.append((sym, r))
        except Exception as e:
            logger.error("❌ %s failed: %s", sym, e)

    # Summary table
    logger.info("\n" + "═" * 70)
    logger.info("SUMMARY — Sorted by Win Rate")
    logger.info("═" * 70)
    logger.info("%-8s %6s %6s %8s %6s %6s %8s", "Symbol", "WR%", "Trades", "ROI%", "PF", "DD%", "Sharpe")
    results.sort(key=lambda x: x[1].win_rate, reverse=True)
    for sym, r in results:
        logger.info(
            "%-8s %5.1f%% %6d %+7.1f%% %6.2f %5.1f%% %7.2f",
            sym, r.win_rate, r.total_trades, r.total_return_pct,
            r.profit_factor, r.max_drawdown_pct, r.sharpe_ratio,
        )


def main():
    parser = argparse.ArgumentParser(description="MTF Strategy Runner")
    parser.add_argument("symbol", nargs="?", default="AAPL")
    parser.add_argument("--period", default="2y")
    parser.add_argument("--capital", type=float, default=5000)
    parser.add_argument("--screen", action="store_true", help="Screen 10 hot-pick stocks")
    args = parser.parse_args()

    if args.screen:
        run_screen(args.period, args.capital)
    else:
        run_single(args.symbol, args.period, args.capital)


if __name__ == "__main__":
    main()
