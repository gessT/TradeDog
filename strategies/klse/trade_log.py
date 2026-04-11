"""
trade_log.py — Generate and display detailed trade logs.
"""
from __future__ import annotations

import pandas as pd

from .backtest import BacktestResult, Trade


def to_dataframe(result: BacktestResult) -> pd.DataFrame:
    """Convert trade list to a pandas DataFrame."""
    if not result.trades:
        return pd.DataFrame()
    records = []
    for t in result.trades:
        records.append({
            "Entry Date": t.entry_date,
            "Exit Date": t.exit_date,
            "Entry": t.entry_price,
            "Exit": t.exit_price,
            "SL": t.sl_price,
            "TP": t.tp_price,
            "PnL": t.pnl,
            "Return%": t.return_pct,
            "RR": t.rr,
            "Bars": t.bars_held,
            "Reason": t.exit_reason,
            "Win": "✅" if t.win else "❌",
        })
    return pd.DataFrame(records)


def print_trade_log(result: BacktestResult, max_rows: int = 50) -> None:
    """Print formatted trade log to stdout."""
    df = to_dataframe(result)
    if df.empty:
        print("No trades executed.")
        return

    print("\n" + "═" * 120)
    print("  📋  TRADE LOG")
    print("═" * 120)

    display_df = df.tail(max_rows) if len(df) > max_rows else df
    pd.set_option("display.max_columns", 20)
    pd.set_option("display.width", 140)
    pd.set_option("display.float_format", lambda x: f"{x:.4f}" if abs(x) < 100 else f"{x:.2f}")
    print(display_df.to_string(index=False))
    if len(df) > max_rows:
        print(f"  ... showing last {max_rows} of {len(df)} trades")
    print("═" * 120)


def print_summary(result: BacktestResult) -> None:
    """Print backtest performance summary."""
    print("\n" + "═" * 60)
    print("  📊  BACKTEST PERFORMANCE SUMMARY")
    print("═" * 60)
    print(f"  Initial Capital:   MYR {result.initial_capital:>12,.2f}")
    print(f"  Final Equity:      MYR {result.final_equity:>12,.2f}")
    print(f"  Total Return:          {result.total_return_pct:>+10.2f}%")
    print(f"  Max Drawdown:          {result.max_drawdown_pct:>10.2f}%")
    print(f"  Sharpe Ratio:          {result.sharpe_ratio:>10.2f}")
    print("─" * 60)
    print(f"  Total Trades:          {result.total_trades:>10}")
    print(f"  Winners:               {result.winners:>10}")
    print(f"  Losers:                {result.losers:>10}")
    print(f"  Win Rate:              {result.win_rate:>9.1f}%")
    print(f"  Profit Factor:         {result.profit_factor:>10.2f}")
    print(f"  Risk/Reward:           {result.risk_reward:>10.2f}")
    print(f"  Avg Win:               {result.avg_win_pct:>+9.2f}%")
    print(f"  Avg Loss:              {result.avg_loss_pct:>+9.2f}%")
    print("═" * 60)
