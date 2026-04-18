#!/usr/bin/env python3
"""
run_greatech_momentum_guard.py

Greatech Strategy: The Momentum Guard

Rules:
- Entry: EMA20 crosses above EMA50 and RSI(14) is between 40 and 65.
- Exit: 5% stop loss, 10% trailing stop from peak, or EMA20 crosses below EMA50.

The script compares strategy performance against buy-and-hold and prints
a concise draft summary for 2024-2026.
"""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import asdict, dataclass
from pathlib import Path

import numpy as np
import pandas as pd


ROOT = Path(__file__).resolve().parent.parent
STRATEGY_NAME = "Greatech Strategy: The Momentum Guard"


@dataclass
class Trade:
    entry_time: str
    exit_time: str
    entry_price: float
    exit_price: float
    pnl: float
    return_pct: float
    bars_held: int
    exit_reason: str


@dataclass
class BacktestResult:
    symbol: str
    name: str
    initial_capital: float
    final_equity: float
    total_return_pct: float
    total_trades: int
    winners: int
    losers: int
    win_rate: float
    avg_win_pct: float
    avg_loss_pct: float
    profit_factor: float
    max_drawdown_pct: float
    trades: list[Trade]


@dataclass
class Position:
    entry_idx: int
    entry_time: str
    entry_price: float
    qty: float
    stop_price: float
    peak_price: float


def load_json_ohlcv(path: Path) -> tuple[pd.DataFrame, str, str]:
    """Load TradeDog JSON data into DataFrame with standard OHLCV columns."""
    with path.open("r", encoding="utf-8") as f:
        raw = json.load(f)

    symbol = raw.get("symbol", "0208.KL") if isinstance(raw, dict) else "0208.KL"
    name = raw.get("name", "Greatech") if isinstance(raw, dict) else "Greatech"
    records = raw.get("data", []) if isinstance(raw, dict) else raw

    if not isinstance(records, list) or not records:
        raise ValueError("Input JSON must contain a non-empty list of OHLCV rows.")

    df = pd.DataFrame(records)
    required_cols = {"date", "open", "high", "low", "close", "volume"}
    missing = sorted(required_cols - set(df.columns))
    if missing:
        raise ValueError(f"Missing required columns: {', '.join(missing)}")

    df = df[["date", "open", "high", "low", "close", "volume"]].copy()
    df["date"] = pd.to_datetime(df["date"], errors="coerce")
    for c in ("open", "high", "low", "close", "volume"):
        df[c] = pd.to_numeric(df[c], errors="coerce")

    df = df.dropna(subset=["date", "open", "high", "low", "close"]).sort_values("date").reset_index(drop=True)
    if df.empty:
        raise ValueError("No valid rows after parsing input JSON data.")

    return df, symbol, name


def compute_rsi(close: pd.Series, period: int = 14) -> pd.Series:
    """Compute Wilder-style RSI."""
    delta = close.diff()
    gains = delta.clip(lower=0.0)
    losses = -delta.clip(upper=0.0)

    avg_gain = gains.ewm(alpha=1.0 / period, adjust=False, min_periods=period).mean()
    avg_loss = losses.ewm(alpha=1.0 / period, adjust=False, min_periods=period).mean()

    rs = avg_gain / avg_loss.replace(0.0, np.nan)
    return 100.0 - (100.0 / (1.0 + rs))


def add_indicators(df: pd.DataFrame) -> pd.DataFrame:
    out = df.copy()
    out["ema20"] = out["close"].ewm(span=20, adjust=False).mean()
    out["ema50"] = out["close"].ewm(span=50, adjust=False).mean()
    out["rsi14"] = compute_rsi(out["close"], period=14)
    return out


def _build_trade(position: Position, exit_time: str, exit_price: float, exit_idx: int, reason: str) -> Trade:
    pnl = (exit_price - position.entry_price) * position.qty
    return Trade(
        entry_time=position.entry_time,
        exit_time=exit_time,
        entry_price=round(position.entry_price, 4),
        exit_price=round(exit_price, 4),
        pnl=round(pnl, 2),
        return_pct=round((exit_price / position.entry_price - 1.0) * 100.0, 2),
        bars_held=exit_idx - position.entry_idx,
        exit_reason=reason,
    )


def _try_exit_position(
    position: Position,
    i: int,
    cross_down: bool,
    highs: np.ndarray,
    lows: np.ndarray,
    opens: np.ndarray,
    dates: np.ndarray,
    trailing_stop_pct: float,
) -> tuple[Position | None, Trade | None, float | None]:
    peak_price = max(position.peak_price, float(highs[i]))
    position.peak_price = peak_price

    trailing_stop = peak_price * (1.0 - trailing_stop_pct)
    effective_stop = max(position.stop_price, trailing_stop)
    if lows[i] <= effective_stop:
        reason = "TRAIL" if trailing_stop >= position.stop_price else "STOP"
        trade = _build_trade(position, dates[i], float(effective_stop), i, reason)
        return None, trade, position.qty * float(effective_stop)

    if cross_down:
        exit_price = float(opens[i + 1])
        trade = _build_trade(position, dates[i + 1], exit_price, i + 1, "TREND_EXIT")
        return None, trade, position.qty * exit_price

    return position, None, None


def _try_enter_position(
    equity: float,
    i: int,
    cross_up: bool,
    opens: np.ndarray,
    dates: np.ndarray,
    rsi14: np.ndarray,
    rsi_min: float,
    rsi_max: float,
    stop_loss_pct: float,
) -> Position | None:
    rsi_ok = not np.isnan(rsi14[i]) and rsi_min <= rsi14[i] <= rsi_max
    if not (cross_up and rsi_ok):
        return None

    next_open = float(opens[i + 1])
    if next_open <= 0:
        return None

    return Position(
        entry_idx=i + 1,
        entry_time=dates[i + 1],
        entry_price=next_open,
        qty=equity / next_open,
        stop_price=next_open * (1.0 - stop_loss_pct),
        peak_price=next_open,
    )


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
    return float(max_dd)


def run_backtest(
    df: pd.DataFrame,
    symbol: str,
    name: str,
    initial_capital: float = 10000.0,
    stop_loss_pct: float = 0.05,
    trailing_stop_pct: float = 0.10,
    rsi_min: float = 40.0,
    rsi_max: float = 65.0,
) -> BacktestResult:
    if len(df) < 60:
        raise ValueError("Not enough bars to evaluate EMA50 strategy. Need at least 60 bars.")

    work = add_indicators(df)

    opens = work["open"].to_numpy(dtype=float)
    highs = work["high"].to_numpy(dtype=float)
    lows = work["low"].to_numpy(dtype=float)
    closes = work["close"].to_numpy(dtype=float)
    ema20 = work["ema20"].to_numpy(dtype=float)
    ema50 = work["ema50"].to_numpy(dtype=float)
    rsi14 = work["rsi14"].to_numpy(dtype=float)
    dates = work["date"].dt.strftime("%Y-%m-%d %H:%M:%S").to_numpy()

    equity = float(initial_capital)
    equity_curve: list[float] = [equity]
    trades: list[Trade] = []

    position: Position | None = None

    # We use bar i signals and execute at bar i+1 open to avoid lookahead bias.
    for i in range(1, len(work) - 1):
        cross_up = bool(ema20[i - 1] <= ema50[i - 1] and ema20[i] > ema50[i])
        cross_down = bool(ema20[i - 1] >= ema50[i - 1] and ema20[i] < ema50[i])

        if position is not None:
            position, closed_trade, exit_equity = _try_exit_position(
                position=position,
                i=i,
                cross_down=cross_down,
                highs=highs,
                lows=lows,
                opens=opens,
                dates=dates,
                trailing_stop_pct=trailing_stop_pct,
            )
            if closed_trade is not None and exit_equity is not None:
                trades.append(closed_trade)
                equity = float(exit_equity)

        if position is None:
            position = _try_enter_position(
                equity=equity,
                i=i,
                cross_up=cross_up,
                opens=opens,
                dates=dates,
                rsi14=rsi14,
                rsi_min=rsi_min,
                rsi_max=rsi_max,
                stop_loss_pct=stop_loss_pct,
            )

        mark_equity = position.qty * closes[i] if position is not None else equity
        equity_curve.append(float(mark_equity))

    if position is not None:
        exit_price = float(closes[-1])
        trades.append(_build_trade(position, dates[-1], exit_price, len(work) - 1, "EOD"))
        equity = position.qty * exit_price

    winners = [t for t in trades if t.pnl > 0]
    losers = [t for t in trades if t.pnl <= 0]
    gross_profit = sum(t.pnl for t in winners)
    gross_loss = abs(sum(t.pnl for t in losers))

    max_dd = _max_drawdown_pct(equity_curve)

    total_trades = len(trades)
    avg_win = float(np.mean([t.return_pct for t in winners])) if winners else 0.0
    avg_loss = float(np.mean([t.return_pct for t in losers])) if losers else 0.0

    return BacktestResult(
        symbol=symbol,
        name=name,
        initial_capital=round(initial_capital, 2),
        final_equity=round(equity, 2),
        total_return_pct=round((equity / initial_capital - 1.0) * 100.0, 2),
        total_trades=total_trades,
        winners=len(winners),
        losers=len(losers),
        win_rate=round((len(winners) / total_trades) * 100.0, 2) if total_trades else 0.0,
        avg_win_pct=round(avg_win, 2),
        avg_loss_pct=round(avg_loss, 2),
        profit_factor=round(gross_profit / gross_loss, 2) if gross_loss > 0 else 999.0,
        max_drawdown_pct=round(max_dd, 2),
        trades=trades,
    )


def run_buy_and_hold(df: pd.DataFrame, initial_capital: float = 10000.0) -> dict:
    opens = df["open"].to_numpy(dtype=float)
    closes = df["close"].to_numpy(dtype=float)
    if len(opens) < 2 or opens[0] <= 0:
        raise ValueError("Insufficient bars for buy-and-hold comparison.")

    shares = initial_capital / opens[0]
    final_equity = shares * closes[-1]
    return {
        "initial_capital": round(initial_capital, 2),
        "final_equity": round(float(final_equity), 2),
        "total_return_pct": round((final_equity / initial_capital - 1.0) * 100.0, 2),
        "entry_price": round(float(opens[0]), 4),
        "exit_price": round(float(closes[-1]), 4),
    }


def print_summary(result: BacktestResult, buy_hold: dict) -> None:
    print("=" * 72)
    print(f"{STRATEGY_NAME}")
    print("=" * 72)
    print(f"Symbol: {result.symbol} ({result.name})")
    print("\nMomentum Guard Results")
    print("-" * 72)
    print(f"Initial Capital : RM {result.initial_capital:,.2f}")
    print(f"Final Equity    : RM {result.final_equity:,.2f}")
    print(f"Total Return    : {result.total_return_pct:+.2f}%")
    print(f"Total Trades    : {result.total_trades}")
    print(f"Win Rate        : {result.win_rate:.2f}%")
    print(f"Avg Win / Loss  : {result.avg_win_pct:+.2f}% / {result.avg_loss_pct:+.2f}%")
    print(f"Profit Factor   : {result.profit_factor:.2f}")
    print(f"Max Drawdown    : {result.max_drawdown_pct:.2f}%")

    print("\nBuy and Hold Results")
    print("-" * 72)
    print(f"Initial Capital : RM {buy_hold['initial_capital']:,.2f}")
    print(f"Final Equity    : RM {buy_hold['final_equity']:,.2f}")
    print(f"Total Return    : {buy_hold['total_return_pct']:+.2f}%")
    print(f"Entry -> Exit   : RM {buy_hold['entry_price']:.4f} -> RM {buy_hold['exit_price']:.4f}")


def print_draft_summary(result: BacktestResult) -> None:
    print("\nBacktest Draft Summary (2024-2026)")
    print("-" * 72)

    trend_exit = None
    for t in result.trades:
        if t.exit_reason == "TREND_EXIT" and pd.Timestamp(t.exit_time) >= pd.Timestamp("2024-07-01"):
            trend_exit = t
            break

    recovery_entry = None
    for t in result.trades:
        if pd.Timestamp(t.entry_time) >= pd.Timestamp("2025-01-01"):
            recovery_entry = t
            break

    if trend_exit is not None:
        print(
            f"- Avoiding the crash: trend exit triggered on {trend_exit.exit_time} "
            f"near RM {trend_exit.exit_price:.2f}."
        )
    else:
        print("- Avoiding the crash: no trend-exit event found after Jul 2024 in this run.")

    if recovery_entry is not None:
        print(
            f"- Capturing the recovery: a new entry appeared on {recovery_entry.entry_time} "
            f"near RM {recovery_entry.entry_price:.2f}."
        )
    else:
        print("- Capturing the recovery: no post-2025 entry was found in this run.")

    print(
        f"- High win-rate bias: RSI(14) filter (40-65) kept entries selective, "
        f"producing a {result.win_rate:.2f}% win rate over {result.total_trades} trades."
    )


def save_trades(path: Path, result: BacktestResult) -> None:
    payload = {
        "strategy": STRATEGY_NAME,
        "symbol": result.symbol,
        "name": result.name,
        "metrics": {
            "initial_capital": result.initial_capital,
            "final_equity": result.final_equity,
            "total_return_pct": result.total_return_pct,
            "total_trades": result.total_trades,
            "winners": result.winners,
            "losers": result.losers,
            "win_rate": result.win_rate,
            "avg_win_pct": result.avg_win_pct,
            "avg_loss_pct": result.avg_loss_pct,
            "profit_factor": result.profit_factor,
            "max_drawdown_pct": result.max_drawdown_pct,
        },
        "trades": [asdict(t) for t in result.trades],
    }
    with path.open("w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2)


def main() -> None:
    parser = argparse.ArgumentParser(description="Run Greatech Momentum Guard strategy backtest")
    parser.add_argument(
        "--json",
        default=str(ROOT / "data" / "greatech_1h.json"),
        help="Path to OHLCV JSON file",
    )
    parser.add_argument("--start", default="2024-01-01", help="Backtest start date (inclusive)")
    parser.add_argument("--end", default="2026-12-31", help="Backtest end date (inclusive)")
    parser.add_argument("--capital", type=float, default=10000.0, help="Initial capital in RM")
    parser.add_argument(
        "--save-trades",
        default="",
        help="Optional output path to save trades JSON",
    )
    args = parser.parse_args()

    data_path = Path(args.json)
    if not data_path.exists():
        raise FileNotFoundError(f"Data file not found: {data_path}")

    df, symbol, name = load_json_ohlcv(data_path)
    start_ts = pd.Timestamp(args.start)
    end_ts = pd.Timestamp(args.end)
    df = df[(df["date"] >= start_ts) & (df["date"] <= end_ts)].copy()
    if len(df) < 60:
        raise ValueError("Date-filtered data has fewer than 60 bars. Widen the date range.")

    result = run_backtest(df=df, symbol=symbol, name=name, initial_capital=args.capital)
    buy_hold = run_buy_and_hold(df=df, initial_capital=args.capital)

    print_summary(result, buy_hold)
    print_draft_summary(result)

    if args.save_trades:
        out = Path(args.save_trades)
    else:
        out = ROOT / "data" / "greatech_momentum_guard_trades.json"
    save_trades(out, result)
    print(f"\nSaved trade log to: {out}")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"Error: {exc}", file=sys.stderr)
        raise