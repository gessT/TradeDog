"""
backtest.py — Bar-by-bar backtesting engine for HalfTrend + Weekly Supertrend.

Core logic:
  - Signal at bar[i] → entry at bar[i+1] open (no lookahead)
  - Max 2 positions per trend cycle
  - Exit ALL positions when HalfTrend sells (miniSellSignal)
  - Hard SL = entry - ATR * sl_mult
  - TP = entry + ATR * tp_mult
  - Optional trailing stop
  - 1% risk per trade position sizing
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
class OpenPosition:
    """Track a single open position."""
    entry_price: float
    entry_date: str
    entry_idx: int
    sl: float
    tp: float
    qty: float
    trail_stop: float = 0.0


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


def _close_position(pos: OpenPosition, exit_price: float, exit_date: str,
                     bar_idx: int, reason: str) -> Trade:
    """Close a single position and return a Trade record."""
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


def run_backtest(df: pd.DataFrame, params: StrategyParams,
                 capital: float = 100_000.0) -> BacktestResult:
    """
    Bar-by-bar backtest: HalfTrend + Weekly Supertrend.

    Position management:
      - Max 2 positions per trend cycle
      - Each position sized by risk_pct of equity
      - All positions closed on HalfTrend sell signal

    Exit priority per bar:
      1. HalfTrend sell → close ALL at bar close
      2. TP hit → close that position at TP price
      3. SL hit → close that position at SL price
      4. Optional trailing stop update
    """
    df = df.copy()
    df = compute_indicators(df, params)
    entry_signals, exit_signals = generate_signals(df, params)

    n = len(df)
    dates = df["date"].astype(str).values
    opens = df["open"].values
    highs = df["high"].values
    lows = df["low"].values
    closes = df["close"].values
    atr_vals = df["atr"].values
    swing_lo = df["swing_low"].values

    equity = capital
    peak_equity = capital
    equity_curve = [capital]
    trades: list[Trade] = []
    positions: list[OpenPosition] = []  # up to max_entries open at once

    for i in range(1, n):
        closed_indices = []

        # ─── EXIT CHECK: HalfTrend sell → close ALL ────────────────
        if exit_signals[i]:
            for idx, pos in enumerate(positions):
                t = _close_position(pos, closes[i], dates[i], i, "HT_SELL")
                equity += t.pnl
                trades.append(t)
                closed_indices.append(idx)
            positions.clear()
        else:
            # ─── Per-position SL/TP checks ─────────────────────────
            for idx, pos in enumerate(positions):
                if idx in closed_indices:
                    continue

                # TP: high touches TP → exit at TP price
                if highs[i] >= pos.tp:
                    t = _close_position(pos, pos.tp, dates[i], i, "TP")
                    equity += t.pnl
                    trades.append(t)
                    closed_indices.append(idx)
                    continue

                # SL: low touches SL → exit at SL price
                effective_sl = pos.trail_stop if params.use_trailing and pos.trail_stop > pos.sl else pos.sl
                if lows[i] <= effective_sl:
                    t = _close_position(pos, effective_sl, dates[i], i, "SL")
                    equity += t.pnl
                    trades.append(t)
                    closed_indices.append(idx)
                    continue

                # Trailing stop update
                if params.use_trailing:
                    new_trail = closes[i] - params.trail_atr_mult * atr_vals[i]
                    if new_trail > pos.trail_stop:
                        pos.trail_stop = new_trail

            # Remove closed positions (in reverse to keep indices valid)
            for idx in sorted(closed_indices, reverse=True):
                positions.pop(idx)

        # ─── ENTRY CHECK ───────────────────────────────────────────
        # Signal at bar[i-1] → enter at bar[i] open
        if i > 0 and entry_signals[i - 1] and len(positions) < params.max_entries:
            entry_price = opens[i]
            if entry_price <= 0:
                pass  # skip invalid price
            else:
                a = atr_vals[i]
                sl = entry_price - params.sl_atr_mult * a
                tp = entry_price + params.tp_atr_mult * a

                # Alternative SL: use swing low if higher than ATR SL
                sw = swing_lo[i] if not np.isnan(swing_lo[i]) else 0.0
                if sw > 0 and sw < entry_price:
                    sl = max(sl, sw)

                # Safety: SL must be below entry
                if sl >= entry_price:
                    sl = entry_price * 0.97

                risk = entry_price - sl
                risk_amount = equity * (params.risk_pct / 100.0)
                qty = risk_amount / risk if risk > 0 else 0.0

                if qty > 0:
                    pos = OpenPosition(
                        entry_price=entry_price,
                        entry_date=dates[i],
                        entry_idx=i,
                        sl=sl,
                        tp=tp,
                        qty=qty,
                        trail_stop=sl if params.use_trailing else 0.0,
                    )
                    positions.append(pos)

        # ─── Mark-to-market equity ─────────────────────────────────
        unrealised = sum((closes[i] - pos.entry_price) * pos.qty for pos in positions)
        equity_curve.append(equity + unrealised)

        if equity_curve[-1] > peak_equity:
            peak_equity = equity_curve[-1]

    # ─── Close unclosed positions at last bar ──────────────────────
    for pos in positions:
        t = _close_position(pos, closes[-1], dates[-1], n - 1, "EOD")
        equity += t.pnl
        trades.append(t)
    positions.clear()
    if equity_curve:
        equity_curve[-1] = equity

    # ─── Compute metrics ───────────────────────────────────────────
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
        rets = np.diff(equity_curve) / np.maximum(np.array(equity_curve[:-1]), 1.0)
        if np.std(rets) > 0:
            result.sharpe_ratio = round(
                float(np.mean(rets) / np.std(rets) * np.sqrt(252)), 2
            )

    return result
