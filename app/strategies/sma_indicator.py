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


def atr(highs: list[float], lows: list[float], closes: list[float], length: int = 100) -> list[float]:
    """Average True Range — equivalent to ta.atr(length)."""
    n = len(closes)
    tr = [float("nan")] * n
    for i in range(n):
        if i == 0:
            tr[i] = highs[i] - lows[i]
        else:
            tr[i] = max(
                highs[i] - lows[i],
                abs(highs[i] - closes[i - 1]),
                abs(lows[i] - closes[i - 1]),
            )
    return rma(tr, length)


def halftrend(
    highs: list[float],
    lows: list[float],
    closes: list[float],
    amplitude: int = 5,
    channel_deviation: float = 2.0,
    atr_length: int = 100,
) -> list[int]:
    """HalfTrend indicator — returns trend state per bar.

    Returns a list of ints: 0 = up (green), 1 = down (red).
    Matches the TradingView HalfTrend PineScript indicator with nextTrend logic.
    """
    result = halftrend_full(highs, lows, closes, amplitude, channel_deviation, atr_length)
    return result["trend"]


def halftrend_full(
    highs: list[float],
    lows: list[float],
    closes: list[float],
    amplitude: int = 5,
    channel_deviation: float = 2.0,
    atr_length: int = 100,
) -> dict[str, list]:
    """HalfTrend indicator — returns trend state and HT line value per bar.

    Returns dict with:
      - "trend": list[int] — 0 = up (green), 1 = down (red)
      - "ht": list[float] — the HalfTrend line value (up or down)

    Matches the TradingView HalfTrend PineScript indicator with nextTrend logic.

    Pine Script equivalent::

        if nextTrend == 1
            maxLowPrice := math.max(lowPrice, maxLowPrice)
            if highma < maxLowPrice and close < nz(low[1], low)
                trend := 1;  nextTrend := 0;  minHighPrice := highPrice
        else
            minHighPrice := math.min(highPrice, minHighPrice)
            if lowma > minHighPrice and close > nz(high[1], high)
                trend := 0;  nextTrend := 1;  maxLowPrice := lowPrice
    """
    n = len(closes)

    trend = [0] * n
    next_trend = [0] * n
    max_low_price = [0.0] * n
    min_high_price = [0.0] * n
    up = [float("nan")] * n
    down = [float("nan")] * n
    ht = [float("nan")] * n

    # Initialize first bar (Pine Script: barstate.isfirst)
    max_low_price[0] = lows[0]
    min_high_price[0] = highs[0]
    up[0] = lows[0]
    ht[0] = lows[0]

    for i in range(1, n):
        # highest high and lowest low over amplitude bars
        start = max(0, i - amplitude + 1)
        high_price = max(highs[start: i + 1])
        low_price = min(lows[start: i + 1])

        high_ma = sum(highs[start: i + 1]) / (i - start + 1)
        low_ma = sum(lows[start: i + 1]) / (i - start + 1)

        prev_next = next_trend[i - 1]
        prev_max_low = max_low_price[i - 1]
        prev_min_high = min_high_price[i - 1]

        cur_trend = trend[i - 1]
        cur_next = prev_next
        cur_max_low = prev_max_low
        cur_min_high = prev_min_high

        if cur_next == 1:
            cur_max_low = max(low_price, prev_max_low)
            if high_ma < cur_max_low and closes[i] < lows[i - 1]:
                cur_trend = 1
                cur_next = 0
                cur_min_high = high_price
        else:
            cur_min_high = min(high_price, prev_min_high)
            if low_ma > cur_min_high and closes[i] > highs[i - 1]:
                cur_trend = 0
                cur_next = 1
                cur_max_low = low_price

        trend[i] = cur_trend
        next_trend[i] = cur_next
        max_low_price[i] = cur_max_low
        min_high_price[i] = cur_min_high

        # Compute HalfTrend line value (up/down)
        if cur_trend == 0:  # uptrend
            if trend[i - 1] != 0:
                # Trend just flipped up — seed from previous down value
                up[i] = down[i - 1] if not math.isnan(down[i - 1]) else cur_max_low
            else:
                prev_up = up[i - 1] if not math.isnan(up[i - 1]) else cur_max_low
                up[i] = max(cur_max_low, prev_up)
            ht[i] = up[i]
        else:  # downtrend
            if trend[i - 1] != 1:
                # Trend just flipped down — seed from previous up value
                down[i] = up[i - 1] if not math.isnan(up[i - 1]) else cur_min_high
            else:
                prev_down = down[i - 1] if not math.isnan(down[i - 1]) else cur_min_high
                down[i] = min(cur_min_high, prev_down)
            ht[i] = down[i]

    return {"trend": trend, "ht": ht}
