#!/usr/bin/env python3
"""
MGC Trading System — Main Entry Point
=======================================
Run this script to:
  1. Load Micro Gold Futures data (from yfinance or JSON)
  2. Backtest with default parameters
  3. Run grid-search optimisation
  4. Print results + best parameter set

Usage:
    python -m mgc_trading.run_backtest                     # yfinance default
    python -m mgc_trading.run_backtest --json data/mgc.json
    python -m mgc_trading.run_backtest --interval 5m
    python -m mgc_trading.run_backtest --optimize           # run optimizer
"""
from __future__ import annotations

import argparse
import logging
import sys

from .backtest import Backtester, print_result
from .config import DEFAULT_PARAMS, INITIAL_CAPITAL
from .data_loader import load_csv, load_json, load_yfinance
from .optimizer import optimize, print_top_results

logging.basicConfig(level=logging.INFO, format="%(asctime)s  %(levelname)s  %(message)s")
logger = logging.getLogger(__name__)


# ═══════════════════════════════════════════════════════════════════════
# Strategy description
# ═══════════════════════════════════════════════════════════════════════

STRATEGY_DESCRIPTION = """
═══════════════════════════════════════════════════════════════
  🥇  MGC MICRO GOLD SCALPING STRATEGY
  ──  Trend + Pullback + Momentum Confirmation (Long Only)
═══════════════════════════════════════════════════════════════

  TIMEFRAME :  5-minute / 15-minute bars
  INSTRUMENT:  Micro Gold Futures (MGC) — 10 oz / contract

  ┌─────────────────────────────────────────────────────┐
  │  ENTRY CONDITIONS (ALL must be true)                │
  ├─────────────────────────────────────────────────────┤
  │  1. Uptrend : EMA_fast > EMA_slow                  │
  │  2. Pullback: price within 1.5×ATR of EMA_fast     │
  │  3. RSI     : recovers from <40  OR  is >50        │
  │  4. Candle  : bullish close (green / engulfing)     │
  │  5. Volume  : above 1.2× 20-bar average            │
  └─────────────────────────────────────────────────────┘

  ┌─────────────────────────────────────────────────────┐
  │  EXIT                                               │
  ├─────────────────────────────────────────────────────┤
  │  Stop-loss  = entry − 1 × ATR                      │
  │  Take-profit = entry + 2 × ATR                     │
  │  (Optional trailing stop at 1.5 × ATR)             │
  └─────────────────────────────────────────────────────┘

  ┌─────────────────────────────────────────────────────┐
  │  RISK MANAGEMENT                                    │
  ├─────────────────────────────────────────────────────┤
  │  • Max 1% account risk per trade                    │
  │  • Stop after 5 consecutive losses                  │
  │  • Max 10 trades per day                            │
  └─────────────────────────────────────────────────────┘
"""


def main() -> None:
    parser = argparse.ArgumentParser(description="MGC Backtest & Optimizer")
    parser.add_argument("--json", type=str, help="Path to JSON OHLCV file")
    parser.add_argument("--csv", type=str, help="Path to CSV OHLCV file")
    parser.add_argument("--symbol", type=str, default="MGC=F", help="Yahoo Finance symbol")
    parser.add_argument("--interval", type=str, default="15m", help="Bar interval (1m, 5m, 15m, 1h, 1d)")
    parser.add_argument("--period", type=str, default="60d", help="History period")
    parser.add_argument("--capital", type=float, default=INITIAL_CAPITAL)
    parser.add_argument("--optimize", action="store_true", help="Run grid-search optimizer")
    parser.add_argument("--workers", type=int, default=4, help="Parallel workers for optimizer")
    args = parser.parse_args()

    # ── Print strategy description ──────────────────────────────────
    print(STRATEGY_DESCRIPTION)

    # ── Load data ───────────────────────────────────────────────────
    if args.json:
        df = load_json(args.json)
    elif args.csv:
        df = load_csv(args.csv)
    else:
        df = load_yfinance(symbol=args.symbol, interval=args.interval, period=args.period)

    print(f"📊 Data: {len(df)} bars  [{df.index[0]} → {df.index[-1]}]")
    print(f"   Price range: ${df['close'].min():.2f} — ${df['close'].max():.2f}\n")

    # ── Backtest with default parameters ────────────────────────────
    print("━" * 60)
    print("  STEP 1: Default Parameter Backtest")
    print("━" * 60)
    bt = Backtester(capital=args.capital)
    result = bt.run(df, DEFAULT_PARAMS, interval=args.interval)
    print_result(result)

    # ── Show trade log ──────────────────────────────────────────────
    if result.trades:
        print(f"\n  📝 Last 10 trades:")
        print(f"  {'Entry Time':<22} {'Exit Time':<22} {'Entry$':>9} {'Exit$':>9} {'Qty':>4} {'P&L':>10} {'Reason':>8}")
        print("  " + "─" * 88)
        for t in result.trades[-10:]:
            print(
                f"  {str(t.entry_time):<22} {str(t.exit_time):<22} "
                f"${t.entry_price:>8.2f} ${t.exit_price:>8.2f} "
                f"{t.qty:>4} {'+' if t.pnl >= 0 else ''}{t.pnl:>9.2f} {t.reason:>8}"
            )

    # ── Optimisation ────────────────────────────────────────────────
    if args.optimize:
        print("\n" + "━" * 60)
        print("  STEP 2: Grid Search Optimisation")
        print("━" * 60)
        results = optimize(df, capital=args.capital, workers=args.workers)
        if results:
            print_top_results(results)

            # Print best params for easy copy
            best_params = results[0][0]
            print("\n🔧 Best parameters (copy to config.py or strategy):")
            print("BEST_PARAMS = {")
            for k, v in best_params.items():
                print(f'    "{k}": {repr(v)},')
            print("}")
        else:
            print("⚠️  No combinations met the minimum win-rate threshold.")
    else:
        print("\n💡 Run with --optimize to find the best parameter combination.")

    # ── Demo trading instructions ───────────────────────────────────
    print("\n" + "━" * 60)
    print("  NEXT STEPS: Demo Trading")
    print("━" * 60)
    print("""
  1. Fill in Tiger credentials in mgc_trading/config.py:
     TIGER_ID, TIGER_PRIVATE_KEY, TIGER_ACCOUNT

  2. Start webhook server:
     python -m mgc_trading.webhook_server

  3. Send test signal:
     curl -X POST http://localhost:5001/webhook \\
       -H "Content-Type: application/json" \\
       -d '{"symbol":"MGC","action":"BUY","price":0,"strategy":"MGC_scalping"}'

  4. Or call Tiger API directly from Python:
     from strategies.futures.tiger_execution import TigerTrader
     t = TigerTrader()
     t.connect()
     t.place_order("MGC", qty=1, side="BUY")
""")


if __name__ == "__main__":
    main()
