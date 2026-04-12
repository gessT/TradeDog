"""
TPC Optimizer — Grid search for best parameters
==================================================
Searches over key parameters, scores by win rate + ROI + drawdown.
Focuses on ≥65% WR with maximum ROI and controlled DD.
"""
from __future__ import annotations

import itertools
import logging
from concurrent.futures import ProcessPoolExecutor, as_completed

import pandas as pd

from .backtest import TPCBacktester, TPCResult
from .config import DEFAULT_TPC_PARAMS

logger = logging.getLogger(__name__)


PARAM_GRID: dict[str, list] = {
    "w_st_mult":          [2.0, 3.0, 4.0],
    "d_adx_min":          [15, 20, 25],
    "d_ht_amplitude":     [3, 5, 7],
    "pullback_atr_dist":  [1.0, 1.5, 2.0, 2.5],
    "h_vol_multiplier":   [1.0, 1.2, 1.5],
    "h_body_ratio_min":   [0.30, 0.40, 0.50],
    "tp1_r_mult":         [1.0, 1.5, 2.0],
    "tp2_r_mult":         [2.5, 3.0, 4.0],
    "atr_sl_mult":        [1.5, 2.0, 2.5],
    "trailing_atr_mult":  [2.0, 2.5, 3.0],
}

# Total: 3×3×3×4×3×3×3×3×3×3 = 78,732 combos — too many
# Use FOCUSED grid: fix some, vary key ones
FOCUSED_GRID: dict[str, list] = {
    "w_st_mult":          [2.0, 3.0, 4.0],
    "d_adx_min":          [15, 20, 25],
    "pullback_atr_dist":  [1.0, 1.5, 2.0],
    "tp1_r_mult":         [1.0, 1.5, 2.0],
    "tp2_r_mult":         [2.5, 3.0, 4.0],
    "atr_sl_mult":        [1.5, 2.0, 2.5],
}
# 3×3×3×3×3×3 = 729 combos — manageable


def _score(result: TPCResult) -> float:
    """Score a backtest result. Higher = better.

    Weights:
      - Win rate ≥65% gets big bonus, ≥75% gets super bonus
      - ROI contribution (scaled)
      - Drawdown penalty
      - Trade count bonus (prefer fewer, quality trades)
      - Profit factor bonus
      - Risk-reward ratio bonus
    """
    wr = result.win_rate
    roi = result.total_return_pct
    dd = result.max_drawdown_pct
    pf = result.profit_factor
    rr = result.risk_reward_ratio
    n_trades = result.total_trades

    if n_trades < 3:
        return -100.0

    score = 0.0

    # Win rate bonuses
    score += max(0, wr - 50) * 1.0        # Base: 1pt per % above 50
    score += max(0, wr - 65) * 2.0        # Bonus: 2pt per % above 65 target
    score += max(0, wr - 75) * 3.0        # Super: 3pt per % above 75

    # ROI contribution (capped to avoid overfitting)
    score += min(roi * 0.2, 30)

    # Drawdown penalty
    score -= dd * 0.3

    # Profit factor bonus
    if pf < 999:
        score += min(pf * 2, 15)

    # Risk-reward bonus
    if rr < 999:
        score += min(rr * 3, 10)

    # Prefer moderate trade counts (5-30 trades for reliability)
    if 5 <= n_trades <= 30:
        score += 5
    elif n_trades > 30:
        score -= (n_trades - 30) * 0.3  # Penalty for overtrading

    return round(score, 2)


def _run_single(
    params: dict,
    symbol: str,
    period: str,
    capital: float,
    df_weekly: pd.DataFrame,
    df_daily: pd.DataFrame,
    df_1h: pd.DataFrame,
) -> tuple[dict, TPCResult, float]:
    """Run one backtest with given params. Returns (params, result, score)."""
    bt = TPCBacktester(capital=capital)
    result = bt.run(
        symbol=symbol,
        period=period,
        params=params,
        df_weekly=df_weekly,
        df_daily=df_daily,
        df_1h=df_1h,
    )
    sc = _score(result)
    return params, result, sc


def optimize(
    symbol: str = "AAPL",
    period: str = "2y",
    capital: float = 5000.0,
    top_n: int = 10,
    grid: dict | None = None,
    df_weekly: pd.DataFrame | None = None,
    df_daily: pd.DataFrame | None = None,
    df_1h: pd.DataFrame | None = None,
) -> list[dict]:
    """Run grid search optimization.

    Returns top_n results sorted by score, each dict:
      {"params": {...}, "win_rate": ..., "return_pct": ..., "max_dd": ...,
       "profit_factor": ..., "rr_ratio": ..., "trades": ..., "score": ...}
    """
    from strategies.futures.data_loader import load_yfinance

    # Load data once
    if df_weekly is None:
        df_weekly = load_yfinance(symbol, interval="1wk", period="5y")
    if df_daily is None:
        df_daily = load_yfinance(symbol, interval="1d", period="5y")
    if df_1h is None:
        df_1h = load_yfinance(symbol, interval="1h", period="730d")

    search_grid = grid or FOCUSED_GRID
    keys = list(search_grid.keys())
    values = list(search_grid.values())
    combos = list(itertools.product(*values))
    logger.info("TPC optimizer: %d combinations for %s", len(combos), symbol)

    results: list[tuple[dict, TPCResult, float]] = []

    for combo in combos:
        param_overrides = {**DEFAULT_TPC_PARAMS}
        for k, v in zip(keys, combo):
            param_overrides[k] = v

        try:
            _, result, sc = _run_single(
                param_overrides, symbol, period, capital,
                df_weekly, df_daily, df_1h,
            )
            results.append((param_overrides, result, sc))
        except Exception as e:
            logger.warning("Combo failed: %s — %s", combo, e)

    # Sort by score descending
    results.sort(key=lambda x: x[2], reverse=True)

    top_results = []
    for params, result, sc in results[:top_n]:
        top_results.append({
            "params": params,
            "win_rate": result.win_rate,
            "return_pct": result.total_return_pct,
            "max_dd": result.max_drawdown_pct,
            "profit_factor": result.profit_factor,
            "rr_ratio": result.risk_reward_ratio,
            "trades": result.total_trades,
            "sharpe": result.sharpe_ratio,
            "score": sc,
        })

    return top_results
