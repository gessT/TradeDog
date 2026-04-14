"""
Run VPB v3 Strategy Backtest + Optimizer
==========================================
Multi-Timeframe Volume-Price Analysis (量价分析)
  • Daily bars for trend context + accumulation detection
  • 1H bars for precise entry timing

Usage:
    python scripts/run_vpb_v3.py                    # default NVDA
    python scripts/run_vpb_v3.py AAPL               # specific symbol
    python scripts/run_vpb_v3.py TSLA --optimize    # grid search
    python scripts/run_vpb_v3.py --multi            # run across all 7 stocks
"""
from __future__ import annotations

import argparse
import sys
import os
import itertools
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import yfinance as yf
import pandas as pd


SYMBOLS = ["NVDA", "AAPL", "TSLA", "META", "MSFT", "AMZN", "GOOG"]


def fetch_multi_tf(symbol: str, period: str = "2y"):
    """Download daily + 1H data for a symbol.
    
    Daily data uses 5y to ensure full coverage of 1H date range.
    """
    print(f"Fetching {symbol}…")
    tk = yf.Ticker(symbol)

    # Daily — use 5y to cover entire 1H range (730d ≈ 2y, but may return ~3y)
    df_d = tk.history(period="5y", interval="1d")
    df_d.columns = [c.lower() for c in df_d.columns]
    for col in ["dividends", "stock splits", "capital gains"]:
        if col in df_d.columns:
            df_d.drop(columns=[col], inplace=True)
    print(f"  Daily: {len(df_d)} bars  [{df_d.index[0].date()} → {df_d.index[-1].date()}]")

    # 1H (max 730 days from yfinance)
    df_h = tk.history(period="730d", interval="1h")
    df_h.columns = [c.lower() for c in df_h.columns]
    for col in ["dividends", "stock splits", "capital gains"]:
        if col in df_h.columns:
            df_h.drop(columns=[col], inplace=True)
    print(f"  1H:    {len(df_h)} bars  [{df_h.index[0]} → {df_h.index[-1]}]")

    return df_d, df_h


def print_result(res, symbol: str):
    print("\n" + "═" * 60)
    print(f"  VPB v3 量价分析 Results — {symbol}")
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

    if res.session_stats:
        print("\n  Best Trading Hours:")
        for s in res.session_stats[:5]:
            if s["trades"] >= 2:
                print(f"    {s['hour']:02d}:00  →  {s['trades']} trades | WR {s['win_rate']:.1f}% | P&L ${s['pnl']:,.2f}")

    if res.trade_examples:
        print(f"\n  Top Trade Examples (highest PnL):")
        for j, te in enumerate(res.trade_examples[:5]):
            risk = abs(te["entry_price"] - te["sl"])
            reward = abs(te["tp"] - te["entry_price"])
            rr = round(reward / risk, 2) if risk > 0 else 0
            print(f"    {j+1}. {te['dir']} ${te['entry_price']:.2f}→${te['exit_price']:.2f} "
                  f"SL=${te['sl']:.2f} TP=${te['tp']:.2f} RR={rr} "
                  f"P&L=${te['pnl']:,.2f} ({te['reason']}) "
                  f"held={te['bars_held']} bars @ {te['hour']:02d}:00")

    if res.daily_pnl:
        print(f"\n  Daily P&L (last 10 days):")
        for d in res.daily_pnl[:10]:
            marker = "+" if d["pnl"] >= 0 else "-"
            print(f"    {d['date']}  {marker} ${abs(d['pnl']):>8,.2f}  ({d['trades']} trades, WR {d['win_rate']:.0f}%)")

    print("═" * 60)


def run_backtest(symbol: str, period: str = "2y", params: dict | None = None):
    from strategies.us_stock.vpb_v3_backtest import VPB3Backtester

    df_d, df_h = fetch_multi_tf(symbol, period)
    bt = VPB3Backtester(capital=5_000)
    res = bt.run(symbol=symbol, period=period, params=params, df_daily=df_d, df_1h=df_h)
    print_result(res, symbol)
    return res


def run_optimizer(symbol: str, period: str = "2y"):
    """Grid search over key parameters."""
    from strategies.us_stock.vpb_v3_backtest import VPB3Backtester
    from strategies.us_stock.vpb_v3_strategy import DEFAULT_VPB3_PARAMS

    df_d, df_h = fetch_multi_tf(symbol, period)

    GRID = {
        "accum_min_bars": [2, 3, 4],
        "accum_vol_ratio": [0.80, 0.85, 0.90],
        "accum_range_atr": [1.2, 1.5, 2.0],
        "h_vol_multiplier": [1.1, 1.3, 1.5],
        "h_body_ratio_min": [0.30, 0.40, 0.50],
        "tp_r_multiple": [1.2, 1.5, 2.0],
        "trailing_atr_mult": [1.0, 1.2, 1.5],
    }

    keys = list(GRID.keys())
    combos = list(itertools.product(*[GRID[k] for k in keys]))
    print(f"\nOptimizing {symbol}: {len(combos)} combinations…")

    results = []
    bt = VPB3Backtester(capital=5_000)
    t0 = time.time()

    for idx, vals in enumerate(combos):
        p = {k: v for k, v in zip(keys, vals)}
        try:
            res = bt.run(symbol=symbol, period=period, params=p, df_daily=df_d.copy(), df_1h=df_h.copy())
        except Exception:
            continue

        if res.total_trades < 5:
            continue

        # Score: prioritize WR ≥ 68%, then ROI, then PF
        score = 0.0
        if res.win_rate >= 68:
            score += (res.win_rate - 68) * 5  # big bonus
        if res.win_rate >= 60:
            score += (res.win_rate - 60) * 2
        score += res.win_rate * 0.3
        score += min(res.total_return_pct, 100) * 0.3
        score += min(res.profit_factor, 5) * 3
        score -= res.max_drawdown_pct * 0.5

        results.append((score, p, res))

        if (idx + 1) % 100 == 0:
            elapsed = time.time() - t0
            print(f"  … {idx+1}/{len(combos)} ({elapsed:.0f}s)")

    results.sort(key=lambda x: x[0], reverse=True)

    print("\n" + "═" * 100)
    print(f"  VPB v3 OPTIMIZATION — {symbol}  ({len(results)} valid combos)")
    print("═" * 100)
    print(f"  {'#':>2}  {'WR%':>5}  {'ROI%':>7}  {'DD%':>6}  {'PF':>5}  {'Trades':>6}  {'Score':>6}  Params")
    print("  " + "─" * 96)

    for i, (sc, p, r) in enumerate(results[:15]):
        ps = ", ".join(f"{k}={v}" for k, v in p.items())
        print(f"  {i+1:>2}  {r.win_rate:>5.1f}  {r.total_return_pct:>7.2f}  {r.max_drawdown_pct:>6.2f}  "
              f"{r.profit_factor:>5.2f}  {r.total_trades:>6}  {sc:>6.1f}  {ps}")

    print("═" * 100)

    if results:
        best_score, best_params, best_res = results[0]
        print(f"\nRe-running with best params (score={best_score:.1f})…")
        run_backtest(symbol, period, params=best_params)

    return results


def run_multi(period: str = "2y"):
    """Run across all symbols and show summary."""
    all_results = []
    for sym in SYMBOLS:
        try:
            res = run_backtest(sym, period)
            all_results.append((sym, res))
        except Exception as e:
            print(f"  {sym}: ERROR — {e}")

    if all_results:
        print("\n" + "═" * 70)
        print("  VPB v3 MULTI-STOCK SUMMARY")
        print("═" * 70)
        print(f"  {'Symbol':>6}  {'Trades':>6}  {'WR%':>5}  {'ROI%':>7}  {'DD%':>6}  {'PF':>5}  {'Sharpe':>6}")
        print("  " + "─" * 64)
        for sym, r in all_results:
            print(f"  {sym:>6}  {r.total_trades:>6}  {r.win_rate:>5.1f}  {r.total_return_pct:>7.2f}  "
                  f"{r.max_drawdown_pct:>6.2f}  {r.profit_factor:>5.2f}  {r.sharpe_ratio:>6.2f}")
        avg_wr = sum(r.win_rate for _, r in all_results) / len(all_results)
        avg_roi = sum(r.total_return_pct for _, r in all_results) / len(all_results)
        print("  " + "─" * 64)
        print(f"  {'AVG':>6}  {'':>6}  {avg_wr:>5.1f}  {avg_roi:>7.2f}")
        print("═" * 70)


def main():
    parser = argparse.ArgumentParser(description="VPB v3 量价 Multi-TF Strategy")
    parser.add_argument("symbol", nargs="?", default="NVDA", help="Stock symbol")
    parser.add_argument("--period", default="2y", help="Data period (default: 2y)")
    parser.add_argument("--optimize", action="store_true", help="Grid search on params")
    parser.add_argument("--multi", action="store_true", help="Run across all 7 stocks")
    args = parser.parse_args()

    if args.multi:
        run_multi(args.period)
    elif args.optimize:
        run_optimizer(args.symbol, args.period)
    else:
        run_backtest(args.symbol, args.period)


if __name__ == "__main__":
    main()
