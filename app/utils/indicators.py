from __future__ import annotations

import math

import pandas as pd


def sma(values: list[float], window: int) -> list[float]:
    series = pd.Series(values, dtype="float64")
    return series.rolling(window=window).mean().tolist()


def ema(values: list[float], window: int) -> list[float]:
    series = pd.Series(values, dtype="float64")
    return series.ewm(span=window, adjust=False).mean().tolist()


def rsi(values: list[float], window: int = 14) -> list[float]:
    series = pd.Series(values, dtype="float64")
    delta = series.diff()
    gain = delta.clip(lower=0)
    loss = -delta.clip(upper=0)
    avg_gain = gain.rolling(window=window).mean()
    avg_loss = loss.rolling(window=window).mean()
    rs = avg_gain / avg_loss.replace(0, math.nan)
    rsi_series = 100 - (100 / (1 + rs))
    return rsi_series.fillna(50).tolist()