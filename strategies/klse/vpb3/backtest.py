"""
backtest.py — Bar-by-bar backtester for VPB3 Malaysia (量价突破).

Entry: signal at bar[i] → enter at bar[i+1] open
Exit:  SL (swing low) / TP (R-multiple) / Trailing stop
"""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
import pandas as pd

from .strategy import DEFAULT_PARAMS, build_indicators, generate_signals


@dataclass
class Trade:
    entry_date: str
    exit_date: str
    entry_price: float
    exit_price: float
    sl_price: float
    tp_price: float
    pnl: float
    return_pct: float
    rr: float
    bars_held: int
    exit_reason: str
    win: bool


@dataclass
class OpenPosition:
    entry_price: float
    entry_date: str
    entry_idx: int
    sl: float
    tp: float
    qty: float
    trail_stop: float = 0.0
    peak_price: float = 0.0


@dataclass
class BacktestResult:
    trades: list[Trade] = field(default_factory=list)
    initial_capital: float = 5000.0
    final_equity: float = 0.0
    total_return_pct: float = 0.0
    total_trades: int = 0
    winners: int = 0
    losers: int = 0
    win_rate: float = 0.0
    avg_win_pct: float = 0.0
    avg_loss_pct: float = 0.0
    profit_factor: float = 0.0
    risk_reward: float = 0.0
    max_drawdown_pct: float = 0.0
    sharpe_ratio: float = 0.0
    equity_curve: list[float] = field(default_factory=list)


def _close_trade(pos: OpenPosition, exit_price: float, exit_date: str,
                  bar_idx: int, reason: str) -> Trade:
    pnl = (exit_price - pos.entry_price) * pos.qty
    ret_pct = (exit_price - pos.entry_price) / pos.entry_price * 100.0
    risk = pos.entry_price - pos.sl
    rr = (exit_price - pos.entry_price) / risk if risk > 0 else 0.0
    return Trade(
        entry_date=pos.entry_date,
        exit_date=exit_date,
        entry_price=round(pos.entry_price, 4),
        exit_price=round(exit_price, 4),
        sl_price=round(pos.sl, 4),
        tp_price=round(pos.tp, 4),
        pnl=round(pnl, 2),
        return_pct=round(ret_pct, 2),
        rr=round(rr, 2),
        bars_held=bar_idx - pos.entry_idx,
        exit_reason=reason,
        win=pnl > 0,
    )


def run_backtest(df: pd.DataFrame, params: dict | None = None,
                 capital: float = 5000.0,
                 disabled_conditions: set[str] | None = None) -> BacktestResult:
    """Run VPB3 Malaysia backtest on daily data."""
    p = {**DEFAULT_PARAMS, **(params or {})}
    disabled = disabled_conditions or set()

    df = build_indicators(df, p)
    entry_signals = generate_signals(df, p, disabled)

    # Date column
    if isinstance(df.index, pd.DatetimeIndex):
        dates = df.index.strftime("%Y-%m-%d").values
    elif "date" in df.columns:
        dates = df["date"].astype(str).values
    else:
        dates = np.arange(len(df)).astype(str)

    opens = df["open"].values.astype(float)
    highs = df["high"].values.astype(float)
    lows = df["low"].values.astype(float)
    closes = df["close"].values.astype(float)
    atr_arr = df["atr"].values.astype(float)
    swing_low = df["swing_low"].values.astype(float)

    n = len(df)
    equity = capital
    equity_curve = [capital]
    trades: list[Trade] = []
    position: OpenPosition | None = None
    cooldown_remaining = 0

    sl_enabled = "sl_exit" not in disabled
    tp_enabled = "tp_exit" not in disabled
    trail_enabled = p["use_trailing"] and "trail_exit" not in disabled

    for i in range(1, n):
        # ─── EXIT CHECK ────────────────────────────
        if position is not None:
            closed = False

            # Update peak for trailing
            if trail_enabled and highs[i] > position.peak_price:
                position.peak_price = highs[i]
                new_trail = position.peak_price - p["trailing_atr_mult"] * atr_arr[i]
                if not np.isnan(new_trail) and new_trail > position.trail_stop:
                    position.trail_stop = new_trail

            # TP hit
            if not closed and tp_enabled and highs[i] >= position.tp:
                t = _close_trade(position, position.tp, dates[i], i, "TP")
                equity += t.pnl
                trades.append(t)
                position = None
                cooldown_remaining = p["cooldown_bars"]
                closed = True

            # SL / trailing stop hit
            if not closed and position is not None:
                effective_sl = position.trail_stop if trail_enabled and position.trail_stop > position.sl else position.sl
                if sl_enabled and lows[i] <= effective_sl:
                    exit_p = effective_sl
                    reason = "TRAIL" if trail_enabled and position.trail_stop > position.sl else "SL"
                    t = _close_trade(position, exit_p, dates[i], i, reason)
                    equity += t.pnl
                    trades.append(t)
                    position = None
                    cooldown_remaining = p["cooldown_bars"]
                    closed = True

        # ─── ENTRY CHECK ──────────────────────────
        # Signal at bar[i-1] → enter at bar[i] open
        if position is None and cooldown_remaining <= 0 and entry_signals[i - 1]:
            entry_price = opens[i]
            if entry_price > 0 and not np.isnan(atr_arr[i]):
                # SL from swing low
                sl_price = swing_low[i - 1] if not np.isnan(swing_low[i - 1]) else entry_price - 1.5 * atr_arr[i]

                # Ensure min SL distance
                min_dist = p["min_sl_atr"] * atr_arr[i]
                if entry_price - sl_price < min_dist:
                    sl_price = entry_price - min_dist

                if sl_price >= entry_price:
                    sl_price = entry_price * 0.97

                risk = entry_price - sl_price
                if risk <= 0:
                    equity_curve.append(equity)
                    if cooldown_remaining > 0:
                        cooldown_remaining -= 1
                    continue

                # TP
                tp_price = entry_price + p["tp_r_multiple"] * risk

                # Position sizing
                risk_amount = equity * (p["risk_pct"] / 100.0)
                qty = risk_amount / risk if risk > 0 else 0.0

                if qty > 0:
                    position = OpenPosition(
                        entry_price=entry_price,
                        entry_date=dates[i],
                        entry_idx=i,
                        sl=sl_price,
                        tp=tp_price,
                        qty=qty,
                        trail_stop=sl_price if trail_enabled else 0.0,
                        peak_price=entry_price,
                    )

        if cooldown_remaining > 0:
            cooldown_remaining -= 1

        # Mark-to-market
        unrealised = 0.0
        if position is not None:
            unrealised = (closes[i] - position.entry_price) * position.qty
        equity_curve.append(equity + unrealised)

    # Close remaining position
    if position is not None:
        t = _close_trade(position, closes[-1], dates[-1], n - 1, "EOD")
        equity += t.pnl
        trades.append(t)
    if equity_curve:
        equity_curve[-1] = equity

    return _compute_metrics(trades, equity_curve, capital)


def _compute_metrics(trades: list[Trade], equity_curve: list[float],
                     capital: float) -> BacktestResult:
    """Build BacktestResult with all performance metrics."""
    result = BacktestResult()
    result.trades = trades
    result.initial_capital = capital
    result.equity_curve = equity_curve

    if not equity_curve:
        return result

    result.final_equity = round(equity_curve[-1], 2)
    result.total_return_pct = round(
        (equity_curve[-1] - capital) / capital * 100.0, 2
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

    # Sharpe ratio (daily returns, annualised)
    if len(equity_curve) > 2:
        rets = np.diff(equity_curve) / np.maximum(np.array(equity_curve[:-1]), 1.0)
        if np.std(rets) > 0:
            result.sharpe_ratio = round(
                float(np.mean(rets) / np.std(rets) * np.sqrt(252)), 2
            )

    return result
