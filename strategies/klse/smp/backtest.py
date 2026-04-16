"""
backtest.py — Bar-by-bar backtester for SMP (Smart Money Pivot) Strategy.

Entry: signal at bar[i] → enter at bar[i+1] open
Exit:  SL (swing low / OB bottom) / TP (R-multiple) / Trailing stop
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
    """Run SMP backtest on daily data."""
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

        equity_curve.append(equity)

    # Close any open position at last bar
    if position is not None:
        t = _close_trade(position, closes[-1], dates[-1], n - 1, "EOD")
        equity += t.pnl
        trades.append(t)

    # ── Compute metrics ──
    winners = [t for t in trades if t.win]
    losers = [t for t in trades if not t.win]
    n_trades = len(trades)

    total_pnl = sum(t.pnl for t in trades)
    avg_win_pct = np.mean([t.return_pct for t in winners]) if winners else 0.0
    avg_loss_pct = np.mean([t.return_pct for t in losers]) if losers else 0.0

    gross_profit = sum(t.pnl for t in winners)
    gross_loss = abs(sum(t.pnl for t in losers))
    pf = round(gross_profit / gross_loss, 2) if gross_loss > 0 else 999.0

    # Max drawdown
    peak_equity = capital
    max_dd = 0.0
    for eq in equity_curve:
        if eq > peak_equity:
            peak_equity = eq
        dd = (peak_equity - eq) / peak_equity * 100.0 if peak_equity > 0 else 0.0
        if dd > max_dd:
            max_dd = dd

    # Sharpe ratio (annualised, daily returns)
    if len(equity_curve) > 2:
        eq_arr = np.array(equity_curve)
        daily_ret = np.diff(eq_arr) / eq_arr[:-1]
        daily_ret = daily_ret[~np.isnan(daily_ret)]
        if len(daily_ret) > 1 and np.std(daily_ret) > 0:
            sharpe = float(np.mean(daily_ret) / np.std(daily_ret) * np.sqrt(252))
        else:
            sharpe = 0.0
    else:
        sharpe = 0.0

    rr_ratio = round(abs(avg_win_pct / avg_loss_pct), 2) if avg_loss_pct != 0 else 999.0

    return BacktestResult(
        trades=trades,
        initial_capital=capital,
        final_equity=round(equity, 2),
        total_return_pct=round(total_pnl / capital * 100, 2) if capital else 0,
        total_trades=n_trades,
        winners=len(winners),
        losers=len(losers),
        win_rate=round(len(winners) / n_trades * 100, 1) if n_trades else 0,
        avg_win_pct=round(avg_win_pct, 2),
        avg_loss_pct=round(avg_loss_pct, 2),
        profit_factor=pf,
        risk_reward=rr_ratio,
        max_drawdown_pct=round(max_dd, 2),
        sharpe_ratio=round(sharpe, 2),
        equity_curve=equity_curve,
    )
