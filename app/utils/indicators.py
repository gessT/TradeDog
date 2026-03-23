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


def detect_candle(open_: float, high: float, low: float, close: float) -> str | None:
    """Detect single-candle pattern. Returns pattern name or None."""
    body = abs(close - open_)
    rng = high - low
    if rng == 0:
        return None

    upper_shadow = high - max(open_, close)
    lower_shadow = min(open_, close) - low
    body_ratio = body / rng

    # Inverted Hammer: small body near bottom, long upper shadow
    if upper_shadow >= body * 2 and lower_shadow < body * 0.5 and body_ratio < 0.35:
        return "Inverted Hammer" if close >= open_ else "Shooting Star"

    # Hammer: small body near top, long lower shadow
    if lower_shadow >= body * 2 and upper_shadow < body * 0.5 and body_ratio < 0.35:
        return "Hammer"

    # Doji
    if body_ratio < 0.05:
        return "Doji"

    return None