"""
GMC 5-Minute Locked Strategy — Runner, Optimizer & Plotter
===========================================================
Usage (from repo root with venv active):

    python scripts/run_gmc_5min_locked.py
    python scripts/run_gmc_5min_locked.py --optimize
    python scripts/run_gmc_5min_locked.py --no-htf       # disable 1H bias
    python scripts/run_gmc_5min_locked.py --no-plot

Options:
    --period PERIOD    yfinance period (default: 60d)
    --capital N        Starting capital USD (default: 10000)
    --optimize         Run grid parameter search
    --no-htf           Disable 1H higher-timeframe bias filter
    --no-plot          Skip matplotlib chart
"""
from __future__ import annotations

import argparse
import itertools
import json
import logging
import sys
from pathlib import Path

import pandas as pd
import numpy as np

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from strategies.futures.strategy_5min_locked import LockedStrategy5Min, DEFAULT_LOCKED_PARAMS
from strategies.futures.backtest_5min_locked import BacktesterLocked5Min, LockedBacktestResult

logging.basicConfig(level=logging.WARNING, format="%(levelname)-8s %(name)s — %(message)s")
logger = logging.getLogger("run_gmc_5min_locked")


# ═══════════════════════════════════════════════════════════════════════
# Data Loading
# ═══════════════════════════════════════════════════════════════════════

def load_data(symbol: str = "MGC=F", period: str = "60d") -> tuple[pd.DataFrame, pd.DataFrame]:
    """Fetch 5m and 1H bars from yfinance. Returns (df_5m, df_1h)."""
    import yfinance as yf
    from datetime import datetime, timedelta, timezone

    _DAYS = {"7d": 7, "14d": 14, "30d": 30, "60d": 58, "1mo": 30, "2mo": 58}
    days  = _DAYS.get(period, 58)
    end   = datetime.now(timezone.utc)
    start = end - timedelta(days=days)

    ticker = yf.Ticker(symbol)

    df_5m = ticker.history(start=start, end=end, interval="5m", auto_adjust=False)
    df_5m.columns = [str(c).lower().strip() for c in df_5m.columns]
    df_5m = df_5m[["open","high","low","close","volume"]].dropna(subset=["close"]).sort_index()

    # 1H: yfinance gives up to 730d for 1h; fetch 90d for enough warm-up
    start_1h = end - timedelta(days=90)
    df_1h = ticker.history(start=start_1h, end=end, interval="1h", auto_adjust=False)
    df_1h.columns = [str(c).lower().strip() for c in df_1h.columns]
    df_1h = df_1h[["open","high","low","close","volume"]].dropna(subset=["close"]).sort_index()

    print(f"5m bars : {len(df_5m):,}  [{df_5m.index[0]} → {df_5m.index[-1]}]")
    print(f"1H bars : {len(df_1h):,}  [{df_1h.index[0]} → {df_1h.index[-1]}]")
    return df_5m, df_1h


# ═══════════════════════════════════════════════════════════════════════
# Report Printer
# ═══════════════════════════════════════════════════════════════════════

def print_report(result: LockedBacktestResult, title: str = "BACKTEST RESULTS") -> None:
    sep = "═" * 58
    print(f"\n{sep}")
    print(f"  {title}")
    print(sep)
    print(f"  Capital          : ${result.initial_capital:>10,.2f}")
    print(f"  Final Equity     : ${result.final_equity:>10,.2f}")
    print(f"  Total Return     : {result.total_return_pct:>+10.2f}%")
    print(f"  ─────────────────────────────────────────────────────")
    wr_flag  = "✅" if result.win_rate >= 70 else ("⚠️" if result.win_rate >= 55 else "❌")
    roi_flag = "✅" if result.total_return_pct >= 10 else ("⚠️" if result.total_return_pct >= 0 else "❌")
    print(f"  Total Trades     : {result.total_trades:>10}")
    print(f"  Winners / Losers : {result.winners:>4} / {result.losers:<4}")
    print(f"  Win Rate         : {result.win_rate:>10.1f}%  {wr_flag}")
    print(f"  ROI              : {result.total_return_pct:>+9.2f}%  {roi_flag}")
    print(f"  ─────────────────────────────────────────────────────")
    print(f"  Avg Win          : ${result.avg_win_usd:>10.2f}")
    print(f"  Avg Loss         : ${result.avg_loss_usd:>10.2f}")
    print(f"  Risk / Reward    : {result.risk_reward:>10.2f}")
    print(f"  Profit Factor    : {result.profit_factor:>10.2f}")
    print(f"  Max Drawdown     : {result.max_drawdown_pct:>10.2f}%")
    print(f"  Sharpe Ratio     : {result.sharpe_ratio:>10.2f}")
    print(sep)

    if result.trades:
        print(f"\n  Trade Log  ({result.total_trades} trades)")
        print(f"  {'#':>3}  {'Entry Time':<25}  {'Entry':>8}  {'Exit':>8}  {'SL':>8}  {'TP':>8}  {'Rsn':<6}  {'PnL':>8}")
        print("  " + "─" * 82)
        for idx, t in enumerate(result.trades, 1):
            print(
                f"  {idx:>3}  {str(t.entry_time)[:24]:<25}  "
                f"{t.entry_price:>8.2f}  {t.exit_price:>8.2f}  "
                f"{t.sl_price:>8.2f}  {t.tp_price:>8.2f}  "
                f"{'['+t.reason+']':<6}  {'%+.2f' % t.pnl:>8}"
            )
    print()


# ═══════════════════════════════════════════════════════════════════════
# Plotter
# ═══════════════════════════════════════════════════════════════════════

def plot_results(df_ind: pd.DataFrame, result: LockedBacktestResult, show: bool = True) -> None:
    try:
        import matplotlib.pyplot as plt
    except ImportError:
        print("matplotlib not installed — skipping plot.")
        return

    fig, axes = plt.subplots(3, 1, figsize=(16, 10),
                              gridspec_kw={"height_ratios": [4, 1.5, 1.5]}, sharex=True)
    fig.patch.set_facecolor("#0f111a")
    ax_price, ax_rsi, ax_equity = axes
    for ax in axes:
        ax.set_facecolor("#161928")
        ax.tick_params(colors="#8899aa", labelsize=7)
        for sp in ax.spines.values():
            sp.set_color("#2a3048")
        ax.spines["top"].set_visible(False)
        ax.spines["right"].set_visible(False)

    idx = df_ind.index

    ax_price.plot(idx, df_ind["close"], color="#8899cc", linewidth=0.7, label="Close")
    ax_price.plot(idx, df_ind["ema20"], color="#f0b429", linewidth=1.0, label="EMA20")
    ax_price.plot(idx, df_ind["ema50"], color="#fb8c00", linewidth=1.0, linestyle="--", label="EMA50")
    if "bos_high" in df_ind.columns:
        ax_price.plot(idx, df_ind["bos_high"], color="#ab47bc", linewidth=0.6,
                      linestyle=":", alpha=0.7, label="BoS High")
    ax_price.set_title("GMC 5-Min Locked Strategy", color="#dde3f0", fontsize=11, pad=8)
    ax_price.set_ylabel("Price (USD)", color="#8899aa", fontsize=8)

    for t in result.trades:
        try:
            ax_price.scatter([t.entry_time], [t.entry_price], marker="^", s=60, color="#26c6da", zorder=5)
            color_exit = "#4caf50" if t.win else "#ef5350"
            ax_price.scatter([t.exit_time], [t.exit_price], marker="v", s=50, color=color_exit, zorder=5)
        except Exception:
            pass
    ax_price.legend(fontsize=7, facecolor="#161928", edgecolor="#2a3048", labelcolor="#dde3f0")

    ax_rsi.plot(idx, df_ind["rsi"], color="#ab47bc", linewidth=0.8)
    ax_rsi.axhline(50, color="#557799", linewidth=0.6, linestyle="--")
    ax_rsi.axhline(70, color="#ef5350", linewidth=0.5, linestyle=":")
    ax_rsi.axhline(30, color="#4caf50", linewidth=0.5, linestyle=":")
    ax_rsi.set_ylim(0, 100)
    ax_rsi.set_ylabel("RSI", color="#8899aa", fontsize=8)

    eq_y = result.equity_curve
    eq_x = [df_ind.index[min(i, len(df_ind) - 1)] for i in range(len(eq_y))]
    color_eq = "#4caf50" if result.total_return_pct >= 0 else "#ef5350"
    ax_equity.plot(eq_x, eq_y, color=color_eq, linewidth=1.0)
    ax_equity.axhline(result.initial_capital, color="#557799", linewidth=0.6, linestyle="--")
    ax_equity.fill_between(eq_x, eq_y, result.initial_capital,
                           where=[y >= result.initial_capital for y in eq_y], alpha=0.12, color="#4caf50")
    ax_equity.fill_between(eq_x, eq_y, result.initial_capital,
                           where=[y < result.initial_capital for y in eq_y], alpha=0.12, color="#ef5350")
    ax_equity.set_ylabel("Equity ($)", color="#8899aa", fontsize=8)

    stats = (f"Trades:{result.total_trades}  WR:{result.win_rate:.1f}%  "
             f"ROI:{result.total_return_pct:+.2f}%  MaxDD:{result.max_drawdown_pct:.1f}%  "
             f"PF:{result.profit_factor:.2f}  Sharpe:{result.sharpe_ratio:.2f}")
    fig.text(0.5, 0.01, stats, ha="center", fontsize=8, color="#8899cc",
             bbox=dict(facecolor="#1e2235", edgecolor="#2a3048", boxstyle="round,pad=0.3"))
    plt.tight_layout(rect=[0, 0.03, 1, 1])

    if show:
        plt.show()
    else:
        out = ROOT / "data" / "gmc_5min_locked_backtest.png"
        plt.savefig(out, dpi=150, bbox_inches="tight")
        print(f"Chart saved → {out}")
    plt.close()


# ═══════════════════════════════════════════════════════════════════════
# Grid Optimizer
# ═══════════════════════════════════════════════════════════════════════

def optimize(
    df_5m: pd.DataFrame,
    df_1h: pd.DataFrame | None,
    capital: float = 10_000.0,
) -> dict | None:
    param_grid = {
        "bos_lookback":  [5, 10, 15, 20],
        "sl_atr_mult":   [0.8, 1.0, 1.2],
        "tp_atr_mult":   [1.5, 2.0, 2.5, 3.0],
        "st_period":     [7, 10, 14],
        "st_mult":       [1.5, 2.0, 2.5],
        "rsi_min":       [0, 45, 50, 55],
        "atr_min_pct":   [0.02, 0.03, 0.05],
    }

    keys   = list(param_grid.keys())
    combos = list(itertools.product(*[param_grid[k] for k in keys]))
    total  = len(combos)
    print(f"\nOptimizer: {total} parameter combinations")

    bt = BacktesterLocked5Min(capital=capital, contracts=1)
    results: list[dict] = []

    for i, combo in enumerate(combos):
        params = {**DEFAULT_LOCKED_PARAMS, **dict(zip(keys, combo))}
        # Skip invalid: tp must be wider than sl
        if params["tp_atr_mult"] <= params["sl_atr_mult"]:
            continue
        try:
            r = bt.run(df_5m, df_1h, params=params)
        except Exception as exc:
            logger.debug("Combo %d failed: %s", i, exc)
            continue
        if r.total_trades < 5:
            continue

        score = r.win_rate * 0.4 + r.total_return_pct * 0.4 - r.max_drawdown_pct * 0.2
        results.append({
            "params":   params,
            "win_rate": r.win_rate,
            "roi":      r.total_return_pct,
            "max_dd":   r.max_drawdown_pct,
            "trades":   r.total_trades,
            "pf":       r.profit_factor,
            "sharpe":   r.sharpe_ratio,
            "score":    score,
        })
        if (i + 1) % 100 == 0:
            print(f"  {i+1}/{total} scanned…", flush=True)

    if not results:
        print("Optimizer: no valid results.")
        return None

    results.sort(key=lambda x: -x["score"])

    # Save to JSON (convert sets to lists for JSON serialization)
    def _json_safe(obj):
        if isinstance(obj, set):
            return sorted(obj)
        raise TypeError(f"Object of type {type(obj).__name__} is not JSON serializable")

    out_path = ROOT / "data" / "gmc_5min_locked_optimizer.json"
    with open(out_path, "w", encoding="utf-8") as fh:
        json.dump({"top10": results[:10], "best_params": results[0]["params"],
                   "total_scored": len(results)}, fh, indent=2, default=_json_safe)
    print(f"\n  Results saved → {out_path}")

    print(f"\nTop 10 (composite score = 0.4×WR + 0.4×ROI − 0.2×MaxDD):")
    print(f"  {'#':>3}  {'WR%':>6}  {'ROI%':>7}  {'MaxDD%':>7}  {'Trades':>6}  {'PF':>6}  {'Sharpe':>7}  {'Score':>7}")
    print("  " + "─" * 65)
    for rank, row in enumerate(results[:10], 1):
        flag = "⭐" if row["win_rate"] >= 70 and row["roi"] >= 10 else "  "
        print(f"  {rank:>3}  {row['win_rate']:>6.1f}  {row['roi']:>+7.2f}"
              f"  {row['max_dd']:>7.2f}  {row['trades']:>6}"
              f"  {row['pf']:>6.2f}  {row['sharpe']:>7.2f}  {row['score']:>7.2f}  {flag}")

    best = results[0]
    k = ["bos_lookback","sl_atr_mult","tp_atr_mult","st_period","st_mult","rsi_min","atr_min_pct"]
    print(f"\n  Best: " + "  |  ".join(f"{x}={best['params'][x]}" for x in k if x in best["params"]))
    return best["params"]


# ═══════════════════════════════════════════════════════════════════════
# Entry Point
# ═══════════════════════════════════════════════════════════════════════

def main() -> None:
    parser = argparse.ArgumentParser(description="GMC 5-Min Locked Strategy Backtest")
    parser.add_argument("--symbol",   default="MGC=F")
    parser.add_argument("--period",   default="60d")
    parser.add_argument("--capital",  type=float, default=10_000.0)
    parser.add_argument("--optimize", action="store_true")
    parser.add_argument("--no-htf",   action="store_true", help="Disable 1H HTF bias")
    parser.add_argument("--no-plot",  action="store_true")
    args = parser.parse_args()

    df_5m, df_1h = load_data(symbol=args.symbol, period=args.period)
    df_1h_use = None if args.no_htf else df_1h

    if df_5m.empty or len(df_5m) < 60:
        print("ERROR: Not enough 5m data.")
        sys.exit(1)

    params = {**DEFAULT_LOCKED_PARAMS}

    if args.optimize:
        best = optimize(df_5m, df_1h_use, capital=args.capital)
        if best:
            params = best

    bt     = BacktesterLocked5Min(capital=args.capital, contracts=1)
    result = bt.run(df_5m, df_1h_use, params=params)
    print_report(result, title="GMC 5-MIN LOCKED — FINAL RESULTS")

    if not args.no_plot:
        strat  = LockedStrategy5Min(params)
        df_ind = strat.compute_indicators(df_5m, df_1h_use)
        plot_results(df_ind, result, show=True)


if __name__ == "__main__":
    main()
