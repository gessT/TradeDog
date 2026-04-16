"""
metrics.py — Performance metrics computation for HPB backtest results.
"""
from __future__ import annotations

import numpy as np

from .backtest import Trade, BacktestResult


def compute_metrics(trades: list[Trade], equity_curve: list[float],
                    initial_capital: float) -> BacktestResult:
    """Build a BacktestResult from a list of trades and equity curve."""
    result = BacktestResult()
    result.trades = trades
    result.initial_capital = initial_capital
    result.equity_curve = equity_curve

    if not equity_curve:
        return result

    result.final_equity = round(equity_curve[-1], 2)
    result.total_return_pct = round(
        (equity_curve[-1] - initial_capital) / initial_capital * 100.0, 2
    )
    result.total_trades = len(trades)

    if trades:
        wins = [t for t in trades if t.win]
        losses = [t for t in trades if not t.win]
        result.winners = len(wins)
        result.losers = len(losses)
        result.win_rate = round(len(wins) / len(trades) * 100.0, 2)

        if wins:
            result.avg_win_pct = round(float(np.mean([t.return_pct for t in wins])), 2)
        if losses:
            result.avg_loss_pct = round(float(np.mean([t.return_pct for t in losses])), 2)

        sum_wins = sum(t.pnl for t in wins)
        sum_losses = abs(sum(t.pnl for t in losses))
        result.profit_factor = (
            round(sum_wins / sum_losses, 2) if sum_losses > 0 else 999.0
        )
        result.risk_reward = (
            round(abs(result.avg_win_pct / result.avg_loss_pct), 2)
            if result.avg_loss_pct != 0 else 0.0
        )

    # Max drawdown
    eq = np.array(equity_curve)
    peak = np.maximum.accumulate(eq)
    dd = (peak - eq) / np.where(peak > 0, peak, 1.0)
    result.max_drawdown_pct = round(float(np.max(dd)) * 100.0, 2)

    # Sharpe ratio (daily returns → annualised)
    if len(equity_curve) > 2:
        rets = np.diff(equity_curve) / np.maximum(np.array(equity_curve[:-1]), 1.0)
        if np.std(rets) > 0:
            result.sharpe_ratio = round(
                float(np.mean(rets) / np.std(rets) * np.sqrt(252)), 2
            )

    return result
