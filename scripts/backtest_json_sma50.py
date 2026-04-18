import argparse
import json
import sys
from typing import Tuple

import pandas as pd


def load_json_ohlcv(file_path: str) -> pd.DataFrame:
    with open(file_path, "r", encoding="utf-8") as f:
        raw = json.load(f)

    if not isinstance(raw, list) or not raw:
        raise ValueError("Input JSON must be a non-empty array of arrays.")

    df = pd.DataFrame(raw, columns=["Date", "Open", "High", "Low", "Close", "Volume"])

    if df.shape[1] != 6:
        raise ValueError("Each row must contain exactly 6 values: [Date, Open, High, Low, Close, Volume].")

    df["Date"] = pd.to_datetime(df["Date"], errors="coerce")
    for col in ["Open", "High", "Low", "Close", "Volume"]:
        df[col] = pd.to_numeric(df[col], errors="coerce")

    df = df.dropna(subset=["Date", "Close"]).sort_values("Date").reset_index(drop=True)

    if df.empty:
        raise ValueError("No valid rows after parsing input data.")

    return df


def run_backtest(df: pd.DataFrame, initial_capital: float = 10000.0, sma_window: int = 50) -> Tuple[float, float, pd.DataFrame]:
    if len(df) < sma_window:
        raise ValueError(f"Not enough rows for SMA{sma_window}. Need at least {sma_window} rows.")

    bt = df.copy()
    bt["SMA"] = bt["Close"].rolling(window=sma_window, min_periods=sma_window).mean()

    # Strategy: long when Close > SMA, flat otherwise (position applied on next bar).
    bt["Signal"] = (bt["Close"] > bt["SMA"]).astype(int)
    bt["Position"] = bt["Signal"].shift(1).fillna(0)

    bt["MarketReturn"] = bt["Close"].pct_change().fillna(0.0)
    bt["StrategyReturn"] = bt["Position"] * bt["MarketReturn"]

    bt["Equity"] = initial_capital * (1.0 + bt["StrategyReturn"]).cumprod()

    final_equity = float(bt["Equity"].iloc[-1])
    roi = ((final_equity - initial_capital) / initial_capital) * 100.0

    return roi, final_equity, bt


def main() -> None:
    parser = argparse.ArgumentParser(description="Backtest SMA strategy from JSON OHLCV array data.")
    parser.add_argument("json_file", help="Path to JSON file with [[YYYY-MM-DD, Open, High, Low, Close, Volume], ...]")
    parser.add_argument("--capital", type=float, default=10000.0, help="Initial capital")
    parser.add_argument("--sma", type=int, default=50, help="SMA window")
    args = parser.parse_args()

    df = load_json_ohlcv(args.json_file)
    roi, _, _ = run_backtest(df, initial_capital=args.capital, sma_window=args.sma)

    print(f"Final ROI: {roi:.2f}%")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"Error: {exc}", file=sys.stderr)
        raise
