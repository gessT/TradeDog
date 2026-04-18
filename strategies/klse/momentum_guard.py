"""
momentum_guard.py - KLSE Momentum Guard strategy.

Rules:
- Entry: EMA fast crosses above EMA slow and RSI is inside a configurable window.
- Exit: fixed stop loss, trailing stop from peak, or EMA cross down trend exit.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
import pandas as pd


DEFAULT_PARAMS: dict = {
    "ema_fast": 20,
    "ema_slow": 50,
    "rsi_period": 14,
    "rsi_min": 40.0,
    "rsi_max": 65.0,
    "stop_loss_pct": 0.05,
    "trailing_stop_pct": 0.10,
}

VALID_CONDITIONS = {
    "ema_cross_up",
    "rsi_window",
    "sl_exit",
    "tp_exit",
    "trend_exit",
}


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
    bars_held: int
    exit_reason: str
    win: bool


@dataclass
class BacktestResult:
    trades: list[Trade] = field(default_factory=list)
    initial_capital: float = 10000.0
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


def _compute_rsi(close: pd.Series, period: int) -> pd.Series:
    delta = close.diff()
    gain = delta.clip(lower=0.0)
    loss = -delta.clip(upper=0.0)

    avg_gain = gain.ewm(alpha=1.0 / period, adjust=False, min_periods=period).mean()
    avg_loss = loss.ewm(alpha=1.0 / period, adjust=False, min_periods=period).mean()

    rs = avg_gain / avg_loss.replace(0.0, np.nan)
    rsi = 100.0 - (100.0 / (1.0 + rs))
    return rsi.fillna(50.0)


def build_indicators(
    df: pd.DataFrame,
    params: dict | None = None,
    disabled_conditions: set[str] | None = None,
) -> pd.DataFrame:
    p = {**DEFAULT_PARAMS, **(params or {})}
    off = disabled_conditions or set()

    out = df.copy()
    out["ema_fast"] = out["close"].ewm(span=int(p["ema_fast"]), adjust=False).mean()
    out["ema_slow"] = out["close"].ewm(span=int(p["ema_slow"]), adjust=False).mean()
    out["rsi"] = _compute_rsi(out["close"], int(p["rsi_period"]))

    cross_up = (out["ema_fast"] > out["ema_slow"]) & (out["ema_fast"].shift(1) <= out["ema_slow"].shift(1))
    rsi_ok = out["rsi"].between(float(p["rsi_min"]), float(p["rsi_max"]), inclusive="both")

    signal_ok = pd.Series(True, index=out.index, dtype=bool)
    if "ema_cross_up" not in off:
        signal_ok &= cross_up.fillna(False)
    if "rsi_window" not in off:
        signal_ok &= rsi_ok.fillna(False)

    out["signal"] = signal_ok.astype(int)
    return out


def _max_drawdown_pct(equity_curve: list[float]) -> float:
    if not equity_curve:
        return 0.0

    peak = equity_curve[0]
    max_dd = 0.0
    for value in equity_curve:
        if value > peak:
            peak = value
        if peak > 0:
            dd = (peak - value) / peak * 100.0
            if dd > max_dd:
                max_dd = dd
    return max_dd


def _sharpe_ratio(equity_curve: list[float]) -> float:
    if len(equity_curve) < 3:
        return 0.0

    arr = np.array(equity_curve, dtype=float)
    ret = np.diff(arr) / arr[:-1]
    ret = ret[np.isfinite(ret)]
    if len(ret) < 2:
        return 0.0

    std = float(np.std(ret))
    if std <= 0:
        return 0.0
    return float(np.mean(ret) / std * np.sqrt(252.0))


def run_backtest(
    df: pd.DataFrame,
    params: dict | None = None,
    capital: float = 10000.0,
    disabled_conditions: set[str] | None = None,
) -> BacktestResult:
    p = {**DEFAULT_PARAMS, **(params or {})}
    off = disabled_conditions or set()

    if p["ema_fast"] >= p["ema_slow"]:
        raise ValueError("ema_fast must be smaller than ema_slow.")
    if p["rsi_min"] >= p["rsi_max"]:
        raise ValueError("rsi_min must be smaller than rsi_max.")

    min_rows = max(int(p["ema_slow"]) + 10, int(p["rsi_period"]) + 10)
    if len(df) < min_rows:
        raise ValueError(f"Not enough bars for Momentum Guard (need {min_rows}+).")

    frame = build_indicators(df=df, params=p, disabled_conditions=off)

    opens = frame["open"].to_numpy(dtype=float)
    highs = frame["high"].to_numpy(dtype=float)
    lows = frame["low"].to_numpy(dtype=float)
    closes = frame["close"].to_numpy(dtype=float)
    ema_fast = frame["ema_fast"].to_numpy(dtype=float)
    ema_slow = frame["ema_slow"].to_numpy(dtype=float)
    signals = frame["signal"].to_numpy(dtype=int)

    if isinstance(frame.index, pd.DatetimeIndex):
        dates = frame.index.strftime("%Y-%m-%d").to_numpy()
    elif "date" in frame.columns:
        dates = pd.to_datetime(frame["date"]).dt.strftime("%Y-%m-%d").to_numpy()
    else:
        dates = np.arange(len(frame)).astype(str)

    equity = float(capital)
    equity_curve: list[float] = [equity]
    trades: list[Trade] = []

    in_position = False
    entry_price = 0.0
    entry_date = ""
    entry_idx = -1
    qty = 0.0
    peak_price = 0.0
    initial_sl = 0.0
    initial_tp = 0.0

    def close_position(exit_price: float, exit_date: str, exit_idx: int, reason: str) -> None:
        nonlocal in_position, equity, qty

        pnl = (exit_price - entry_price) * qty
        ret_pct = (exit_price - entry_price) / entry_price * 100.0 if entry_price > 0 else 0.0
        trades.append(
            Trade(
                entry_date=entry_date,
                exit_date=exit_date,
                entry_price=round(entry_price, 4),
                exit_price=round(exit_price, 4),
                sl_price=round(initial_sl, 4),
                tp_price=round(initial_tp, 4),
                pnl=round(pnl, 2),
                return_pct=round(ret_pct, 2),
                bars_held=exit_idx - entry_idx,
                exit_reason=reason,
                win=pnl > 0,
            )
        )
        equity = qty * exit_price
        in_position = False
        qty = 0.0

    n = len(frame)
    for i in range(1, n - 1):
        cross_down = bool(ema_fast[i - 1] >= ema_slow[i - 1] and ema_fast[i] < ema_slow[i])

        if in_position:
            if highs[i] > peak_price:
                peak_price = float(highs[i])

            stop_price = entry_price * (1.0 - float(p["stop_loss_pct"]))
            trail_price = peak_price * (1.0 - float(p["trailing_stop_pct"]))

            effective_stop: float | None = None
            if "sl_exit" not in off and "tp_exit" not in off:
                effective_stop = max(stop_price, trail_price)
            elif "sl_exit" not in off:
                effective_stop = stop_price
            elif "tp_exit" not in off:
                effective_stop = trail_price

            if effective_stop is not None and lows[i] <= effective_stop:
                reason = "TRAIL" if ("tp_exit" not in off and trail_price >= stop_price) else "SL"
                close_position(float(effective_stop), dates[i], i, reason)
            elif "trend_exit" not in off and cross_down:
                close_position(float(opens[i + 1]), dates[i + 1], i + 1, "TREND_EXIT")

        if not in_position and signals[i] == 1:
            next_open = float(opens[i + 1])
            if next_open > 0:
                entry_price = next_open
                entry_date = dates[i + 1]
                entry_idx = i + 1
                qty = equity / entry_price
                peak_price = entry_price
                initial_sl = entry_price * (1.0 - float(p["stop_loss_pct"]))
                # Strategy uses trailing stop as the profit lock mechanism; this target is for UI/scanner display.
                initial_tp = entry_price * (1.0 + float(p["trailing_stop_pct"]))
                in_position = True

        mark_equity = qty * closes[i] if in_position else equity
        equity_curve.append(float(mark_equity))

    if in_position:
        close_position(float(closes[-1]), dates[-1], n - 1, "EOD")

    winners = [t for t in trades if t.win]
    losers = [t for t in trades if not t.win]

    gross_profit = sum(t.pnl for t in winners)
    gross_loss = abs(sum(t.pnl for t in losers))

    avg_win_pct = float(np.mean([t.return_pct for t in winners])) if winners else 0.0
    avg_loss_pct = float(np.mean([t.return_pct for t in losers])) if losers else 0.0

    total_trades = len(trades)
    total_return_pct = ((equity / capital) - 1.0) * 100.0 if capital else 0.0

    return BacktestResult(
        trades=trades,
        initial_capital=round(capital, 2),
        final_equity=round(equity, 2),
        total_return_pct=round(total_return_pct, 2),
        total_trades=total_trades,
        winners=len(winners),
        losers=len(losers),
        win_rate=round((len(winners) / total_trades) * 100.0, 1) if total_trades else 0.0,
        avg_win_pct=round(avg_win_pct, 2),
        avg_loss_pct=round(avg_loss_pct, 2),
        profit_factor=round(gross_profit / gross_loss, 2) if gross_loss > 0 else 999.0,
        risk_reward=round(abs(avg_win_pct / avg_loss_pct), 2) if avg_loss_pct != 0 else 999.0,
        max_drawdown_pct=round(_max_drawdown_pct(equity_curve), 2),
        sharpe_ratio=round(_sharpe_ratio(equity_curve), 2),
        equity_curve=equity_curve,
    )
