"""
optimizer.py — Grid-search parameter optimizer for HalfTrend + Weekly Supertrend.

Optimizes:
  - HalfTrend amplitude (3–10)
  - channelDeviation (1–3)
  - Supertrend ATR (7–14)
  - Supertrend factor (2–4)
  - SL (0.5–2 ATR)
  - TP (1–3 ATR)

Goals:
  - Win rate ≥ 65%
  - Maximize net profit
  - Keep drawdown < 20%
"""
from __future__ import annotations

import itertools
import pickle
from concurrent.futures import ProcessPoolExecutor
from dataclasses import asdict

import pandas as pd

from .backtest import BacktestResult, run_backtest
from .strategy import StrategyParams


# ─── Default parameter grid ───────────────────────────────────────────
DEFAULT_GRID: dict[str, list] = {
    "ht_amplitude":       [3, 5, 7, 10],
    "ht_channel_deviation": [1, 2, 3],
    "wst_atr_period":     [7, 10, 14],
    "wst_multiplier":     [2.0, 3.0, 4.0],
    "sl_atr_mult":        [0.5, 1.0, 1.5, 2.0],
    "tp_atr_mult":        [1.0, 1.5, 2.0, 3.0],
}
# Total combos = 4×3×3×3×4×4 = 1,728

# Smaller grid for quick sweep
QUICK_GRID: dict[str, list] = {
    "ht_amplitude":       [3, 5, 7],
    "ht_channel_deviation": [1, 2],
    "wst_atr_period":     [10],
    "wst_multiplier":     [3.0],
    "sl_atr_mult":        [0.5, 1.0, 1.5],
    "tp_atr_mult":        [1.5, 2.0, 2.5],
}
# Total combos = 3×2×1×1×3×3 = 54


def composite_score(r: BacktestResult) -> float:
    """Weighted composite score for ranking parameter sets."""
    if r.total_trades < 5:
        return -999.0
    # Penalize drawdown > 20%
    dd_penalty = max(0, r.max_drawdown_pct - 20.0) * 0.5
    return (
        r.win_rate * 0.40
        + r.total_return_pct * 0.30
        - r.max_drawdown_pct * 0.20
        - dd_penalty
        + r.profit_factor * 2.0
    )


def _run_one(args: tuple) -> tuple[dict, BacktestResult, float] | None:
    """Worker function for parallel execution."""
    df_bytes, param_dict, capital = args
    df = pickle.loads(df_bytes)
    params = StrategyParams(**param_dict)
    try:
        result = run_backtest(df, params, capital)
    except Exception:
        return None
    score = composite_score(result)
    return param_dict, result, score


def optimize(
    df: pd.DataFrame,
    grid: dict[str, list] | None = None,
    capital: float = 100_000.0,
    min_win_rate: float = 50.0,
    min_trades: int = 5,
    workers: int = 4,
    top_n: int = 10,
) -> list[tuple[dict, BacktestResult, float]]:
    """
    Run grid-search optimisation.

    Returns top_n results sorted by composite score (descending).
    """
    if grid is None:
        grid = DEFAULT_GRID

    keys = list(grid.keys())
    combos = list(itertools.product(*[grid[k] for k in keys]))
    param_dicts = [dict(zip(keys, vals)) for vals in combos]
    total = len(param_dicts)
    print(f"🔍 Optimizer: {total} parameter combinations to test")

    df_bytes = pickle.dumps(df)
    tasks = [(df_bytes, pd, capital) for pd in param_dicts]

    results: list[tuple[dict, BacktestResult, float]] = []
    done = 0

    with ProcessPoolExecutor(max_workers=workers) as pool:
        for item in pool.map(_run_one, tasks, chunksize=max(1, total // (workers * 4))):
            done += 1
            if done % 100 == 0 or done == total:
                print(f"  ... {done}/{total}")
            if item is None:
                continue
            param_dict, result, score = item
            if result.win_rate >= min_win_rate and result.total_trades >= min_trades:
                results.append((param_dict, result, score))

    results.sort(key=lambda x: x[2], reverse=True)
    return results[:top_n]


def print_results(results: list[tuple[dict, BacktestResult, float]]) -> None:
    """Pretty-print the top optimisation results."""
    print("\n" + "═" * 110)
    print("  🏆  TOP PARAMETER COMBINATIONS")
    print("═" * 110)
    header = f"{'#':>3}  {'Win%':>6}  {'Return%':>9}  {'MaxDD%':>7}  {'PF':>5}  {'RR':>5}  {'Trades':>6}  {'Sharpe':>7}  {'Score':>7}  Key Params"
    print(header)
    print("─" * 110)

    for rank, (params, r, score) in enumerate(results, 1):
        key_str = (
            f"HT({params.get('ht_amplitude','')}/{params.get('ht_channel_deviation','')}) "
            f"WST({params.get('wst_atr_period','')}/{params.get('wst_multiplier','')}) "
            f"SL/TP({params.get('sl_atr_mult','')}/{params.get('tp_atr_mult','')})"
        )
        print(
            f"{rank:>3}  {r.win_rate:>5.1f}%  {r.total_return_pct:>+8.1f}%  "
            f"{r.max_drawdown_pct:>6.1f}%  {r.profit_factor:>5.2f}  {r.risk_reward:>5.2f}  "
            f"{r.total_trades:>6}  {r.sharpe_ratio:>7.2f}  {score:>7.1f}  {key_str}"
        )
    print("═" * 110)
