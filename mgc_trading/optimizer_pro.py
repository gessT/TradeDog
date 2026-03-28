"""
MGC Pro Optimizer — Multi-Strategy Grid Search + Walk-Forward
==============================================================
Tests ALL strategy types × parameter combinations, applies
quality filters, and returns the best strategy with walk-forward validation.
"""
from __future__ import annotations

import itertools
import logging
import time
from concurrent.futures import ProcessPoolExecutor, as_completed
from dataclasses import dataclass

import pandas as pd

from .backtest_pro import BacktestResult, ProBacktester, walk_forward_test, print_result
from .config import INITIAL_CAPITAL
from .strategy_pro import PRO_DEFAULTS

logger = logging.getLogger(__name__)


# ═══════════════════════════════════════════════════════════════════════
# Search Grid — All Strategy Types
# ═══════════════════════════════════════════════════════════════════════

STRATEGY_GRIDS: dict[str, dict[str, list]] = {
    "pullback": {
        "strategy_type":     ["pullback"],
        "ema_fast":          [20, 50],
        "ema_slow":          [100, 200],
        "rsi_low":           [30, 35, 40],
        "rsi_high":          [48, 55, 60],
        "atr_sl_mult":       [1.0, 1.5, 2.0],
        "atr_tp_mult":       [2.0, 2.5, 3.0],
        "pullback_atr_mult": [1.5, 3.0, 5.0],
        "vol_mult":          [0.8, 1.0],
        "use_trailing":      [True, False],
        "trailing_atr_mult": [1.5],
        "use_session_filter": [True, False],
        "direction":         ["long"],
    },
    "breakout": {
        "strategy_type":     ["breakout"],
        "ema_fast":          [20, 50],
        "ema_slow":          [100, 200],
        "breakout_lookback": [10, 20, 30],
        "atr_sl_mult":       [1.0, 1.5, 2.0],
        "atr_tp_mult":       [2.0, 2.5, 3.0, 4.0],
        "vol_mult":          [0.8, 1.0],
        "vol_spike_threshold": [1.2, 1.5],
        "use_trailing":      [True],
        "trailing_atr_mult": [1.5, 2.0],
        "use_session_filter": [True, False],
        "direction":         ["long"],
    },
    "momentum": {
        "strategy_type":     ["momentum"],
        "ema_fast":          [20, 50],
        "ema_slow":          [100, 200],
        "rsi_high":          [50, 55, 60],
        "macd_fast":         [12],
        "macd_slow":         [26],
        "macd_signal":       [9],
        "atr_sl_mult":       [1.0, 1.5, 2.0],
        "atr_tp_mult":       [2.0, 2.5, 3.0],
        "vol_mult":          [0.8, 1.0],
        "use_trailing":      [True, False],
        "trailing_atr_mult": [1.5],
        "use_session_filter": [True, False],
        "direction":         ["long"],
    },
    "trend_following": {
        "strategy_type":     ["trend_following"],
        "ema_fast":          [20, 50],
        "ema_slow":          [100, 200],
        "rsi_low":           [30, 40],
        "rsi_high":          [50, 55],
        "atr_sl_mult":       [1.5, 2.0, 2.5],
        "atr_tp_mult":       [2.5, 3.0, 4.0],
        "vol_mult":          [0.8, 1.0],
        "use_supertrend":    [True, False],
        "st_period":         [10],
        "st_mult":           [3.0],
        "use_trailing":      [True],
        "trailing_atr_mult": [1.5, 2.0],
        "use_session_filter": [True, False],
        "direction":         ["long"],
    },
}


# ═══════════════════════════════════════════════════════════════════════
# Composite Scoring
# ═══════════════════════════════════════════════════════════════════════

def composite_score(r: BacktestResult) -> float:
    """Rank by weighted combination: return > win_rate > drawdown > sharpe."""
    if r.total_trades < 5:
        return -999.0
    score = (
        r.total_return_pct * 0.35
        + r.win_rate * 0.30
        - r.max_drawdown_pct * 0.20
        + r.sharpe_ratio * 0.15
    )
    return round(score, 4)


# ═══════════════════════════════════════════════════════════════════════
# Worker function (top-level for multiprocessing)
# ═══════════════════════════════════════════════════════════════════════

@dataclass
class _Job:
    df_pickle: bytes
    params: dict
    capital: float


def _run_one(job: _Job) -> tuple[dict, BacktestResult]:
    import io
    df = pd.read_pickle(io.BytesIO(job.df_pickle))
    bt = ProBacktester(capital=job.capital)
    result = bt.run(df, job.params)
    return job.params, result


# ═══════════════════════════════════════════════════════════════════════
# Main Optimizer
# ═══════════════════════════════════════════════════════════════════════

def optimize_all_strategies(
    df: pd.DataFrame,
    capital: float = INITIAL_CAPITAL,
    min_win_rate: float = 60.0,
    min_trades: int = 30,
    max_drawdown: float = 20.0,
    workers: int = 4,
    top_n: int = 20,
) -> list[tuple[dict, BacktestResult, float]]:
    """Run grid-search across ALL strategy types.

    Filters:
      - Win rate >= min_win_rate
      - Trades >= min_trades
      - Max drawdown <= max_drawdown

    Returns top-N results sorted by composite score.
    """
    import io

    # Build ALL combinations across all strategy types
    all_combos: list[dict] = []
    for strat_name, grid in STRATEGY_GRIDS.items():
        keys = list(grid.keys())
        for vals in itertools.product(*(grid[k] for k in keys)):
            p = {**PRO_DEFAULTS}
            for k, v in zip(keys, vals):
                p[k] = v
            all_combos.append(p)

    total = len(all_combos)
    print(f"\n{'='*60}")
    print(f"  MGC PRO OPTIMIZER — {total} total combinations")
    print("  Strategies: pullback, breakout, momentum, trend_following")
    print(f"  Filters: WR>={min_win_rate}% | DD<={max_drawdown}% | Trades>={min_trades}")
    print(f"  Workers: {workers}")
    print(f"{'='*60}\n")

    # Serialize DataFrame
    buf = io.BytesIO()
    df.to_pickle(buf)
    df_bytes = buf.getvalue()

    results: list[tuple[dict, BacktestResult, float]] = []
    strat_counts: dict[str, int] = {"pullback": 0, "breakout": 0, "momentum": 0, "trend_following": 0}
    t0 = time.time()

    with ProcessPoolExecutor(max_workers=workers) as pool:
        futures = {
            pool.submit(_run_one, _Job(df_bytes, p, capital)): p
            for p in all_combos
        }
        done = 0
        for fut in as_completed(futures):
            done += 1
            if done % 200 == 0 or done == total:
                elapsed = time.time() - t0
                rate = done / elapsed if elapsed > 0 else 0
                eta = (total - done) / rate if rate > 0 else 0
                print(f"  Progress: {done}/{total} ({done*100//total}%) | "
                      f"ETA: {eta:.0f}s | Found: {len(results)} valid", end="\r")

            try:
                params, bt_result = fut.result()
            except Exception as e:
                logger.debug("Combo failed: %s", e)
                continue

            # Apply quality filters
            if (bt_result.win_rate >= min_win_rate
                    and bt_result.total_trades >= min_trades
                    and bt_result.max_drawdown_pct <= max_drawdown):
                sc = composite_score(bt_result)
                results.append((params, bt_result, sc))
                stype = params.get("strategy_type", "unknown")
                strat_counts[stype] = strat_counts.get(stype, 0) + 1

    elapsed = time.time() - t0
    results.sort(key=lambda x: x[2], reverse=True)

    print(f"\n\n  Completed in {elapsed:.1f}s")
    print(f"  Valid combos: {len(results)} / {total}")
    for stype, cnt in strat_counts.items():
        print(f"    {stype:20s}: {cnt} valid")
    print()

    return results[:top_n]


# ═══════════════════════════════════════════════════════════════════════
# Pretty-print results
# ═══════════════════════════════════════════════════════════════════════

def print_top_results(results: list[tuple[dict, BacktestResult, float]], top_n: int = 10) -> None:
    """Print top-N optimization results."""
    n = min(top_n, len(results))
    print("=" * 110)
    print(f"  TOP {n} STRATEGY COMBINATIONS")
    print("=" * 110)
    print(f"  {'#':>3}  {'Type':<16} {'Win%':>6}  {'Return%':>9}  {'MaxDD%':>7}  {'Sharpe':>7}  "
          f"{'Trades':>6}  {'PF':>5}  {'R:R':>5}  {'Score':>7}")
    print("-" * 110)

    for idx, (params, r, sc) in enumerate(results[:n], 1):
        stype = params.get("strategy_type", "?")
        print(
            f"  {idx:3d}  {stype:<16} {r.win_rate:5.1f}%  {r.total_return_pct:+8.2f}%  "
            f"{r.max_drawdown_pct:6.2f}%  {r.sharpe_ratio:7.2f}  "
            f"{r.total_trades:6d}  {r.profit_factor:5.2f}  {r.risk_reward_ratio:5.2f}  {sc:7.2f}"
        )

    print("=" * 110)

    if results:
        print("\n" + "=" * 60)
        print("  BEST STRATEGY DETAILS")
        print("=" * 60)
        best_params, best_result, _best_score = results[0]
        print_result(best_result)

        print("\n  Key Parameters:")
        important_keys = [
            "strategy_type", "ema_fast", "ema_slow", "rsi_low", "rsi_high",
            "atr_sl_mult", "atr_tp_mult", "pullback_atr_mult", "breakout_lookback",
            "vol_mult", "vol_spike_threshold", "use_trailing", "trailing_atr_mult",
            "use_supertrend", "st_period", "st_mult", "use_session_filter",
            "use_time_exit", "max_bars_in_trade", "direction",
        ]
        for k in important_keys:
            if k in best_params:
                print(f"    {k:24s} = {best_params[k]}")


def print_walk_forward(oos_results: list[BacktestResult]) -> None:
    """Print walk-forward validation results."""
    if not oos_results:
        print("  No walk-forward results.")
        return

    print("\n" + "=" * 70)
    print("  WALK-FORWARD VALIDATION (Out-of-Sample)")
    print("=" * 70)
    print(f"  {'Fold':>6}  {'Win%':>6}  {'Return%':>9}  {'MaxDD%':>7}  {'Sharpe':>7}  {'Trades':>6}")
    print("-" * 70)

    total_return = 0
    total_trades = 0
    for i, r in enumerate(oos_results, 1):
        print(f"  {i:6d}  {r.win_rate:5.1f}%  {r.total_return_pct:+8.2f}%  "
              f"{r.max_drawdown_pct:6.2f}%  {r.sharpe_ratio:7.2f}  {r.total_trades:6d}")
        total_return += r.total_return_pct
        total_trades += r.total_trades

    avg_wr = sum(r.win_rate for r in oos_results) / len(oos_results)
    avg_dd = sum(r.max_drawdown_pct for r in oos_results) / len(oos_results)
    avg_sharpe = sum(r.sharpe_ratio for r in oos_results) / len(oos_results)
    print("-" * 70)
    print(f"  {'AVG':>6}  {avg_wr:5.1f}%  {total_return/len(oos_results):+8.2f}%  "
          f"{avg_dd:6.2f}%  {avg_sharpe:7.2f}  {total_trades//len(oos_results):6d}")
    print(f"  {'TOTAL':>6}  {'':>6}  {total_return:+8.2f}%  {'':>7}  {'':>7}  {total_trades:6d}")
    print("=" * 70)
