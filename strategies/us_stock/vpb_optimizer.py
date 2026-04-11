"""
VPB Optimizer — Grid search over key parameters
=================================================
Optimises volume multiplier, EMA length, consolidation window,
TP R-multiple, and body ratio to maximise win rate + ROI.
"""
from __future__ import annotations

import itertools
import logging
from dataclasses import dataclass

import pandas as pd

from .vpb_backtest import VPBBacktester, VPBResult

logger = logging.getLogger(__name__)


@dataclass
class OptResult:
    params: dict
    win_rate: float
    total_return_pct: float
    max_drawdown_pct: float
    profit_factor: float
    sharpe_ratio: float
    total_trades: int
    score: float  # composite ranking metric


# ═══════════════════════════════════════════════════════════════════════
# Parameter Search Space
# ═══════════════════════════════════════════════════════════════════════

PARAM_GRID: dict[str, list] = {
    "vol_multiplier": [1.3, 1.5, 1.8, 2.0, 2.5],
    "ema_period": [20, 28, 34, 50],
    "consol_window": [10, 15, 20],
    "tp_r_multiple": [1.5, 2.0, 2.5, 3.0],
    "body_ratio_min": [0.45, 0.55, 0.65],
    "consol_range_atr_mult": [3.5, 4.0, 5.0, 6.0],
    "close_near_extreme_pct": [0.25, 0.30, 0.40],
}

# Smaller focused grid for fast iteration
PARAM_GRID_FAST: dict[str, list] = {
    "vol_multiplier": [1.5, 2.0],
    "ema_period": [28, 50],
    "consol_window": [10, 15, 20],
    "tp_r_multiple": [1.5, 2.0, 2.5],
    "consol_range_atr_mult": [4.0, 5.0, 6.0],
}


def optimize(
    df: pd.DataFrame,
    grid: dict[str, list] | None = None,
    capital: float = 25_000.0,
    min_trades: int = 10,
    top_n: int = 10,
) -> list[OptResult]:
    """
    Run grid search over parameter combinations.

    Parameters
    ----------
    df : DataFrame with OHLCV (DatetimeIndex)
    grid : parameter grid (defaults to PARAM_GRID_FAST)
    capital : starting capital
    min_trades : skip configs with fewer trades
    top_n : return top N results

    Returns
    -------
    List of OptResult sorted by composite score (desc).
    """
    if grid is None:
        grid = PARAM_GRID_FAST

    keys = list(grid.keys())
    values = list(grid.values())
    combos = list(itertools.product(*values))
    total = len(combos)
    logger.info("VPB Optimizer: %d combinations to test", total)

    results: list[OptResult] = []
    bt = VPBBacktester(capital=capital)

    for idx, combo in enumerate(combos):
        override = dict(zip(keys, combo))
        try:
            res = bt.run(df, params=override)
        except Exception:
            logger.debug("Combo %d/%d failed: %s", idx + 1, total, override)
            continue

        if res.total_trades < min_trades:
            continue

        # Composite score: weighted blend targeting WR>60% and ROI>20%
        wr_bonus = max(0, res.win_rate - 50) * 0.5   # reward WR above 50%
        roi_bonus = max(0, res.total_return_pct) * 0.3
        dd_penalty = res.max_drawdown_pct * 0.2
        pf_bonus = min(res.profit_factor, 5) * 2
        score = wr_bonus + roi_bonus - dd_penalty + pf_bonus

        results.append(OptResult(
            params=override,
            win_rate=res.win_rate,
            total_return_pct=res.total_return_pct,
            max_drawdown_pct=res.max_drawdown_pct,
            profit_factor=res.profit_factor,
            sharpe_ratio=res.sharpe_ratio,
            total_trades=res.total_trades,
            score=round(score, 2),
        ))

        if (idx + 1) % 50 == 0:
            logger.info("  %d/%d done …", idx + 1, total)

    results.sort(key=lambda r: r.score, reverse=True)
    return results[:top_n]


def optimize_full(df: pd.DataFrame, **kwargs) -> list[OptResult]:
    """Run the full (larger) parameter grid."""
    return optimize(df, grid=PARAM_GRID, **kwargs)
