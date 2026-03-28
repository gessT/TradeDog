#!/usr/bin/env python3
"""
MGC Pro Trading System — Complete Backtest & Optimization Pipeline
===================================================================
Run this script to:
  1. Load MGC 15m data (yfinance / JSON / CSV)
  2. Test ALL strategy types (Pullback, Breakout, Momentum, Trend-Following)
  3. Grid-search across thousands of parameter combinations
  4. Filter: WinRate >= 60%, MaxDD <= 20%, Trades >= 30
  5. Select the BEST strategy by composite score
  6. Walk-forward validation to prevent overfitting
  7. Output complete trade log, equity curve, and copyable strategy code

Usage:
    python -m mgc_trading.run_pro                          # yfinance default
    python -m mgc_trading.run_pro --json data/mgc.json     # from JSON file
    python -m mgc_trading.run_pro --workers 8              # parallel workers
    python -m mgc_trading.run_pro --no-optimize            # skip optimization
"""
from __future__ import annotations

import argparse
import json
import logging
import os
import sys

import numpy as np
import pandas as pd

from .backtest_pro import ProBacktester, BacktestResult, print_result, walk_forward_test
from .config import INITIAL_CAPITAL
from .data_loader import load_csv, load_json, load_yfinance
from .optimizer_pro import (
    optimize_all_strategies,
    print_top_results,
    print_walk_forward,
)
from .strategy_pro import PRO_DEFAULTS

logging.basicConfig(level=logging.INFO, format="%(asctime)s  %(levelname)s  %(message)s")
logger = logging.getLogger(__name__)


BANNER = """
╔══════════════════════════════════════════════════════════════════════╗
║                                                                      ║
║     MGC PRO TRADING SYSTEM — Micro Gold Futures                      ║
║     Multi-Strategy Backtest & Optimization Engine                     ║
║                                                                      ║
║     Strategies: Pullback | Breakout | Momentum | Trend-Following     ║
║     Filters:    Session | Volume | ATR | Market Structure            ║
║     Exits:      ATR SL/TP | Trailing Stop | Time Exit               ║
║     Validation: Walk-Forward (OOS)                                    ║
║                                                                      ║
╚══════════════════════════════════════════════════════════════════════╝
"""


def main() -> None:
    parser = argparse.ArgumentParser(description="MGC Pro Backtest & Optimizer")
    parser.add_argument("--json", type=str, help="Path to JSON OHLCV file")
    parser.add_argument("--csv", type=str, help="Path to CSV OHLCV file")
    parser.add_argument("--symbol", type=str, default="MGC=F", help="Yahoo Finance symbol")
    parser.add_argument("--interval", type=str, default="15m", help="Bar interval")
    parser.add_argument("--period", type=str, default="60d", help="History period")
    parser.add_argument("--capital", type=float, default=INITIAL_CAPITAL)
    parser.add_argument("--workers", type=int, default=4, help="Parallel workers")
    parser.add_argument("--no-optimize", action="store_true", help="Skip optimization, use defaults")
    parser.add_argument("--min-wr", type=float, default=60.0, help="Min win rate filter")
    parser.add_argument("--min-trades", type=int, default=30, help="Min trades filter")
    parser.add_argument("--max-dd", type=float, default=20.0, help="Max drawdown filter")
    parser.add_argument("--walk-forward", action="store_true", default=True, help="Run walk-forward")
    parser.add_argument("--output", type=str, help="Save best strategy to JSON file")
    args = parser.parse_args()

    print(BANNER)

    # ── Load Data ───────────────────────────────────────────────────
    print("=" * 60)
    print("  STEP 1: Loading Data")
    print("=" * 60)

    if args.json:
        df = load_json(args.json)
    elif args.csv:
        df = load_csv(args.csv)
    else:
        df = load_yfinance(symbol=args.symbol, interval=args.interval, period=args.period)

    print("\n  Instrument       : Micro Gold Futures (MGC)")
    print(f"  Bars Loaded      : {len(df)}")
    print(f"  Date Range       : {df.index[0]} → {df.index[-1]}")
    print(f"  Price Range      : ${df['close'].min():.2f} — ${df['close'].max():.2f}")
    print(f"  Avg Volume       : {df['volume'].mean():.0f}")
    print(f"  Starting Capital : ${args.capital:,.0f}")
    print()

    if args.no_optimize:
        # ── Just run default parameters ─────────────────────────────
        print("=" * 60)
        print("  Running Default Strategy (no optimization)")
        print("=" * 60)
        bt = ProBacktester(capital=args.capital)
        result = bt.run(df, PRO_DEFAULTS)
        print_result(result)
        _print_trade_log(result)
        return

    # ── Optimization ────────────────────────────────────────────────
    print("=" * 60)
    print("  STEP 2: Multi-Strategy Grid Search Optimization")
    print("=" * 60)

    results = optimize_all_strategies(
        df,
        capital=args.capital,
        min_win_rate=args.min_wr,
        min_trades=args.min_trades,
        max_drawdown=args.max_dd,
        workers=args.workers,
        top_n=20,
    )

    if not results:
        print("\n  WARNING: No strategies met all quality filters.")
        print("  Try adjusting: --min-wr 55 --min-trades 20 --max-dd 25")
        # Fall back to lower thresholds
        print("\n  Retrying with relaxed filters...")
        results = optimize_all_strategies(
            df,
            capital=args.capital,
            min_win_rate=55.0,
            min_trades=20,
            max_drawdown=25.0,
            workers=args.workers,
            top_n=20,
        )
        if not results:
            print("  Still no valid strategies. Check data quality.")
            return

    # ── Print Top Results ───────────────────────────────────────────
    print("\n" + "=" * 60)
    print("  STEP 3: Top Strategy Rankings")
    print("=" * 60)
    print_top_results(results, top_n=10)

    # ── Best Strategy Details ───────────────────────────────────────
    best_params, best_result, best_score = results[0]

    print("\n" + "=" * 60)
    print("  STEP 4: Best Strategy — Detailed Analysis")
    print("=" * 60)
    print_result(best_result)
    _print_trade_log(best_result)

    # ── Walk-Forward Validation ─────────────────────────────────────
    if args.walk_forward and len(df) > 500:
        print("\n" + "=" * 60)
        print("  STEP 5: Walk-Forward Validation (Anti-Overfitting)")
        print("=" * 60)
        oos_results = walk_forward_test(df, best_params, n_splits=3, capital=args.capital)
        print_walk_forward(oos_results)

    # ── Output Strategy Summary ─────────────────────────────────────
    _print_strategy_summary(best_params, best_result, best_score)

    # ── Output Copyable Parameters ──────────────────────────────────
    _print_copyable_params(best_params)

    # ── Save to JSON if requested ───────────────────────────────────
    if args.output:
        output_data = {
            "strategy_type": best_params.get("strategy_type"),
            "params": dict(best_params.items()),
            "results": {
                "win_rate": best_result.win_rate,
                "total_return_pct": best_result.total_return_pct,
                "max_drawdown_pct": best_result.max_drawdown_pct,
                "sharpe_ratio": best_result.sharpe_ratio,
                "profit_factor": best_result.profit_factor,
                "total_trades": best_result.total_trades,
                "risk_reward_ratio": best_result.risk_reward_ratio,
            },
            "score": best_score,
        }
        with open(args.output, "w") as f:
            json.dump(output_data, f, indent=2, default=str)
        print(f"\n  Strategy saved to: {args.output}")


def _print_trade_log(result: BacktestResult, last_n: int = 15) -> None:
    """Print last N trades."""
    if not result.trades:
        print("\n  No trades executed.")
        return

    print(f"\n  Trade Log (last {min(last_n, len(result.trades))} of {len(result.trades)}):")
    print(f"  {'#':>4} {'Side':<6} {'Entry Time':<22} {'Exit Time':<22} "
          f"{'Entry':>9} {'Exit':>9} {'Qty':>4} {'P&L':>10} {'Reason':>8}")
    print("  " + "-" * 100)

    for idx, t in enumerate(result.trades[-last_n:], len(result.trades) - last_n + 1):
        pnl_str = f"{'+'if t.pnl>=0 else ''}{t.pnl:,.2f}"
        print(
            f"  {idx:4d} {t.side:<6} {str(t.entry_time):<22} {str(t.exit_time):<22} "
            f"${t.entry_price:>8.2f} ${t.exit_price:>8.2f} "
            f"{t.qty:>4} {pnl_str:>10} {t.reason:>8}"
        )

    # P&L distribution
    wins = [t.pnl for t in result.trades if t.pnl > 0]
    losses = [t.pnl for t in result.trades if t.pnl <= 0]
    print("\n  P&L Distribution:")
    print(f"    Total P&L      : ${sum(t.pnl for t in result.trades):,.2f}")
    if wins:
        print(f"    Best Trade     : ${max(wins):,.2f}")
        print(f"    Avg Win        : ${np.mean(wins):,.2f}")
    if losses:
        print(f"    Worst Trade    : ${min(losses):,.2f}")
        print(f"    Avg Loss       : ${np.mean(losses):,.2f}")

    # Exit reason breakdown
    reasons = {}
    for t in result.trades:
        reasons[t.reason] = reasons.get(t.reason, 0) + 1
    print("\n  Exit Reasons:")
    for reason, count in sorted(reasons.items()):
        print(f"    {reason:12s}: {count:4d} ({count/len(result.trades)*100:.1f}%)")


def _print_strategy_summary(params: dict, result: BacktestResult, score: float) -> None:
    """Print professional strategy summary."""
    stype = params.get("strategy_type", "unknown")

    type_descriptions = {
        "pullback": "Trend + Pullback + RSI Recovery — enters on retracements within established trends",
        "breakout": "Channel Breakout + Volume Spike — enters when price breaks above resistance with volume confirmation",
        "momentum": "MACD Crossover + RSI Momentum — enters on momentum shifts aligned with trend direction",
        "trend_following": "EMA Alignment + Supertrend — enters on trend resumption after minor pullbacks",
    }

    print("\n" + "=" * 70)
    print("  STRATEGY SUMMARY")
    print("=" * 70)
    print(f"""
  Strategy Name    : MGC Pro {stype.title().replace('_', ' ')}
  Strategy Type    : {stype.upper()}
  Direction        : {params.get('direction', 'long').upper()}

  Description:
    {type_descriptions.get(stype, 'Custom strategy')}

  Entry Logic:
    - Trend Filter  : EMA({params['ema_fast']}) vs EMA({params['ema_slow']})
    - Supertrend    : {'ON' if params.get('use_supertrend') else 'OFF'}
    - Session Filter: {'ON (' + params.get('session_type', 'london_ny') + ')' if params.get('use_session_filter') else 'OFF'}
    - Volume Filter : Volume > {params.get('vol_mult', 1.0)}x MA({params.get('vol_period', 20)})

  Exit Logic:
    - Stop-Loss     : Entry - {params['atr_sl_mult']}x ATR
    - Take-Profit   : Entry + {params['atr_tp_mult']}x ATR
    - Trailing Stop  : {'ON (' + str(params.get('trailing_atr_mult', 1.5)) + 'x ATR)' if params.get('use_trailing') else 'OFF'}
    - Time Exit      : {'ON (' + str(params.get('max_bars_in_trade', 40)) + ' bars)' if params.get('use_time_exit') else 'OFF'}

  Risk Management:
    - Risk per Trade : 1% of equity
    - Max Consec Loss: 5 (then pause)
    - Max Daily Trades: 10

  Performance:
    - Win Rate       : {result.win_rate:.1f}%
    - Total Return   : {result.total_return_pct:+.2f}%
    - Max Drawdown   : {result.max_drawdown_pct:.2f}%
    - Sharpe Ratio   : {result.sharpe_ratio}
    - Profit Factor  : {result.profit_factor:.2f}
    - Risk:Reward    : 1:{result.risk_reward_ratio:.2f}
    - Total Trades   : {result.total_trades}
    - Composite Score: {score:.2f}
""")
    print("=" * 70)


def _print_copyable_params(params: dict) -> None:
    """Print parameters in copy-paste ready format."""
    print("\n  COPY-PASTE PARAMETERS:")
    print("  " + "-" * 50)
    print("  BEST_PARAMS = {")
    important = [
        "strategy_type", "ema_fast", "ema_slow", "rsi_period", "rsi_low", "rsi_high",
        "atr_period", "atr_sl_mult", "atr_tp_mult", "pullback_atr_mult",
        "breakout_lookback", "vol_period", "vol_mult", "vol_spike_threshold",
        "use_trailing", "trailing_atr_mult", "use_supertrend", "st_period", "st_mult",
        "use_session_filter", "session_type", "use_time_exit", "max_bars_in_trade",
        "use_market_structure", "ms_lookback", "use_mtf", "mtf_ema_period",
        "direction", "macd_fast", "macd_slow", "macd_signal",
    ]
    for k in important:
        if k in params:
            v = params[k]
            print(f'      "{k}": {repr(v)},')
    print("  }")
    print()


if __name__ == "__main__":
    main()
