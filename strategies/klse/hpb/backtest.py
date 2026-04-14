"""
backtest.py — Bar-by-bar backtesting engine for HeatPulse Breakout Strategy.

Core logic:
  - Signal at bar[i] → entry at bar[i+1] open (no lookahead)
  - Only 1 open trade at a time
  - SL = Entry - ATR × sl_atr_mult
  - TP = Entry + ATR × tp_atr_mult
  - Optional trailing stop (ATR × trailing_atr_mult)
  - Cooldown period after exit
  - Position sizing: risk_pct of equity per trade
"""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
import pandas as pd

from .config import HPBParams
from .signals import build_indicators, generate_entry_signals


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
    heat_score: float = 0.0


@dataclass
class OpenPosition:
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
                     bar_idx: int, reason: str, heat: float = 0.0) -> Trade:
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
        heat_score=round(heat, 1),
    )


def run_backtest(df: pd.DataFrame, params: HPBParams | None = None,
                 capital: float = 100_000.0,
                 disabled_conditions: set[str] | None = None) -> BacktestResult:
    """
    Full HPB backtest.

    Disabled conditions (optional toggles from UI):
      Entry: "heat_filter", "ema_filter", "breakout_filter", "volume_filter", "atr_filter"
      Exit:  "sl_exit", "tp_exit", "trail_exit"
    """
    if params is None:
        params = HPBParams()
    disabled = disabled_conditions or set()

    df = df.copy()
    df = build_indicators(df, params)

    # Generate raw entry signals
    raw_signals = generate_entry_signals(df, params)

    # Apply disabled overrides — if a condition is disabled, relax it
    # (re-evaluate with relaxed checks)
    if disabled:
        n = len(df)
        c = df["close"].values
        ema50 = df["ema50"].values
        ema200 = df["ema200"].values
        heat = df["heat_score"].values
        hh = df["highest_high"].values
        vol_arr = df["volume"].values.astype(float)
        avg_v = df["avg_vol"].values
        atr_vals = df["atr"].values
        atr_mean = df["atr_mean"].values

        signals = np.zeros(n, dtype=bool)
        for i in range(n):
            if np.isnan(ema50[i]) or np.isnan(ema200[i]):
                continue
            if np.isnan(heat[i]):
                continue

            ok = True
            if "heat_filter" not in disabled and heat[i] <= params.heat_threshold:
                ok = False
            if "ema_filter" not in disabled and (c[i] <= ema50[i] or c[i] <= ema200[i]):
                ok = False
            if "breakout_filter" not in disabled and not np.isnan(hh[i]) and c[i] <= hh[i]:
                ok = False
            if "volume_filter" not in disabled:
                if not np.isnan(avg_v[i]) and avg_v[i] > 0 and vol_arr[i] <= params.vol_mult * avg_v[i]:
                    ok = False
            if "atr_filter" not in disabled and params.skip_low_atr:
                if not np.isnan(atr_mean[i]) and atr_mean[i] > 0 and atr_vals[i] < atr_mean[i]:
                    ok = False
            signals[i] = ok
        entry_signals = signals
    else:
        entry_signals = raw_signals

    # Determine date column
    if "date" in df.columns:
        dates = df["date"].astype(str).values
    elif isinstance(df.index, pd.DatetimeIndex):
        dates = df.index.strftime("%Y-%m-%d").values
    else:
        dates = np.arange(len(df)).astype(str)

    opens = df["open"].values.astype(float)
    highs = df["high"].values.astype(float)
    lows = df["low"].values.astype(float)
    closes = df["close"].values.astype(float)
    atr_arr = df["atr"].values.astype(float)
    heat_arr = df["heat_score"].values.astype(float)

    n = len(df)
    equity = capital
    peak_equity = capital
    equity_curve = [capital]
    trades: list[Trade] = []
    position: OpenPosition | None = None
    cooldown_remaining = 0

    sl_enabled = "sl_exit" not in disabled
    tp_enabled = "tp_exit" not in disabled
    trail_enabled = params.use_trailing and "trail_exit" not in disabled

    for i in range(1, n):
        # ─── EXIT CHECK ────────────────────────────────────────
        if position is not None:
            closed = False

            # TP hit
            if tp_enabled and highs[i] >= position.tp:
                t = _close_position(position, position.tp, dates[i], i, "TP",
                                     heat_arr[i] if not np.isnan(heat_arr[i]) else 0)
                equity += t.pnl
                trades.append(t)
                position = None
                cooldown_remaining = params.cooldown_bars
                closed = True

            # SL hit
            if not closed and position is not None:
                effective_sl = position.trail_stop if trail_enabled and position.trail_stop > position.sl else position.sl
                if sl_enabled and lows[i] <= effective_sl:
                    t = _close_position(position, effective_sl, dates[i], i, "SL",
                                         heat_arr[i] if not np.isnan(heat_arr[i]) else 0)
                    equity += t.pnl
                    trades.append(t)
                    position = None
                    cooldown_remaining = params.cooldown_bars
                    closed = True

            # Trailing stop update
            if not closed and position is not None and trail_enabled:
                new_trail = closes[i] - params.trailing_atr_mult * atr_arr[i]
                if not np.isnan(new_trail) and new_trail > position.trail_stop:
                    position.trail_stop = new_trail

        # ─── ENTRY CHECK ───────────────────────────────────────
        # Signal at bar[i-1] → enter at bar[i] open
        if position is None and cooldown_remaining <= 0 and entry_signals[i - 1]:
            entry_price = opens[i]
            if entry_price > 0 and not np.isnan(atr_arr[i]):
                a = atr_arr[i]
                sl = entry_price - params.sl_atr_mult * a
                tp = entry_price + params.tp_atr_mult * a

                # Safety: SL must be below entry
                if sl >= entry_price:
                    sl = entry_price * 0.97

                risk = entry_price - sl
                risk_amount = equity * (params.risk_pct / 100.0)
                qty = risk_amount / risk if risk > 0 else 0.0

                if qty > 0:
                    position = OpenPosition(
                        entry_price=entry_price,
                        entry_date=dates[i],
                        entry_idx=i,
                        sl=sl,
                        tp=tp,
                        qty=qty,
                        trail_stop=sl if trail_enabled else 0.0,
                    )

        # Cooldown countdown
        if cooldown_remaining > 0:
            cooldown_remaining -= 1

        # ─── Mark-to-market equity ─────────────────────────────
        unrealised = 0.0
        if position is not None:
            unrealised = (closes[i] - position.entry_price) * position.qty
        equity_curve.append(equity + unrealised)

        if equity_curve[-1] > peak_equity:
            peak_equity = equity_curve[-1]

    # ─── Close unclosed position at last bar ───────────────────
    if position is not None:
        t = _close_position(position, closes[-1], dates[-1], n - 1, "EOD",
                             heat_arr[-1] if not np.isnan(heat_arr[-1]) else 0)
        equity += t.pnl
        trades.append(t)
        position = None
    if equity_curve:
        equity_curve[-1] = equity

    # ─── Build result with metrics ─────────────────────────────
    from .metrics import compute_metrics
    return compute_metrics(trades, equity_curve, capital)
