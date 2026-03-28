"""
backtest.py — Bar-by-bar backtesting engine for the KLSE multi-timeframe strategy.

No lookahead bias: signals at bar[i] → entry at bar[i+1] open.
"""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
import pandas as pd

from .strategy import StrategyParams, compute_indicators, generate_signals


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
class BacktestResult:
    trades: list[Trade] = field(default_factory=list)
    initial_capital: float = 100_000.0
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


def run_backtest(df: pd.DataFrame, params: StrategyParams,
                 capital: float = 100_000.0,
                 risk_per_trade_pct: float = 2.0) -> BacktestResult:
    """
    Execute a bar-by-bar backtest.

    Parameters
    ----------
    df      : Daily OHLCV DataFrame (must have date, open, high, low, close, volume).
    params  : Strategy parameters.
    capital : Starting equity (MYR).
    risk_per_trade_pct : % of equity risked per trade.
    """
    df = df.copy()
    df = compute_indicators(df, params)
    signals = generate_signals(df, params)

    n = len(df)
    dates = df["date"].astype(str).values
    opens = df["open"].values
    highs = df["high"].values
    lows = df["low"].values
    closes = df["close"].values
    atr_vals = df["atr"].values
    swing_lo = df["swing_low"].values
    resist = df["resist"].values

    equity = capital
    peak_equity = capital
    equity_curve = [capital]
    trades: list[Trade] = []

    # Position state
    in_pos = False
    entry_price = 0.0
    entry_date = ""
    entry_idx = 0
    sl = 0.0
    tp = 0.0
    qty = 0.0
    highest_since_entry = 0.0
    trailing_active = False

    for i in range(1, n):
        if in_pos:
            # ─── Check exits ────────────────────────────────────
            bar_low = lows[i]
            bar_high = highs[i]
            bar_close = closes[i]
            exit_price = 0.0
            exit_reason = ""

            # Stop loss hit
            if bar_low <= sl:
                exit_price = sl
                exit_reason = "SL"
            # Take profit hit
            elif bar_high >= tp:
                exit_price = tp
                exit_reason = "TP"
            else:
                # Update trailing stop
                if params.use_trailing:
                    if bar_high > highest_since_entry:
                        highest_since_entry = bar_high
                    # Activate trailing after 1R profit
                    one_r = entry_price - sl
                    if one_r > 0 and (bar_high - entry_price) >= one_r:
                        trailing_active = True
                    if trailing_active:
                        trail_sl = highest_since_entry - params.trail_atr_mult * atr_vals[i]
                        if trail_sl > sl:
                            sl = trail_sl
                        if bar_close <= sl:
                            exit_price = sl
                            exit_reason = "TRAIL"

            if exit_price > 0:
                pnl = (exit_price - entry_price) * qty
                ret_pct = (exit_price - entry_price) / entry_price * 100.0
                risk = entry_price - sl if sl < entry_price else atr_vals[entry_idx] * params.atr_sl_mult
                rr = (exit_price - entry_price) / risk if risk > 0 else 0.0
                bars_held = i - entry_idx

                equity += pnl
                trades.append(Trade(
                    entry_date=entry_date,
                    exit_date=dates[i],
                    entry_price=round(entry_price, 4),
                    exit_price=round(exit_price, 4),
                    sl_price=round(sl, 4),
                    tp_price=round(tp, 4),
                    pnl=round(pnl, 2),
                    return_pct=round(ret_pct, 2),
                    rr=round(rr, 2),
                    bars_held=bars_held,
                    exit_reason=exit_reason,
                    win=pnl > 0,
                ))
                in_pos = False
                trailing_active = False

        else:
            # ─── Check entry ────────────────────────────────────
            if i > 0 and signals[i - 1] == 1:
                entry_price = opens[i]
                if entry_price <= 0:
                    continue
                entry_date = dates[i]
                entry_idx = i

                # Stop loss: max(swing low, entry - atr_sl * ATR)
                sw_lo = swing_lo[i] if not np.isnan(swing_lo[i]) else 0.0
                atr_sl = entry_price - params.atr_sl_mult * atr_vals[i]
                sl = max(sw_lo, atr_sl)
                # Ensure SL is below entry
                if sl >= entry_price:
                    sl = entry_price * 0.95

                risk = entry_price - sl

                # Take profit: min(entry + atr_tp * ATR, next pivot resistance)
                atr_tp = entry_price + params.atr_tp_mult * atr_vals[i]
                piv_r = resist[i] if not np.isnan(resist[i]) else atr_tp
                tp = min(atr_tp, piv_r) if piv_r > entry_price else atr_tp

                # Ensure minimum RR
                reward = tp - entry_price
                if risk > 0 and reward / risk < params.min_rr:
                    tp = entry_price + params.min_rr * risk

                # Position sizing (% risk)
                risk_amount = equity * (risk_per_trade_pct / 100.0)
                qty = risk_amount / risk if risk > 0 else 0.0
                if qty <= 0:
                    continue

                in_pos = True
                highest_since_entry = highs[i]

        # Track equity curve (mark-to-market)
        if in_pos:
            unrealised = (closes[i] - entry_price) * qty
            equity_curve.append(equity + unrealised)
        else:
            equity_curve.append(equity)

        # Drawdown tracking
        if equity_curve[-1] > peak_equity:
            peak_equity = equity_curve[-1]

    # Close unclosed position
    if in_pos:
        exit_price = closes[-1]
        pnl = (exit_price - entry_price) * qty
        ret_pct = (exit_price - entry_price) / entry_price * 100.0
        risk = entry_price - sl if sl < entry_price else 1.0
        rr = (exit_price - entry_price) / risk if risk > 0 else 0.0
        equity += pnl
        trades.append(Trade(
            entry_date=entry_date,
            exit_date=dates[-1],
            entry_price=round(entry_price, 4),
            exit_price=round(exit_price, 4),
            sl_price=round(sl, 4),
            tp_price=round(tp, 4),
            pnl=round(pnl, 2),
            return_pct=round(ret_pct, 2),
            rr=round(rr, 2),
            bars_held=n - 1 - entry_idx,
            exit_reason="EOD",
            win=pnl > 0,
        ))
        equity_curve[-1] = equity

    # ─── Compute metrics ────────────────────────────────────────
    result = BacktestResult()
    result.trades = trades
    result.initial_capital = capital
    result.final_equity = round(equity, 2)
    result.total_return_pct = round((equity - capital) / capital * 100.0, 2)
    result.total_trades = len(trades)
    result.equity_curve = equity_curve

    if trades:
        wins = [t for t in trades if t.win]
        losses = [t for t in trades if not t.win]
        result.winners = len(wins)
        result.losers = len(losses)
        result.win_rate = round(len(wins) / len(trades) * 100.0, 2)

        if wins:
            result.avg_win_pct = round(np.mean([t.return_pct for t in wins]), 2)
        if losses:
            result.avg_loss_pct = round(np.mean([t.return_pct for t in losses]), 2)

        sum_wins = sum(t.pnl for t in wins)
        sum_losses = abs(sum(t.pnl for t in losses))
        result.profit_factor = round(sum_wins / sum_losses, 2) if sum_losses > 0 else 999.0
        result.risk_reward = round(
            abs(result.avg_win_pct / result.avg_loss_pct), 2
        ) if result.avg_loss_pct != 0 else 0.0

    # Max drawdown
    eq = np.array(equity_curve)
    peak = np.maximum.accumulate(eq)
    dd = (peak - eq) / np.where(peak > 0, peak, 1.0)
    result.max_drawdown_pct = round(float(np.max(dd)) * 100.0, 2)

    # Sharpe ratio (daily returns → annualised)
    if len(equity_curve) > 2:
        rets = np.diff(equity_curve) / np.array(equity_curve[:-1])
        if np.std(rets) > 0:
            result.sharpe_ratio = round(
                float(np.mean(rets) / np.std(rets) * np.sqrt(252)), 2
            )

    return result
