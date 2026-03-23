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


def weekly_supertrend(
    dates: list,
    opens: list[float],
    highs: list[float],
    lows: list[float],
    closes: list[float],
    period: int = 10,
    multiplier: float = 3.0,
) -> list[int]:
    """Compute weekly Supertrend and map back to daily bars.

    Returns a list of direction values per daily bar:
      -1 = uptrend, 1 = downtrend  (Pine convention)
    """
    n = len(closes)
    if n == 0:
        return []

    # ── Aggregate daily → weekly OHLC ──
    w_open: list[float] = []
    w_high: list[float] = []
    w_low: list[float] = []
    w_close: list[float] = []
    week_index: list[int] = []  # maps daily bar → weekly index
    w_idx = -1

    for i in range(n):
        d = pd.Timestamp(dates[i])
        dow = d.dayofweek  # 0=Mon
        prev_ts = pd.Timestamp(dates[i - 1]) if i > 0 else None
        new_week = (
            w_idx < 0
            or dow == 0
            or (prev_ts is not None and (d - prev_ts).days > 3)
        )
        if new_week:
            w_open.append(opens[i])
            w_high.append(highs[i])
            w_low.append(lows[i])
            w_close.append(closes[i])
            w_idx += 1
        else:
            w_high[w_idx] = max(w_high[w_idx], highs[i])
            w_low[w_idx] = min(w_low[w_idx], lows[i])
            w_close[w_idx] = closes[i]
        week_index.append(w_idx)

    wn = len(w_close)

    # ── True Range ──
    tr = [0.0] * wn
    tr[0] = w_high[0] - w_low[0]
    for i in range(1, wn):
        hl = w_high[i] - w_low[i]
        hc = abs(w_high[i] - w_close[i - 1])
        lc = abs(w_low[i] - w_close[i - 1])
        tr[i] = max(hl, hc, lc)

    # ── ATR (Wilder / RMA) ──
    atr = [0.0] * wn
    if wn >= period:
        atr[period - 1] = sum(tr[:period]) / period
        for i in range(period, wn):
            atr[i] = (atr[i - 1] * (period - 1) + tr[i]) / period

    # ── Supertrend ──
    up = [0.0] * wn
    dn = [0.0] * wn
    d = [-1] * wn  # -1 = uptrend

    for i in range(wn):
        src = (w_high[i] + w_low[i]) / 2
        basic_up = src - multiplier * atr[i]
        basic_dn = src + multiplier * atr[i]

        if i == 0:
            up[i] = basic_up
            dn[i] = basic_dn
            d[i] = -1
        else:
            up[i] = max(basic_up, up[i - 1]) if w_close[i - 1] > up[i - 1] else basic_up
            dn[i] = min(basic_dn, dn[i - 1]) if w_close[i - 1] < dn[i - 1] else basic_dn

            if d[i - 1] == 1 and w_close[i] > dn[i - 1]:
                d[i] = -1
            elif d[i - 1] == -1 and w_close[i] < up[i - 1]:
                d[i] = 1
            else:
                d[i] = d[i - 1]

    # Map weekly dir back to daily
    return [d[week_index[i]] for i in range(n)]