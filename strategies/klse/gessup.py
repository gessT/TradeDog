"""
gessup.py - KLSE Stock Up [Gess] strategy backend.

Concept parity with pine_scripts/gessup.pine:
- Weekly SuperTrend defines macro bullish regime.
- HalfTrend flip up is entry timing trigger.
- Exit on HalfTrend flip down or Weekly SuperTrend flip down.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
import pandas as pd

from app.utils.indicators import weekly_supertrend


DEFAULT_PARAMS: dict = {
    "amplitude": 5,
    "channel_deviation": 2,
    "atr_period": 10,
    "factor": 3.0,
    "max_buys_per_weekly_cycle": 2,
}

VALID_CONDITIONS = {
    "weekly_supertrend",
    "halftrend_entry",
    "halftrend_exit",
    "weekly_flip_exit",
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


def _halftrend(
    highs: np.ndarray,
    lows: np.ndarray,
    closes: np.ndarray,
    amplitude: int,
) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    n = len(closes)
    trend = np.zeros(n, dtype=int)  # 0 bullish, 1 bearish
    next_trend = np.zeros(n, dtype=int)

    max_low = np.full(n, np.nan)
    min_high = np.full(n, np.nan)
    up = np.full(n, np.nan)
    down = np.full(n, np.nan)

    if n == 0:
        return trend, np.full(0, np.nan), np.zeros(0, dtype=bool), np.zeros(0, dtype=bool)

    max_low[0] = lows[0]
    min_high[0] = highs[0]
    up[0] = lows[0]
    down[0] = highs[0]

    high_price = pd.Series(highs).rolling(window=amplitude, min_periods=amplitude).max().to_numpy()
    low_price = pd.Series(lows).rolling(window=amplitude, min_periods=amplitude).min().to_numpy()
    high_ma = pd.Series(highs).rolling(window=amplitude, min_periods=amplitude).mean().to_numpy()
    low_ma = pd.Series(lows).rolling(window=amplitude, min_periods=amplitude).mean().to_numpy()

    for i in range(1, n):
        trend[i] = trend[i - 1]
        next_trend[i] = next_trend[i - 1]
        max_low[i] = max_low[i - 1]
        min_high[i] = min_high[i - 1]

        hp = float(high_price[i]) if np.isfinite(high_price[i]) else float(highs[i])
        lp = float(low_price[i]) if np.isfinite(low_price[i]) else float(lows[i])
        hma = float(high_ma[i]) if np.isfinite(high_ma[i]) else float(highs[i])
        lma = float(low_ma[i]) if np.isfinite(low_ma[i]) else float(lows[i])

        if next_trend[i] == 1:
            base = max_low[i] if np.isfinite(max_low[i]) else lp
            max_low[i] = max(lp, base)
            if hma < max_low[i] and closes[i] < lows[i - 1]:
                trend[i] = 1
                next_trend[i] = 0
                min_high[i] = hp
        else:
            base = min_high[i] if np.isfinite(min_high[i]) else hp
            min_high[i] = min(hp, base)
            if lma > min_high[i] and closes[i] > highs[i - 1]:
                trend[i] = 0
                next_trend[i] = 1
                max_low[i] = lp

        prev_up = up[i - 1]
        prev_down = down[i - 1]

        if trend[i] == 0:
            if trend[i - 1] != 0:
                up[i] = prev_down if np.isfinite(prev_down) else lp
            else:
                candidate = max_low[i] if np.isfinite(max_low[i]) else lp
                up[i] = max(candidate, prev_up) if np.isfinite(prev_up) else candidate
            down[i] = prev_down
        else:
            if trend[i - 1] != 1:
                down[i] = prev_up if np.isfinite(prev_up) else hp
            else:
                candidate = min_high[i] if np.isfinite(min_high[i]) else hp
                down[i] = min(candidate, prev_down) if np.isfinite(prev_down) else candidate
            up[i] = prev_up

    ht_line = np.where(trend == 0, up, down)
    prev_trend = np.roll(trend, 1)
    prev_trend[0] = trend[0]
    mini_buy = (trend == 0) & (prev_trend == 1)
    mini_sell = (trend == 1) & (prev_trend == 0)

    return trend, ht_line, mini_buy, mini_sell


def build_indicators(
    df: pd.DataFrame,
    params: dict | None = None,
    disabled_conditions: set[str] | None = None,
) -> pd.DataFrame:
    p = {**DEFAULT_PARAMS, **(params or {})}
    off = disabled_conditions or set()

    out = df.copy()
    highs = out["high"].to_numpy(dtype=float)
    lows = out["low"].to_numpy(dtype=float)
    closes = out["close"].to_numpy(dtype=float)
    opens = out["open"].to_numpy(dtype=float)

    amplitude = int(p["amplitude"])
    atr_period = int(p["atr_period"])
    factor = float(p["factor"])

    ht_trend, ht_line, mini_buy, mini_sell = _halftrend(highs, lows, closes, amplitude)

    if isinstance(out.index, pd.DatetimeIndex):
        dates = out.index.to_list()
    elif "date" in out.columns:
        dates = pd.to_datetime(out["date"]).to_list()
    else:
        dates = list(range(len(out)))

    weekly_dir_raw = np.array(
        weekly_supertrend(
            dates=dates,
            opens=opens.tolist(),
            highs=highs.tolist(),
            lows=lows.tolist(),
            closes=closes.tolist(),
            period=atr_period,
            multiplier=factor,
        ),
        dtype=int,
    )

    # weekly_supertrend returns -1 bullish, 1 bearish; UI convention uses 1 bullish.
    st_dir = np.where(weekly_dir_raw < 0, 1, -1)
    ht_dir = np.where(ht_trend == 0, 1, -1)

    signal_ok = np.ones(len(out), dtype=bool)
    if "weekly_supertrend" not in off:
        signal_ok &= st_dir == 1
    if "halftrend_entry" not in off:
        signal_ok &= mini_buy

    out["ht_line"] = ht_line
    out["ht_dir"] = ht_dir
    out["st_dir"] = st_dir
    out["weekly_dir_raw"] = weekly_dir_raw
    out["mini_buy"] = mini_buy.astype(int)
    out["mini_sell"] = mini_sell.astype(int)
    out["signal"] = signal_ok.astype(int)

    return out


def _max_drawdown_pct(equity_curve: list[float]) -> float:
    if not equity_curve:
        return 0.0
    peak = equity_curve[0]
    max_dd = 0.0
    for v in equity_curve:
        if v > peak:
            peak = v
        if peak > 0:
            dd = (peak - v) / peak * 100.0
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

    amplitude = int(p["amplitude"])
    max_buys = int(p["max_buys_per_weekly_cycle"])

    min_rows = max(amplitude + 5, 30)
    if len(df) < min_rows:
        raise ValueError(f"Not enough bars for GessUp strategy (need {min_rows}+).")

    frame = build_indicators(df, p, off)

    opens = frame["open"].to_numpy(dtype=float)
    closes = frame["close"].to_numpy(dtype=float)
    signals = frame["signal"].to_numpy(dtype=int)
    mini_sell = frame["mini_sell"].to_numpy(dtype=int)
    weekly_raw = frame["weekly_dir_raw"].to_numpy(dtype=int)

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
    buy_count = 0

    n = len(frame)
    for i in range(1, n - 1):
        weekly_flip_down = bool(weekly_raw[i - 1] < 0 and weekly_raw[i] > 0)
        if weekly_flip_down:
            buy_count = 0

        exit_sig = False
        if in_position:
            by_halftrend = mini_sell[i] == 1 and "halftrend_exit" not in off
            by_weekly_flip = weekly_flip_down and "weekly_flip_exit" not in off
            exit_sig = by_halftrend or by_weekly_flip

        if exit_sig and in_position:
            exit_price = float(opens[i + 1])
            pnl = (exit_price - entry_price) * qty
            ret_pct = (exit_price - entry_price) / entry_price * 100.0 if entry_price > 0 else 0.0
            exit_reason = "WEEKLY_FLIP_DOWN" if (weekly_flip_down and "weekly_flip_exit" not in off) else "HALFTREND_DOWN"
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
                    exit_reason=exit_reason,
                    win=pnl > 0,
                )
            )
            equity = qty * exit_price
            in_position = False
            qty = 0.0

        if not in_position and signals[i] == 1 and buy_count < max_buys:
            next_open = float(opens[i + 1])
            if next_open > 0:
                entry_price = next_open
                entry_date = dates[i + 1]
                entry_idx = i + 1
                qty = equity / entry_price
                in_position = True
                buy_count += 1

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
