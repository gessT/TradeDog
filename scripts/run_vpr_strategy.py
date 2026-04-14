"""
Run VPR Strategy — CLI Runner
================================
Usage:
    python scripts/run_vpr_strategy.py                     # default AAPL
    python scripts/run_vpr_strategy.py NVDA                # specific symbol
    python scripts/run_vpr_strategy.py --screen            # screen all 10 hot picks
    python scripts/run_vpr_strategy.py AAPL --optimize     # parameter sweep + IS/OOS
    python scripts/run_vpr_strategy.py AAPL --walk-forward # k-fold time stability
    python scripts/run_vpr_strategy.py --screen --csv      # export to CSV
"""
from __future__ import annotations

import argparse
import sys
import os

# Ensure project root is on sys.path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))


def _print_header(title: str) -> None:
    print(f"\n{'═' * 60}")
    print(f"  {title}")
    print(f"{'═' * 60}")


def run_single(symbol: str, period: str = "2y", interval: str = "1h") -> None:
    """Run VPR backtest on a single symbol and print results."""
    from strategies.futures.data_loader import load_yfinance
    from strategies.us_stock.vpr.backtest import VPRBacktester

    print(f"Fetching {symbol}…")
    df = load_yfinance(symbol=symbol, interval=interval, period=period)
    print(f"  {interval}: {len(df)} bars  [{df.index[0]} → {df.index[-1]}]")

    bt = VPRBacktester()
    result = bt.run(df)

    _print_header(f"VPR Strategy Results — {symbol}")
    print(f"  Total Trades:    {result.total_trades}")
    print(f"  Winners:         {result.winners}")
    print(f"  Losers:          {result.losers}")
    print(f"  Win Rate:        {result.win_rate}%")
    print(f"  Avg Win:         ${result.avg_win:.2f}")
    print(f"  Avg Loss:        ${result.avg_loss:.2f}")
    print(f"  Profit Factor:   {result.profit_factor}")
    print(f"  Total Return:    {result.total_return_pct:.2f}%")
    print(f"  Max Drawdown:    {result.max_drawdown_pct:.2f}%")
    print(f"  Sharpe Ratio:    {result.sharpe_ratio}")
    print(f"  Expectancy:      ${result.expectancy:.2f}")
    print(f"  Initial Capital: ${result.initial_capital:,.2f}")
    print(f"  Final Equity:    ${result.final_equity:,.2f}")

    if result.trades:
        print(f"\n  Top Trades (highest PnL):")
        top = sorted(result.trades, key=lambda t: t.pnl, reverse=True)[:5]
        for i, t in enumerate(top, 1):
            print(f"    {i}. {t.direction} ${t.entry_price:.2f}→${t.exit_price:.2f} "
                  f"R={t.r_multiple:.1f} P&L=${t.pnl:.2f} ({t.reason}) held={t.bars_held} bars")

    if result.daily_pnl:
        print(f"\n  Daily P&L (last 10 days):")
        for d in result.daily_pnl[:10]:
            sign = "+" if d["pnl"] >= 0 else "-"
            print(f"    {d['date']}  {sign} ${abs(d['pnl']):>8.2f}  ({d['trades']} trades)")

    print(f"{'═' * 60}")


def run_screen(period: str = "2y", interval: str = "1h", export_csv: bool = False) -> None:
    """Screen all hot-pick symbols."""
    from strategies.us_stock.vpr.screener import screen_symbols, export_screener_csv
    from strategies.us_stock.vpr.config import HOT_SYMBOLS

    _print_header("VPR Hot-List Screener")
    print(f"  Symbols: {', '.join(HOT_SYMBOLS)}")
    print(f"  Period: {period}  Interval: {interval}")
    print()

    rows = screen_symbols(interval=interval, period=period)

    # Table header
    header = f"  {'Symbol':<8} {'WR%':>6} {'Trades':>7} {'Return%':>9} {'PF':>6} {'DD%':>6} {'Sharpe':>7} {'Exp$':>7} {'Status':>7}"
    print(header)
    print(f"  {'─' * (len(header) - 2)}")

    for r in rows:
        status_color = "✅" if r.status == "PASS" else "❌"
        print(f"  {r.symbol:<8} {r.win_rate:>5.1f}% {r.total_trades:>7} "
              f"{r.total_return_pct:>8.1f}% {r.profit_factor:>5.2f} "
              f"{r.max_drawdown_pct:>5.1f}% {r.sharpe_ratio:>6.2f} "
              f"{r.expectancy:>6.2f} {status_color}")

    passed = [r for r in rows if r.status == "PASS"]
    print(f"\n  {len(passed)}/{len(rows)} symbols PASSED threshold")

    if export_csv:
        export_screener_csv(rows)
        print(f"  → Results exported to vpr_screener.csv")

    print(f"{'═' * 60}")


def run_optimize(symbol: str, period: str = "2y", interval: str = "1h") -> None:
    """Parameter sweep with IS/OOS validation."""
    from strategies.futures.data_loader import load_yfinance
    from strategies.us_stock.vpr.optimizer import optimize

    print(f"Fetching {symbol}…")
    df = load_yfinance(symbol=symbol, interval=interval, period=period)

    sweep = {
        "rsi_low": [40, 42, 45, 48],
        "atr_sl_mult": [1.1, 1.2, 1.3, 1.4, 1.5],
    }

    _print_header(f"VPR Optimizer — {symbol}")
    print(f"  Sweeping: rsi_low={sweep['rsi_low']}, atr_sl_mult={sweep['atr_sl_mult']}")
    print(f"  Total combos: {len(sweep['rsi_low']) * len(sweep['atr_sl_mult'])}")
    print()

    results = optimize(df, sweep)

    # Show top 10
    header = f"  {'RSI_L':>6} {'SL_M':>6} │ {'IS WR%':>7} {'IS Ret%':>8} {'IS #':>5} │ {'OOS WR%':>8} {'OOS Ret%':>9} {'OOS #':>6} │ {'Stable':>7}"
    print(header)
    print(f"  {'─' * (len(header) - 2)}")

    for r in results[:10]:
        stable = "✅" if r.stable else "❌"
        print(f"  {r.params['rsi_low']:>6} {r.params['atr_sl_mult']:>5.1f}  │ "
              f"{r.is_win_rate:>6.1f}% {r.is_return_pct:>7.1f}% {r.is_trades:>5} │ "
              f"{r.oos_win_rate:>7.1f}% {r.oos_return_pct:>8.1f}% {r.oos_trades:>6} │ {stable}")

    stable_results = [r for r in results if r.stable]
    print(f"\n  {len(stable_results)}/{len(results)} parameter sets stable OOS")
    print(f"{'═' * 60}")


def run_walk_forward(symbol: str, period: str = "2y", interval: str = "1h") -> None:
    """Walk-forward k-fold analysis."""
    from strategies.futures.data_loader import load_yfinance
    from strategies.us_stock.vpr.optimizer import walk_forward

    print(f"Fetching {symbol}…")
    df = load_yfinance(symbol=symbol, interval=interval, period=period)

    _print_header(f"VPR Walk-Forward — {symbol}")

    folds = walk_forward(df, n_folds=4)

    header = f"  {'Fold':>5} {'Period':>24} {'Bars':>6} {'Trades':>7} {'WR%':>6} {'Ret%':>7} {'DD%':>6} {'PF':>6} {'Exp$':>7}"
    print(header)
    print(f"  {'─' * (len(header) - 2)}")

    for f in folds:
        print(f"  {f['fold']:>5} {f['start']}→{f['end']} {f['bars']:>6} "
              f"{f['trades']:>7} {f['win_rate']:>5.1f}% {f['return_pct']:>6.1f}% "
              f"{f['max_dd_pct']:>5.1f}% {f['profit_factor']:>5.2f} {f['expectancy']:>6.2f}")

    # Summary
    avg_wr = sum(f["win_rate"] for f in folds) / len(folds)
    avg_ret = sum(f["return_pct"] for f in folds) / len(folds)
    print(f"\n  Average WR: {avg_wr:.1f}%  |  Average Return: {avg_ret:.1f}%")
    consistent = all(f["win_rate"] > 40 for f in folds)
    print(f"  Time stability: {'✅ CONSISTENT' if consistent else '⚠️ UNSTABLE across folds'}")
    print(f"{'═' * 60}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="VPR Strategy — Volume Profile + VWAP + RSI")
    parser.add_argument("symbol", nargs="?", default="AAPL", help="Stock symbol (default: AAPL)")
    parser.add_argument("--period", default="2y", help="Data period (default: 2y)")
    parser.add_argument("--interval", default="1h", help="Bar interval (default: 1h)")
    parser.add_argument("--screen", action="store_true", help="Screen all hot-pick symbols")
    parser.add_argument("--optimize", action="store_true", help="Run parameter sweep + IS/OOS")
    parser.add_argument("--walk-forward", action="store_true", help="Walk-forward stability test")
    parser.add_argument("--csv", action="store_true", help="Export screener results to CSV")

    args = parser.parse_args()

    if args.screen:
        run_screen(period=args.period, interval=args.interval, export_csv=args.csv)
    elif args.optimize:
        run_optimize(args.symbol, period=args.period, interval=args.interval)
    elif args.walk_forward:
        run_walk_forward(args.symbol, period=args.period, interval=args.interval)
    else:
        run_single(args.symbol, period=args.period, interval=args.interval)
