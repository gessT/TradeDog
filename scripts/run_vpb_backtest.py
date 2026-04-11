"""
Run VPB Strategy Backtest + Optimizer
======================================
Usage:
    python scripts/run_vpb_backtest.py                      # default NVDA
    python scripts/run_vpb_backtest.py AAPL                  # specific symbol
    python scripts/run_vpb_backtest.py TSLA --optimize       # run optimizer
    python scripts/run_vpb_backtest.py NVDA --optimize-full  # full grid
    python scripts/run_vpb_backtest.py NVDA --period 1y      # custom period
"""
from __future__ import annotations

import argparse
import sys
import os

# Ensure project root on path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import yfinance as yf
import pandas as pd


def fetch_data(symbol: str, period: str = "2y") -> pd.DataFrame:
    """Download 1h OHLCV data from yfinance."""
    print(f"Fetching {symbol} 1h data (period={period})…")
    tk = yf.Ticker(symbol)
    df = tk.history(period=period, interval="1h")
    if df.empty:
        raise ValueError(f"No data returned for {symbol}")
    # Normalise columns
    df.columns = [c.lower() for c in df.columns]
    for col in ["dividends", "stock splits", "capital gains"]:
        if col in df.columns:
            df.drop(columns=[col], inplace=True)
    print(f"  → {len(df)} bars from {df.index[0]} to {df.index[-1]}")
    return df


def print_result(res, symbol: str):
    """Pretty-print backtest results."""
    print("\n" + "═" * 60)
    print(f"  VPB Backtest Results — {symbol}")
    print("═" * 60)
    print(f"  Total Trades:    {res.total_trades}")
    print(f"  Winners:         {res.winners}")
    print(f"  Losers:          {res.losers}")
    print(f"  Win Rate:        {res.win_rate:.1f}%")
    print(f"  Avg Win:         ${res.avg_win:,.2f}")
    print(f"  Avg Loss:        ${res.avg_loss:,.2f}")
    print(f"  Profit Factor:   {res.profit_factor:.2f}")
    print(f"  Risk/Reward:     {res.risk_reward_ratio:.2f}")
    print(f"  Total Return:    {res.total_return_pct:.2f}%")
    print(f"  Max Drawdown:    {res.max_drawdown_pct:.2f}%")
    print(f"  Sharpe Ratio:    {res.sharpe_ratio:.2f}")
    print(f"  Initial Capital: ${res.initial_capital:,.2f}")
    print(f"  Final Equity:    ${res.final_equity:,.2f}")

    # Long vs Short
    if res.long_stats.get("trades"):
        ls = res.long_stats
        print(f"\n  LONG:  {ls['trades']} trades | WR {ls['win_rate']:.1f}% | P&L ${ls['pnl']:,.2f}")
    if res.short_stats.get("trades"):
        ss = res.short_stats
        print(f"  SHORT: {ss['trades']} trades | WR {ss['win_rate']:.1f}% | P&L ${ss['pnl']:,.2f}")

    # Best trading sessions
    if res.session_stats:
        print("\n  Best Trading Hours:")
        for s in res.session_stats[:5]:
            if s["trades"] >= 2:
                print(f"    {s['hour']:02d}:00  →  {s['trades']} trades | WR {s['win_rate']:.1f}% | P&L ${s['pnl']:,.2f}")

    # Recent daily P&L
    if res.daily_pnl:
        print(f"\n  Daily P&L (last 10 days):")
        for d in res.daily_pnl[:10]:
            marker = "✓" if d["pnl"] >= 0 else "✗"
            print(f"    {d['date']}  {marker} ${d['pnl']:>8,.2f}  ({d['trades']} trades, WR {d['win_rate']:.0f}%)")

    print("═" * 60)


def run_backtest(symbol: str, period: str, params: dict | None = None):
    from strategies.us_stock.vpb_backtest import VPBBacktester
    df = fetch_data(symbol, period)
    bt = VPBBacktester(capital=25_000)
    res = bt.run(df, params=params)
    print_result(res, symbol)
    return res


def run_optimizer(symbol: str, period: str, full: bool = False):
    from strategies.us_stock.vpb_optimizer import optimize, optimize_full
    df = fetch_data(symbol, period)

    print(f"\nRunning {'full' if full else 'fast'} optimization…")
    fn = optimize_full if full else optimize
    results = fn(df, capital=25_000, min_trades=10, top_n=10)

    if not results:
        print("No valid results found. Try a longer period or fewer min_trades.")
        return

    print("\n" + "═" * 80)
    print("  TOP OPTIMIZATION RESULTS")
    print("═" * 80)
    print(f"  {'#':>2}  {'WR%':>5}  {'ROI%':>7}  {'DD%':>6}  {'PF':>5}  {'Sharpe':>6}  {'Trades':>6}  {'Score':>6}  Params")
    print("  " + "─" * 76)

    for i, r in enumerate(results):
        params_str = ", ".join(f"{k}={v}" for k, v in r.params.items())
        print(f"  {i+1:>2}  {r.win_rate:>5.1f}  {r.total_return_pct:>7.2f}  {r.max_drawdown_pct:>6.2f}  "
              f"{r.profit_factor:>5.2f}  {r.sharpe_ratio:>6.2f}  {r.total_trades:>6}  {r.score:>6.1f}  {params_str}")

    print("═" * 80)

    # Run detailed backtest with best params
    best = results[0]
    print(f"\n  Re-running backtest with best params (score={best.score})…")
    run_backtest(symbol, period, params=best.params)


def main():
    parser = argparse.ArgumentParser(description="VPB Strategy Backtest & Optimizer")
    parser.add_argument("symbol", nargs="?", default="NVDA", help="Stock symbol (default: NVDA)")
    parser.add_argument("--period", default="2y", help="Data period (default: 2y)")
    parser.add_argument("--optimize", action="store_true", help="Run fast optimizer")
    parser.add_argument("--optimize-full", action="store_true", help="Run full grid optimizer")
    args = parser.parse_args()

    if args.optimize or args.optimize_full:
        run_optimizer(args.symbol, args.period, full=args.optimize_full)
    else:
        run_backtest(args.symbol, args.period)


if __name__ == "__main__":
    main()
