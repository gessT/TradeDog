"""
data_loader.py — Load OHLCV JSON data into pandas DataFrames.
"""
import json
import pandas as pd


def load_json(path: str) -> pd.DataFrame:
    """Load OHLCV data from a TradeDog JSON file.

    Expected JSON shape:
      { "symbol": "...", "data": [ {"date","open","high","low","close","volume"}, ... ] }
    """
    with open(path, encoding="utf-8") as f:
        raw = json.load(f)

    records = raw["data"] if isinstance(raw, dict) else raw
    df = pd.DataFrame(records)
    df["date"] = pd.to_datetime(df["date"])
    df.sort_values("date", inplace=True)
    df.reset_index(drop=True, inplace=True)

    for col in ("open", "high", "low", "close"):
        df[col] = df[col].astype(float)
    df["volume"] = df["volume"].astype(float)

    return df


def resample_weekly(df: pd.DataFrame) -> pd.DataFrame:
    """Aggregate daily OHLCV into weekly bars (Mon–Fri)."""
    tmp = df.set_index("date")
    weekly = tmp.resample("W-FRI").agg({
        "open": "first",
        "high": "max",
        "low": "min",
        "close": "last",
        "volume": "sum",
    }).dropna()
    weekly.reset_index(inplace=True)
    return weekly
