"""
VPR Optimizer — Parameter sweep with walk-forward validation
==============================================================
Sweeps at most 2 parameters at a time.
Validates in-sample vs out-of-sample to reject overfitted sets.
"""
from __future__ import annotations

import itertools
import logging
from dataclasses import dataclass

import pandas as pd

from .backtest import VPRBacktester, VPRResult
from .config import DEFAULT_VPR_PARAMS, INITIAL_CAPITAL, RISK_PER_TRADE

logger = logging.getLogger(__name__)


@dataclass
class OptResult:
    params: dict
    is_win_rate: float
    is_return_pct: float
    is_trades: int
    oos_win_rate: float
    oos_return_pct: float
    oos_trades: int
    stable: bool  # True if OOS does not collapse


def optimize(
    df: pd.DataFrame,
    sweep_params: dict[str, list],
    oos_split: float = 0.3,
    capital: float = INITIAL_CAPITAL,
    min_oos_win_rate: float = 50.0,
    min_oos_return_pct: float = 5.0,
) -> list[OptResult]:
    """Grid search over sweep_params with time-split validation.

    Args:
        df: Full OHLCV DataFrame
        sweep_params: e.g. {"rsi_low": [40, 45, 50], "atr_sl_mult": [1.2, 1.3, 1.4]}
            Max 2 parameters allowed.
        oos_split: fraction of data reserved for out-of-sample (end portion)
        capital: starting capital
        min_oos_win_rate: OOS win rate floor to flag as "stable"
        min_oos_return_pct: OOS return floor to flag as "stable"

    Returns:
        List of OptResult sorted by IS win rate descending.
    """
    keys = list(sweep_params.keys())
    if len(keys) > 2:
        raise ValueError("Max 2 parameters can be swept simultaneously to avoid overfitting.")

    # Build parameter combinations
    value_lists = [sweep_params[k] for k in keys]
    combos = list(itertools.product(*value_lists))
    logger.info("Optimizer: %d combinations for %s", len(combos), keys)

    # Time split
    split_idx = int(len(df) * (1 - oos_split))
    df_is = df.iloc[:split_idx]
    df_oos = df.iloc[split_idx:]

    if len(df_is) < 100 or len(df_oos) < 50:
        raise ValueError(f"Not enough data for optimization: IS={len(df_is)}, OOS={len(df_oos)}")

    results: list[OptResult] = []

    for combo in combos:
        override = {keys[i]: combo[i] for i in range(len(keys))}
        full_params = {**DEFAULT_VPR_PARAMS, **override}

        bt = VPRBacktester(capital=capital, risk_per_trade=RISK_PER_TRADE)

        # In-sample
        is_result = bt.run(df_is, params=full_params)

        # Out-of-sample
        oos_result = bt.run(df_oos, params=full_params)

        stable = (
            oos_result.win_rate >= min_oos_win_rate
            and oos_result.total_return_pct >= min_oos_return_pct
        )

        results.append(OptResult(
            params=full_params,
            is_win_rate=is_result.win_rate,
            is_return_pct=is_result.total_return_pct,
            is_trades=is_result.total_trades,
            oos_win_rate=oos_result.win_rate,
            oos_return_pct=oos_result.total_return_pct,
            oos_trades=oos_result.total_trades,
            stable=stable,
        ))

    results.sort(key=lambda r: r.is_win_rate, reverse=True)
    return results


def walk_forward(
    df: pd.DataFrame,
    params: dict | None = None,
    n_folds: int = 4,
    capital: float = INITIAL_CAPITAL,
) -> list[dict]:
    """Walk-forward analysis: split data into n_folds sequential segments.

    Each fold is tested independently to check for time-stability.
    Returns list of dicts with per-fold metrics.
    """
    full_params = {**DEFAULT_VPR_PARAMS, **(params or {})}
    fold_size = len(df) // n_folds
    if fold_size < 50:
        raise ValueError(f"Not enough data for {n_folds}-fold walk-forward ({len(df)} bars)")

    fold_results: list[dict] = []
    for fold_idx in range(n_folds):
        start = fold_idx * fold_size
        end = (fold_idx + 1) * fold_size if fold_idx < n_folds - 1 else len(df)
        df_fold = df.iloc[start:end]

        bt = VPRBacktester(capital=capital, risk_per_trade=RISK_PER_TRADE)
        result = bt.run(df_fold, params=full_params)

        fold_results.append({
            "fold": fold_idx + 1,
            "bars": len(df_fold),
            "start": str(df_fold.index[0])[:10],
            "end": str(df_fold.index[-1])[:10],
            "trades": result.total_trades,
            "win_rate": result.win_rate,
            "return_pct": result.total_return_pct,
            "max_dd_pct": result.max_drawdown_pct,
            "profit_factor": result.profit_factor,
            "expectancy": result.expectancy,
        })

    return fold_results
