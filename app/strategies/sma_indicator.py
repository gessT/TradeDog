# Pine Script Reference (TradingView):
# //@version=6
# indicator(title="Simple Moving Average", shorttitle="SMA", overlay=true)
# len = input.int(9, minval=1, title="Length")
# src = input(close, title="Source")
# out = ta.sma(src, len)
# plot(out, color=color.blue, title="MA")
#
# Smoothing MA: supports SMA, EMA, SMMA (RMA), WMA, Bollinger Bands

from __future__ import annotations

import math

import pandas as pd


def sma(values: list[float], length: int) -> list[float]:
    """Simple Moving Average — equivalent to ta.sma(src, len) in Pine Script."""
    series = pd.Series(values, dtype="float64")
    return series.rolling(window=length).mean().tolist()


def ema(values: list[float], length: int) -> list[float]:
    """Exponential Moving Average — equivalent to ta.ema(src, len)."""
    series = pd.Series(values, dtype="float64")
    return series.ewm(span=length, adjust=False).mean().tolist()


def rma(values: list[float], length: int) -> list[float]:
    """Smoothed Moving Average (RMA) — equivalent to ta.rma(src, len)."""
    series = pd.Series(values, dtype="float64")
    return series.ewm(alpha=1 / length, adjust=False).mean().tolist()


def wma(values: list[float], length: int) -> list[float]:
    """Weighted Moving Average — equivalent to ta.wma(src, len)."""
    series = pd.Series(values, dtype="float64")
    weights = list(range(1, length + 1))
    return series.rolling(window=length).apply(
        lambda x: sum(w * v for w, v in zip(weights, x)) / sum(weights),
        raw=True,
    ).tolist()


def stdev(values: list[float], length: int) -> list[float]:
    """Standard deviation — equivalent to ta.stdev(src, len)."""
    series = pd.Series(values, dtype="float64")
    return series.rolling(window=length).std().tolist()


def bollinger_bands(
    values: list[float],
    length: int = 14,
    mult: float = 2.0,
) -> dict[str, list[float]]:
    """Bollinger Bands around SMA — equivalent to SMA + Bollinger Bands mode."""
    basis = sma(values, length)
    sd = stdev(values, length)
    upper = [
        b + mult * s if not (math.isnan(b) or math.isnan(s)) else float("nan")
        for b, s in zip(basis, sd)
    ]
    lower = [
        b - mult * s if not (math.isnan(b) or math.isnan(s)) else float("nan")
        for b, s in zip(basis, sd)
    ]
    return {"basis": basis, "upper": upper, "lower": lower}


def smoothing_ma(
    values: list[float],
    length: int,
    ma_type: str = "SMA",
) -> list[float]:
    """Apply a smoothing MA on top of another indicator output.

    Supports: SMA, EMA, SMMA (RMA), WMA — mirrors the Pine Script smoothing selector.
    """
    if ma_type in ("SMA", "SMA + Bollinger Bands"):
        return sma(values, length)
    if ma_type == "EMA":
        return ema(values, length)
    if ma_type in ("SMMA (RMA)", "RMA"):
        return rma(values, length)
    if ma_type == "WMA":
        return wma(values, length)
    return values


def sma5(closes: list[float]) -> list[float]:
    """Shortcut: SMA with length=5, ready to use for the backtest."""
    return sma(closes, 5)
