"""
MGC Parameter Optimizer — Grid Search
======================================
Systematically searches parameter combinations to find the best
win-rate / return / drawdown profile.

Usage:
    python -m mgc_trading.optimizer          # standalone
    from strategies.futures.optimizer import optimize  # library
"""
from __future__ import annotations

import itertools
import logging
import time
from concurrent.futures import ProcessPoolExecutor, as_completed
from dataclasses import dataclass

import pandas as pd

from .backtest import BacktestResult, Backtester, print_result
from .config import DEFAULT_PARAMS, INITIAL_CAPITAL

logger = logging.getLogger(__name__)


# ═══════════════════════════════════════════════════════════════════════
# Default Search Grid
# ═══════════════════════════════════════════════════════════════════════

DEFAULT_GRID: dict[str, list] = {
    "ema_fast":          [20, 50],
    "ema_slow":          [100, 200],
    "rsi_low":           [30, 40],
    "rsi_high":          [50, 55, 60],
    "atr_sl_mult":       [0.8, 1.0, 1.5],
    "atr_tp_mult":       [1.5, 2.0, 2.5, 3.0],
    "pullback_atr_mult": [1.0, 1.5, 2.0],
}
# Total combinations: 2×2×2×3×3×4×3 = 864 — runs in under a minute


# ═══════════════════════════════════════════════════════════════════════
# Score function
# ═══════════════════════════════════════════════════════════════════════

def composite_score(r: BacktestResult) -> float:
    """Rank results by weighted combination of win rate, return, and drawdown."""
    if r.total_trades < 3:
        return -999.0
    score = (
        r.win_rate * 0.40
        + r.total_return_pct * 0.35
        - r.max_drawdown_pct * 0.25
    )
    return round(score, 4)


# ═══════════════════════════════════════════════════════════════════════
# Single-combo runner (needs to be top-level for ProcessPoolExecutor)
# ═══════════════════════════════════════════════════════════════════════

@dataclass
class _Job:
    df_pickle: bytes
    params: dict
    capital: float


def _run_one(job: _Job) -> tuple[dict, BacktestResult]:
    df = pd.read_pickle(pd.io.common.BytesIO(job.df_pickle))  # type: ignore[arg-type]
    bt = Backtester(capital=job.capital)
    result = bt.run(df, job.params)
    return job.params, result


# ═══════════════════════════════════════════════════════════════════════
# Optimizer
# ═══════════════════════════════════════════════════════════════════════

def optimize(
    df: pd.DataFrame,
    grid: dict[str, list] | None = None,
    capital: float = INITIAL_CAPITAL,
    min_win_rate: float = 55.0,
    workers: int = 4,
    top_n: int = 10,
) -> list[tuple[dict, BacktestResult, float]]:
    """Run grid-search optimisation over parameter combinations.

    Returns top-N results as list of (params, BacktestResult, score),
    sorted by composite score descending.
    """
    grid = grid or DEFAULT_GRID

    # Build all combinations — merge with DEFAULT_PARAMS for fields not in grid
    keys = list(grid.keys())
    combos: list[dict] = []
    for vals in itertools.product(*(grid[k] for k in keys)):
        p = {**DEFAULT_PARAMS}
        for k, v in zip(keys, vals):
            p[k] = v
        combos.append(p)

    total = len(combos)
    logger.info("Optimiser: %d combinations  |  %d workers", total, workers)
    print(f"\n⚙️  Optimising over {total} parameter combinations …")

    # Serialize DataFrame once
    buf = pd.io.common.BytesIO()  # type: ignore[attr-defined]
    df.to_pickle(buf)
    df_bytes = buf.getvalue()

    results: list[tuple[dict, BacktestResult, float]] = []
    t0 = time.time()

    with ProcessPoolExecutor(max_workers=workers) as pool:
        futures = {
            pool.submit(_run_one, _Job(df_bytes, p, capital)): p
            for p in combos
        }
        done = 0
        for fut in as_completed(futures):
            done += 1
            if done % 100 == 0 or done == total:
                print(f"   … {done}/{total}", end="\r")
            params, bt_result = fut.result()
            sc = composite_score(bt_result)
            if bt_result.win_rate >= min_win_rate:
                results.append((params, bt_result, sc))

    elapsed = time.time() - t0
    results.sort(key=lambda x: x[2], reverse=True)
    results = results[:top_n]

    print(f"\n✅  Done in {elapsed:.1f}s — {len(results)} combos with win rate ≥ {min_win_rate:.0f} %\n")
    return results


# ═══════════════════════════════════════════════════════════════════════
# Pretty-print top results
# ═══════════════════════════════════════════════════════════════════════

def print_top_results(results: list[tuple[dict, BacktestResult, float]], top_n: int = 5) -> None:
    """Print a summary table of the top-N optimisation results."""
    print("═" * 90)
    print(f"  🏆  TOP {min(top_n, len(results))} PARAMETER COMBINATIONS")
    print("═" * 90)
    print(f"  {'#':>3}  {'Win%':>6}  {'Return%':>9}  {'MaxDD%':>7}  {'Sharpe':>7}  {'Trades':>6}  {'PF':>5}  {'Score':>7}  Key Params")
    print("─" * 90)
    for idx, (params, r, sc) in enumerate(results[:top_n], 1):
        key = (
            f"EMA {params['ema_fast']}/{params['ema_slow']}  "
            f"RSI {params['rsi_low']}/{params['rsi_high']}  "
            f"SL {params['atr_sl_mult']}×  TP {params['atr_tp_mult']}×  "
            f"PB {params['pullback_atr_mult']}×"
        )
        print(
            f"  {idx:3d}  {r.win_rate:5.1f}%  {r.total_return_pct:+8.2f}%  "
            f"{r.max_drawdown_pct:6.2f}%  {r.sharpe_ratio:7.2f}  "
            f"{r.total_trades:6d}  {r.profit_factor:5.2f}  {sc:7.2f}  {key}"
        )
    print("═" * 90)

    if results:
        print("\n🥇  BEST PARAMETERS:")
        best_params, best_result, _ = results[0]
        print_result(best_result)


# ═══════════════════════════════════════════════════════════════════════
# CLI
# ═══════════════════════════════════════════════════════════════════════

if __name__ == "__main__":
    from .data_loader import load_yfinance

    df = load_yfinance()
    results = optimize(df)
    print_top_results(results)
