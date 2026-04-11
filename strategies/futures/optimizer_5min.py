"""
5-Minute Optimizer — Grid search for 5min strategy parameters
==============================================================
• Parameter grid tuned for 5-minute scalping
• Filters: win_rate ≥ 60%, trades ≥ 30, max_dd ≤ 20%
• Composite score: 0.40×win_rate + 0.35×return - 0.25×drawdown
• Out-of-sample validation (70/30 split)
• Process-pool parallelisation
"""
from __future__ import annotations

import logging
from concurrent.futures import ProcessPoolExecutor
from dataclasses import dataclass
from itertools import product

import pandas as pd

from .backtest_5min import Backtester5Min, BacktestResult5Min
from .strategy_5min import DEFAULT_5MIN_PARAMS

logger = logging.getLogger(__name__)

# ═══════════════════════════════════════════════════════════════════════
# Default parameter grid  (5min-specific)
# ═══════════════════════════════════════════════════════════════════════

DEFAULT_5MIN_GRID: dict[str, list] = {
    "ema_fast":         [7, 9, 12],
    "ema_slow":         [21, 30],
    "atr_sl_mult":      [2.0, 2.5, 3.0],
    "atr_tp_mult":      [2.0, 2.5, 3.0],
    "st_period":        [7, 10],
    "st_mult":          [1.5, 2.0, 3.0],
    "pullback_atr_mult": [1.5, 2.0, 3.0],
    "vol_spike_mult":   [0.6, 0.8, 1.0],
    "macd_fast":        [8, 12],
    "macd_slow":        [17, 26],
}
# Total combos: 3×3×2×2×3×3×2×3×3×3×2×2 = 69,984 (use sampling)

# Smaller grid for quick optimisation
QUICK_5MIN_GRID: dict[str, list] = {
    "ema_fast":         [7, 9],
    "ema_slow":         [21, 30],
    "atr_sl_mult":      [2.5, 3.0],
    "atr_tp_mult":      [2.0, 2.5, 3.0],
    "st_period":        [7, 10],
    "st_mult":          [1.5, 2.0],
    "pullback_atr_mult": [1.5, 2.0],
    "vol_spike_mult":   [0.8, 1.0],
}
# Total combos: 2×2×3×3×2×2×2×2 = 576


# ═══════════════════════════════════════════════════════════════════════
# Scoring
# ═══════════════════════════════════════════════════════════════════════

def composite_score_5min(result: BacktestResult5Min) -> float:
    """Weighted score prioritising win rate and risk-adjusted return."""
    wr = result.win_rate / 100          # 0-1
    ret = result.total_return_pct / 100  # normalised
    dd = result.max_drawdown_pct / 100   # 0-1
    return 0.40 * wr + 0.35 * ret - 0.25 * dd


# ═══════════════════════════════════════════════════════════════════════
# Filter thresholds
# ═══════════════════════════════════════════════════════════════════════

MIN_WIN_RATE = 60.0
MIN_TRADES = 30
MAX_DRAWDOWN = 20.0


# ═══════════════════════════════════════════════════════════════════════
# Worker
# ═══════════════════════════════════════════════════════════════════════

@dataclass
class _Job:
    df_pickle: bytes
    params: dict
    oos_split: float


def _run_one(job: _Job) -> tuple[dict, BacktestResult5Min] | None:
    """Worker function for process pool."""
    df = pd.read_pickle(pd.io.common.BytesIO(job.df_pickle))
    bt = Backtester5Min()
    try:
        result = bt.run(df, job.params, oos_split=job.oos_split)
    except Exception:
        return None
    return job.params, result


# ═══════════════════════════════════════════════════════════════════════
# Main optimiser
# ═══════════════════════════════════════════════════════════════════════

def optimize_5min(
    df: pd.DataFrame,
    grid: dict[str, list] | None = None,
    oos_split: float = 0.3,
    min_win_rate: float = MIN_WIN_RATE,
    min_trades: int = MIN_TRADES,
    max_drawdown: float = MAX_DRAWDOWN,
    max_workers: int | None = None,
    quick: bool = False,
) -> list[tuple[dict, BacktestResult5Min, float]]:
    """Grid-search optimisation for 5min strategy.

    Returns list of (params, result, score) sorted by score descending.
    """
    if grid is None:
        grid = QUICK_5MIN_GRID if quick else DEFAULT_5MIN_GRID

    # Generate parameter combinations
    keys = sorted(grid.keys())
    combos = list(product(*(grid[k] for k in keys)))
    logger.info("5min optimiser: %d combos to evaluate", len(combos))

    # Pickle dataframe once for all workers
    buf = pd.io.common.BytesIO()
    df.to_pickle(buf)
    df_bytes = buf.getvalue()

    jobs = []
    for values in combos:
        params = {**DEFAULT_5MIN_PARAMS, **dict(zip(keys, values))}
        jobs.append(_Job(df_pickle=df_bytes, params=params, oos_split=oos_split))

    # Run in parallel
    results: list[tuple[dict, BacktestResult5Min, float]] = []
    with ProcessPoolExecutor(max_workers=max_workers) as pool:
        for out in pool.map(_run_one, jobs):
            if out is None:
                continue
            params, result = out
            # Apply filters
            if result.total_trades < min_trades:
                continue
            if result.win_rate < min_win_rate:
                continue
            if result.max_drawdown_pct > max_drawdown:
                continue
            score = composite_score_5min(result)
            results.append((params, result, score))

    results.sort(key=lambda x: x[2], reverse=True)
    logger.info("5min optimiser: %d combinations passed filters", len(results))
    return results


def print_top_results(results: list[tuple[dict, BacktestResult5Min, float]], top_n: int = 5) -> None:
    """Print top N optimisation results."""
    for i, (params, res, score) in enumerate(results[:top_n]):
        print(f"\n{'='*60}")
        print(f"  Rank #{i+1}  |  Score: {score:.4f}")
        print(f"{'='*60}")
        print(f"  Win Rate:   {res.win_rate:.1f}%  ({res.winners}W / {res.losers}L)")
        print(f"  Return:     {res.total_return_pct:+.2f}%")
        print(f"  Max DD:     {res.max_drawdown_pct:.2f}%")
        print(f"  Sharpe:     {res.sharpe_ratio:.2f}")
        print(f"  PF:         {res.profit_factor:.2f}")
        print(f"  R:R:        1:{res.risk_reward_ratio:.2f}")
        print(f"  Trades:     {res.total_trades}")
        if res.oos_total_trades > 0:
            print(f"  OOS WR:     {res.oos_win_rate:.1f}% ({res.oos_total_trades} trades)")
            print(f"  OOS Return: {res.oos_return_pct:+.2f}%")
        # Key params
        show_keys = [
            "ema_fast", "ema_slow", "atr_sl_mult", "atr_tp_mult",
            "st_period", "st_mult", "pullback_atr_mult", "vol_spike_mult",
            "macd_fast", "macd_slow",
        ]
        p_str = ", ".join(f"{k}={params[k]}" for k in show_keys if k in params)
        print(f"  Params:     {p_str}")
