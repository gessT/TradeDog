"""
VPB v2 Optimizer — Grid search targeting 75%+ win rate
=======================================================
Prioritises win rate in the composite score to find
configurations that trade less often but win more.
"""
from __future__ import annotations

import itertools
import logging
from dataclasses import dataclass

import pandas as pd

from .vpb_v2_backtest import VPB2Backtester, VPB2Result

logger = logging.getLogger(__name__)


@dataclass
class Opt2Result:
    params: dict
    win_rate: float
    total_return_pct: float
    max_drawdown_pct: float
    profit_factor: float
    sharpe_ratio: float
    total_trades: int
    score: float


# ═══════════════════════════════════════════════════════════════════════
# Parameter Search Space
# ═══════════════════════════════════════════════════════════════════════

PARAM_GRID_V2: dict[str, list] = {
    "ema_fast":             [20, 28, 34],
    "vol_multiplier":       [1.2, 1.5, 2.0],
    "vol_ramp_bars":        [0, 1, 2],
    "body_ratio_min":       [0.55, 0.60, 0.65],
    "body_atr_min":         [0.3, 0.4, 0.6],
    "close_near_high_pct":  [0.30, 0.40],
    "tp_r_multiple":        [0.8, 1.0, 1.2],
    "consol_range_atr_mult":[4.0, 5.0, 7.0],
    "retest_tolerance_atr": [0.8, 1.0, 1.5],
    "ema_slope_min":        [0.0001, 0.0005, 0.001],
}

PARAM_GRID_V2_FAST: dict[str, list] = {
    "vol_multiplier":       [1.2, 1.5, 2.0],
    "body_ratio_min":       [0.55, 0.60, 0.65],
    "tp_r_multiple":        [0.8, 1.0, 1.2],
    "consol_range_atr_mult":[4.0, 5.0, 7.0],
    "ema_slope_min":        [0.0001, 0.0005, 0.001],
}


def optimize_v2(
    df: pd.DataFrame,
    grid: dict[str, list] | None = None,
    capital: float = 25_000.0,
    min_trades: int = 5,
    top_n: int = 10,
) -> list[Opt2Result]:
    if grid is None:
        grid = PARAM_GRID_V2_FAST

    keys = list(grid.keys())
    values = list(grid.values())
    combos = list(itertools.product(*values))
    total = len(combos)
    logger.info("VPB v2 Optimizer: %d combinations", total)

    results: list[Opt2Result] = []
    bt = VPB2Backtester(capital=capital)

    for idx, combo in enumerate(combos):
        override = dict(zip(keys, combo))
        try:
            res = bt.run(df, params=override)
        except Exception:
            logger.debug("Combo %d/%d failed: %s", idx + 1, total, override)
            continue

        if res.total_trades < min_trades:
            continue

        # Score heavily weighted toward win rate
        wr_bonus = max(0, res.win_rate - 60) * 1.0     # strong reward above 60%
        wr_super = max(0, res.win_rate - 75) * 2.0     # extra bonus above 75%
        roi_bonus = max(0, res.total_return_pct) * 0.15
        dd_penalty = res.max_drawdown_pct * 0.15
        pf_bonus = min(res.profit_factor, 5) * 1.5
        trade_bonus = min(res.total_trades, 50) * 0.05  # small reward for more trades
        score = wr_bonus + wr_super + roi_bonus - dd_penalty + pf_bonus + trade_bonus

        results.append(Opt2Result(
            params=override,
            win_rate=res.win_rate,
            total_return_pct=res.total_return_pct,
            max_drawdown_pct=res.max_drawdown_pct,
            profit_factor=res.profit_factor,
            sharpe_ratio=res.sharpe_ratio,
            total_trades=res.total_trades,
            score=round(score, 2),
        ))

        if (idx + 1) % 100 == 0:
            logger.info("  %d/%d done …", idx + 1, total)

    results.sort(key=lambda r: r.score, reverse=True)
    return results[:top_n]


def optimize_v2_full(df: pd.DataFrame, **kwargs) -> list[Opt2Result]:
    """Run the full parameter grid."""
    return optimize_v2(df, grid=PARAM_GRID_V2, **kwargs)
