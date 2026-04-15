"""
GMC 2-Minute Strategy — Runner, Optimizer & Plotter
=====================================================
Usage (from repo root with venv active):

    python scripts/run_gmc_2min.py                      # live yfinance data
    python scripts/run_gmc_2min.py --json data/mgc_5min_data.json
    python scripts/run_gmc_2min.py --optimize            # grid search
    python scripts/run_gmc_2min.py --json ... --optimize --no-plot

Options:
    --json  PATH       Load OHLCV from a JSON file instead of yfinance
    --period PERIOD    yfinance period string (default: 30d)
    --capital N        Starting capital USD (default: 10000)
    --optimize         Run grid parameter search
    --no-plot          Skip matplotlib charts
"""
from __future__ import annotations

import argparse
import itertools
import json
import logging
import sys
from pathlib import Path
from typing import Optional

import pandas as pd
import numpy as np

# ── Project root on path ──────────────────────────────────────────────
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from strategies.futures.strategy_2min import GMCPullbackStrategy, DEFAULT_PARAMS
from strategies.futures.backtest_2min import Backtester2Min, BacktestResult2Min

logging.basicConfig(
    level=logging.WARNING,
    format="%(levelname)-8s %(name)s — %(message)s",
)
logger = logging.getLogger("run_gmc_2min")


# ═══════════════════════════════════════════════════════════════════════
# Data Loading
# ═══════════════════════════════════════════════════════════════════════

def load_from_yfinance(symbol: str = "MGC=F", period: str = "30d") -> pd.DataFrame:
    """Fetch 2-minute bars from Yahoo Finance (last 30d max)."""
    import yfinance as yf
    from datetime import datetime, timedelta, timezone

    _PERIOD_DAYS = {
        "7d": 7, "14d": 14, "30d": 30, "60d": 58,
        "1mo": 30, "2mo": 58,
    }
    days = _PERIOD_DAYS.get(period, 30)
    end  = datetime.now(timezone.utc)
    start = end - timedelta(days=days)

    ticker = yf.Ticker(symbol)
    df = ticker.history(start=start, end=end, interval="2m", auto_adjust=False)

    if df is None or df.empty:
        raise ValueError(f"No 2-minute data returned for {symbol}.")

    # Normalise columns to lowercase
    df.columns = [str(c).lower().strip() for c in df.columns]
    if isinstance(df.columns, pd.MultiIndex):
        df.columns = df.columns.get_level_values(0)

    for col in ("open", "high", "low", "close", "volume"):
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors="coerce")

    keep = [c for c in ("open", "high", "low", "close", "volume") if c in df.columns]
    df   = df[keep].dropna(subset=["close"]).sort_index()

    print(f"Loaded {len(df)} 2-min bars from yfinance  [{df.index[0]} → {df.index[-1]}]")
    return df


def load_from_json(path: str) -> pd.DataFrame:
    """
    Load OHLCV from a JSON file.
    Supports both 5-min JSON (will use as-is) and any resolution.
    Expected format: list of {time, open, high, low, close, volume}
    """
    with open(path, encoding="utf-8") as fh:
        raw = json.load(fh)

    df = pd.DataFrame(raw)

    # Find timestamp column
    for col in ("time", "timestamp", "date", "datetime"):
        if col in df.columns:
            df.index = pd.to_datetime(df[col], utc=True)
            df = df.drop(columns=[col])
            break

    df.columns = [str(c).lower().strip() for c in df.columns]
    for col in ("open", "high", "low", "close", "volume"):
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors="coerce")

    keep = [c for c in ("open", "high", "low", "close", "volume") if c in df.columns]
    df   = df[keep].dropna(subset=["close"]).sort_index()

    print(f"Loaded {len(df)} bars from {Path(path).name}  [{df.index[0]} → {df.index[-1]}]")
    return df


# ═══════════════════════════════════════════════════════════════════════
# Report Printer
# ═══════════════════════════════════════════════════════════════════════

def print_report(result: BacktestResult2Min, title: str = "BACKTEST RESULTS") -> None:
    """Print a formatted summary table to stdout."""
    sep = "═" * 55
    print(f"\n{sep}")
    print(f"  {title}")
    print(sep)
    print(f"  Capital          : ${result.initial_capital:>10,.2f}")
    print(f"  Final Equity     : ${result.final_equity:>10,.2f}")
    print(f"  Total Return     : {result.total_return_pct:>+10.2f}%")
    print(f"  ─────────────────────────────────────────────")
    print(f"  Total Trades     : {result.total_trades:>10}")
    print(f"  Winners / Losers : {result.winners:>4} / {result.losers:<4}")
    win_pct_flag = "✅" if result.win_rate >= 70 else ("⚠️" if result.win_rate >= 55 else "❌")
    roi_flag     = "✅" if result.total_return_pct >= 10 else ("⚠️" if result.total_return_pct >= 0 else "❌")
    print(f"  Win Rate         : {result.win_rate:>10.1f}%  {win_pct_flag}")
    print(f"  ROI              : {result.total_return_pct:>+9.2f}%  {roi_flag}")
    print(f"  ─────────────────────────────────────────────")
    print(f"  Avg Win          : ${result.avg_win_usd:>10.2f}")
    print(f"  Avg Loss         : ${result.avg_loss_usd:>10.2f}")
    print(f"  Risk / Reward    : {result.risk_reward:>10.2f}")
    print(f"  Profit Factor    : {result.profit_factor:>10.2f}")
    print(f"  Max Drawdown     : {result.max_drawdown_pct:>10.2f}%")
    print(f"  Sharpe Ratio     : {result.sharpe_ratio:>10.2f}")
    print(sep)

    if result.trades:
        print(f"\n  Trade Log  ({result.total_trades} trades)")
        print(f"  {'#':>3}  {'Entry Time':<25}  {'Entry':>8}  {'Exit':>8}  "
              f"{'SL':>8}  {'TP':>8}  {'Rsn':<6}  {'PnL':>8}  {'RSI':>5}")
        print("  " + "─" * 90)
        for idx, t in enumerate(result.trades, 1):
            print(
                f"  {idx:>3}  {str(t.entry_time)[:24]:<25}  "
                f"{t.entry_price:>8.2f}  {t.exit_price:>8.2f}  "
                f"{t.sl_price:>8.2f}  {t.tp_price:>8.2f}  "
                f"{'['+t.reason+']':<6}  "
                f"{'%+.2f' % t.pnl:>8}  "
                f"{t.rsi_at_entry:>5.1f}"
            )
    print()


# ═══════════════════════════════════════════════════════════════════════
# Plotter
# ═══════════════════════════════════════════════════════════════════════

def plot_results(
    df_ind: pd.DataFrame,
    result: BacktestResult2Min,
    show: bool = True,
) -> None:
    """Three-panel chart: price+EMAs+entries/exits, RSI, equity curve."""
    try:
        import matplotlib.pyplot as plt
        import matplotlib.dates as mdates
    except ImportError:
        print("matplotlib not installed — skipping plot (pip install matplotlib).")
        return

    fig, axes = plt.subplots(
        3, 1,
        figsize=(16, 10),
        gridspec_kw={"height_ratios": [4, 1.5, 1.5]},
        sharex=True,
    )
    fig.patch.set_facecolor("#0f111a")
    ax_price, ax_rsi, ax_equity = axes
    for ax in axes:
        ax.set_facecolor("#161928")
        ax.tick_params(colors="#8899aa", labelsize=7)
        ax.spines["bottom"].set_color("#2a3048")
        ax.spines["left"].set_color("#2a3048")
        ax.spines["top"].set_visible(False)
        ax.spines["right"].set_visible(False)

    idx = df_ind.index

    # ── Price + EMAs ─────────────────────────────────────────────────
    ax_price.plot(idx, df_ind["close"], color="#8899cc", linewidth=0.7, label="Close")
    ax_price.plot(idx, df_ind["ema20"],  color="#f0b429", linewidth=1.1, label="EMA20")
    ax_price.plot(idx, df_ind["ema50"],  color="#fb8c00", linewidth=1.1, linestyle="--", label="EMA50")
    ax_price.fill_between(
        idx, df_ind["ema20"], df_ind["ema50"],
        where=df_ind["ema20"] > df_ind["ema50"],
        alpha=0.05, color="#4caf50",
    )
    ax_price.set_title("GMC 2-Min Pullback Strategy", color="#dde3f0", fontsize=11, pad=8)
    ax_price.set_ylabel("Price (USD)", color="#8899aa", fontsize=8)

    # Plot entry / exit markers
    for t in result.trades:
        try:
            ax_price.axvline(x=t.entry_time, color="#26c6da", alpha=0.15, linewidth=0.5)
            ax_price.scatter(
                [t.entry_time], [t.entry_price],
                marker="^", s=60, color="#26c6da", zorder=5,
            )
            color_exit = "#4caf50" if t.win else "#ef5350"
            ax_price.scatter(
                [t.exit_time], [t.exit_price],
                marker="v", s=50, color=color_exit, zorder=5,
            )
            # SL / TP horizontal lines per trade
            if t.entry_time and t.exit_time:
                ax_price.hlines(
                    [t.sl_price, t.tp_price],
                    xmin=t.entry_time, xmax=t.exit_time,
                    colors=["#ef5350", "#4caf50"],
                    linewidths=0.5, linestyles="dashed", alpha=0.4,
                )
        except Exception:
            pass

    ax_price.legend(fontsize=7, facecolor="#161928", edgecolor="#2a3048", labelcolor="#dde3f0")

    # ── RSI ──────────────────────────────────────────────────────────
    ax_rsi.plot(idx, df_ind["rsi"], color="#ab47bc", linewidth=0.8, label="RSI")
    ax_rsi.axhline(50, color="#557799", linewidth=0.6, linestyle="--")
    ax_rsi.axhline(70, color="#ef5350", linewidth=0.5, linestyle=":")
    ax_rsi.axhline(30, color="#4caf50", linewidth=0.5, linestyle=":")
    ax_rsi.fill_between(idx, df_ind["rsi"], 50, where=df_ind["rsi"] > 50, alpha=0.1, color="#4caf50")
    ax_rsi.set_ylim(0, 100)
    ax_rsi.set_ylabel("RSI", color="#8899aa", fontsize=8)
    ax_rsi.legend(fontsize=7, facecolor="#161928", edgecolor="#2a3048", labelcolor="#dde3f0")

    # ── Equity curve ─────────────────────────────────────────────────
    eq_x = [df_ind.index[min(i, len(df_ind) - 1)] for i in range(len(result.equity_curve))]
    eq_y = result.equity_curve
    color_curve = "#4caf50" if result.total_return_pct >= 0 else "#ef5350"
    ax_equity.plot(eq_x, eq_y, color=color_curve, linewidth=1.0, label="Equity")
    ax_equity.axhline(result.initial_capital, color="#557799", linewidth=0.6, linestyle="--")
    ax_equity.fill_between(eq_x, eq_y, result.initial_capital,
                           where=[y >= result.initial_capital for y in eq_y],
                           alpha=0.12, color="#4caf50")
    ax_equity.fill_between(eq_x, eq_y, result.initial_capital,
                           where=[y < result.initial_capital for y in eq_y],
                           alpha=0.12, color="#ef5350")
    ax_equity.set_ylabel("Equity ($)", color="#8899aa", fontsize=8)
    ax_equity.legend(fontsize=7, facecolor="#161928", edgecolor="#2a3048", labelcolor="#dde3f0")

    # ── Stats box ────────────────────────────────────────────────────
    stats_text = (
        f"Trades: {result.total_trades}  |  WR: {result.win_rate:.1f}%  |  "
        f"ROI: {result.total_return_pct:+.2f}%  |  MaxDD: {result.max_drawdown_pct:.1f}%  |  "
        f"PF: {result.profit_factor:.2f}  |  Sharpe: {result.sharpe_ratio:.2f}"
    )
    fig.text(
        0.5, 0.01, stats_text,
        ha="center", fontsize=8, color="#8899cc",
        bbox=dict(facecolor="#1e2235", edgecolor="#2a3048", boxstyle="round,pad=0.3"),
    )

    plt.tight_layout(rect=[0, 0.03, 1, 1])
    if show:
        plt.show()
    else:
        out_path = ROOT / "data" / "gmc_2min_backtest.png"
        plt.savefig(out_path, dpi=150, bbox_inches="tight")
        print(f"Chart saved → {out_path}")
    plt.close()


# ═══════════════════════════════════════════════════════════════════════
# Grid Optimizer
# ═══════════════════════════════════════════════════════════════════════

def optimize(
    df: pd.DataFrame,
    capital: float = 10_000.0,
    target_win_rate: float = 70.0,
    target_roi: float = 10.0,
) -> Optional[dict]:
    """
    Grid search over key parameters to find best win rate + ROI combo.
    Prints top-10 results sorted by composite score.
    Returns best params dict or None.
    """
    param_grid = {
        "ema_fast":          [15, 20, 25],
        "ema_slow":          [40, 50, 60],
        "sl_mult":           [0.8, 1.0, 1.2],
        "tp_mult":           [1.5, 2.0, 2.5],
        "rsi_min":           [48, 50, 52],
        "pullback_atr_mult": [0.8, 1.0, 1.5],
        "atr_min_pct":       [0.03, 0.05, 0.08],
        "vol_mult":          [1.2, 1.5, 2.0],
    }

    # Build all combos
    keys   = list(param_grid.keys())
    values = list(param_grid.values())
    combos = list(itertools.product(*values))
    total  = len(combos)
    print(f"\nOptimizer: {total} parameter combinations")

    bt     = Backtester2Min(capital=capital, risk_mode="fixed", contracts=1)
    best   = None
    results_list: list[dict] = []

    for i, combo in enumerate(combos):
        params = {**DEFAULT_PARAMS, **dict(zip(keys, combo))}
        # Skip invalid combos
        if params["ema_fast"] >= params["ema_slow"]:
            continue

        try:
            r = bt.run(df, params=params)
        except Exception as exc:
            logger.debug("Combo %d failed: %s", i, exc)
            continue

        if r.total_trades < 5:
            continue

        # Composite score: weight win_rate + ROI, penalise max_drawdown
        score = (
            r.win_rate * 0.4
            + r.total_return_pct * 0.4
            - r.max_drawdown_pct * 0.2
        )
        results_list.append({
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
            print(f"  {i + 1}/{total} combinations scanned…", flush=True)

    if not results_list:
        print("Optimizer: no valid results.")
        return None

    results_list.sort(key=lambda x: -x["score"])

    # -- Save results to JSON --
    out_path = ROOT / "data" / "gmc_2min_optimizer_results.json"
    try:
        save_data = {
            "top10": results_list[:10],
            "best_params": results_list[0]["params"],
            "total_combos_scored": len(results_list),
        }
        with open(out_path, "w", encoding="utf-8") as fh:
            json.dump(save_data, fh, indent=2)
        print(f"\n  Optimizer results saved → {out_path}")
    except Exception as exc:
        logger.warning("Could not save optimizer results: %s", exc)

    # -- Print top 10 --
    print(f"\nTop 10 Optimizer Results (sorted by composite score):")
    print(f"  {'#':>3}  {'WR%':>6}  {'ROI%':>7}  {'MaxDD%':>7}  {'Trades':>6}  {'PF':>6}  {'Sharpe':>7}  {'Score':>7}")
    print("  " + "─" * 65)
    for rank, row in enumerate(results_list[:10], 1):
        flag = "⭐" if row["win_rate"] >= target_win_rate and row["roi"] >= target_roi else "  "
        print(
            f"  {rank:>3}  {row['win_rate']:>6.1f}  {row['roi']:>+7.2f}"
            f"  {row['max_dd']:>7.2f}  {row['trades']:>6}"
            f"  {row['pf']:>6.2f}  {row['sharpe']:>7.2f}  {row['score']:>7.2f}  {flag}"
        )

    best_row = results_list[0]
    print(f"\n  Best params: {_fmt_params(best_row['params'])}")
    return best_row["params"]


def _fmt_params(p: dict) -> str:
    keys = ["ema_fast", "ema_slow", "sl_mult", "tp_mult",
            "rsi_min", "pullback_atr_mult", "atr_min_pct", "vol_mult"]
    return "  |  ".join(f"{k}={p[k]}" for k in keys if k in p)


# ═══════════════════════════════════════════════════════════════════════
# Entry Point
# ═══════════════════════════════════════════════════════════════════════

def main() -> None:
    parser = argparse.ArgumentParser(description="GMC 2-Min Pullback Backtest")
    parser.add_argument("--json",     metavar="PATH",   help="Load OHLCV from JSON file")
    parser.add_argument("--symbol",   default="MGC=F",  help="yfinance symbol (default: MGC=F)")
    parser.add_argument("--period",   default="30d",    help="yfinance period (default: 30d)")
    parser.add_argument("--capital",      type=float, default=10_000.0, help="Starting capital USD")
    parser.add_argument("--optimize",     action="store_true", help="Run parameter grid search")
    parser.add_argument("--load-results", action="store_true", help="Load saved optimizer results from data/gmc_2min_optimizer_results.json")
    parser.add_argument("--no-plot",      action="store_true", help="Skip charts")
    args = parser.parse_args()

    # ── Load data ─────────────────────────────────────────────────────
    if args.json:
        df = load_from_json(args.json)
    else:
        df = load_from_yfinance(symbol=args.symbol, period=args.period)

    if df.empty or len(df) < 60:
        print("ERROR: Not enough data to run backtest (need at least 60 bars).")
        sys.exit(1)

    params = {**DEFAULT_PARAMS}

    # ── Load saved optimizer results ───────────────────────────────────
    if args.load_results:
        results_path = ROOT / "data" / "gmc_2min_optimizer_results.json"
        if not results_path.exists():
            print(f"ERROR: No saved results at {results_path}. Run with --optimize first.")
            sys.exit(1)
        with open(results_path, encoding="utf-8") as fh:
            saved = json.load(fh)
        best_params = saved.get("best_params", {})
        print(f"\n  Loaded best params from {results_path.name}")
        print(f"  Best params: {_fmt_params(best_params)}")
        top10 = saved.get("top10", [])
        if top10:
            print(f"\nTop 10 Saved Results:")
            print(f"  {'#':>3}  {'WR%':>6}  {'ROI%':>7}  {'MaxDD%':>7}  {'Trades':>6}  {'PF':>6}  {'Sharpe':>7}  {'Score':>7}")
            print("  " + "─" * 65)
            for rank, row in enumerate(top10, 1):
                flag = "⭐" if row["win_rate"] >= 70.0 and row["roi"] >= 10.0 else "  "
                print(
                    f"  {rank:>3}  {row['win_rate']:>6.1f}  {row['roi']:>+7.2f}"
                    f"  {row['max_dd']:>7.2f}  {row['trades']:>6}"
                    f"  {row['pf']:>6.2f}  {row['sharpe']:>7.2f}  {row['score']:>7.2f}  {flag}"
                )
        params = best_params

    # ── Optimize ──────────────────────────────────────────────────────
    elif args.optimize:
        best_params = optimize(df, capital=args.capital)
        if best_params:
            params = best_params

    # ── Run backtest with chosen (or default) params ──────────────────
    print(f"\n{'─'*55}")
    print(f"  Strategy: {GMCPullbackStrategy(params).describe()}")

    bt     = Backtester2Min(capital=args.capital, risk_mode="fixed", contracts=1)
    result = bt.run(df, params=params)

    print_report(result)

    # ── Plot ──────────────────────────────────────────────────────────
    if not args.no_plot:
        strategy = GMCPullbackStrategy(params)
        df_ind   = strategy.compute_indicators(df)
        plot_results(df_ind, result, show=True)


if __name__ == "__main__":
    main()
