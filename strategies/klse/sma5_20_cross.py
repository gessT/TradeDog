"""
sma5_20_cross.py - KLSE SMA 5/20 crossover strategy.

Rules:
- Entry: SMA(5) crosses above SMA(20), execute at next bar open.
- Exit:  SMA(5) crosses below SMA(20), execute at next bar open.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
import pandas as pd


DEFAULT_PARAMS: dict = {
    "sma_fast": 5,
    "sma_slow": 20,
}

VALID_CONDITIONS = {
    "sma_cross_up",
    "sma_cross_down",
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


def build_indicators(
    df: pd.DataFrame,
    params: dict | None = None,
    disabled_conditions: set[str] | None = None,
) -> pd.DataFrame:
    p = {**DEFAULT_PARAMS, **(params or {})}
    off = disabled_conditions or set()
    out = df.copy()

    fast = int(p["sma_fast"])
    slow = int(p["sma_slow"])

    out["sma_fast"] = out["close"].rolling(window=fast, min_periods=fast).mean()
    out["sma_slow"] = out["close"].rolling(window=slow, min_periods=slow).mean()

    cross_up = (out["sma_fast"] > out["sma_slow"]) & (out["sma_fast"].shift(1) <= out["sma_slow"].shift(1))
    if "sma_cross_up" in off:
        out["signal"] = 0
    else:
        out["signal"] = cross_up.fillna(False).astype(int)
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
    capital: float = 5000.0,
    disabled_conditions: set[str] | None = None,
) -> BacktestResult:
    p = {**DEFAULT_PARAMS, **(params or {})}
    off = disabled_conditions or set()

    if p["sma_fast"] >= p["sma_slow"]:
        raise ValueError("sma_fast must be smaller than sma_slow.")

    min_rows = int(p["sma_slow"]) + 5
    if len(df) < min_rows:
        raise ValueError(f"Not enough bars for SMA5/20 Cross (need {min_rows}+).")

    frame = build_indicators(df=df, params=p, disabled_conditions=off)

    opens = frame["open"].to_numpy(dtype=float)
    closes = frame["close"].to_numpy(dtype=float)
    sma_fast = frame["sma_fast"].to_numpy(dtype=float)
    sma_slow = frame["sma_slow"].to_numpy(dtype=float)
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

    n = len(frame)
    for i in range(1, n - 1):
        cross_down = ("sma_cross_down" not in off) and bool(sma_fast[i - 1] >= sma_slow[i - 1] and sma_fast[i] < sma_slow[i])

        if in_position and cross_down:
            exit_price = float(opens[i + 1])
            pnl = (exit_price - entry_price) * qty
            ret_pct = (exit_price - entry_price) / entry_price * 100.0 if entry_price > 0 else 0.0
            trades.append(
                Trade(
                    entry_date=entry_date,
                    exit_date=dates[i + 1],
                    entry_price=round(entry_price, 4),
                    exit_price=round(exit_price, 4),
                    sl_price=0.0,
                    tp_price=0.0,
                    pnl=round(pnl, 2),
                    return_pct=round(ret_pct, 2),
                    bars_held=i + 1 - entry_idx,
                    exit_reason="SMA_CROSS_DOWN",
                    win=pnl > 0,
                )
            )
            equity = qty * exit_price
            in_position = False
            qty = 0.0

        if (not in_position) and signals[i] == 1:
            next_open = float(opens[i + 1])
            if next_open > 0:
                entry_price = next_open
                entry_date = dates[i + 1]
                entry_idx = i + 1
                qty = equity / entry_price
                in_position = True

        mark_equity = qty * closes[i] if in_position else equity
        equity_curve.append(float(mark_equity))

    if in_position:
        exit_price = float(closes[-1])
        pnl = (exit_price - entry_price) * qty
        ret_pct = (exit_price - entry_price) / entry_price * 100.0 if entry_price > 0 else 0.0
        trades.append(
            Trade(
                entry_date=entry_date,
                exit_date=dates[-1],
                entry_price=round(entry_price, 4),
                exit_price=round(exit_price, 4),
                sl_price=0.0,
                tp_price=0.0,
                pnl=round(pnl, 2),
                return_pct=round(ret_pct, 2),
                bars_held=n - 1 - entry_idx,
                exit_reason="EOD",
                win=pnl > 0,
            )
        )
        equity = qty * exit_price

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
