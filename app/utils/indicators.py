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


def atr(highs: list[float], lows: list[float], closes: list[float], period: int = 14) -> list[float]:
    """Average True Range (ATR) using Wilder smoothing (RMA)."""
    n = len(closes)
    if n == 0:
        return []
    tr = [highs[0] - lows[0]]
    for i in range(1, n):
        hl = highs[i] - lows[i]
        hc = abs(highs[i] - closes[i - 1])
        lc = abs(lows[i] - closes[i - 1])
        tr.append(max(hl, hc, lc))
    result = [float("nan")] * n
    alpha = 1.0 / period
    prev = 0.0
    for i in range(n):
        prev = alpha * tr[i] + (1 - alpha) * prev
        result[i] = prev
    return result


def detect_candle(open_: float, high: float, low: float, close: float) -> str | None:
    """Detect single-candle pattern. Returns pattern name or None.

    Bullish (bottom reversal):  Hammer, Inverted Hammer
    Bearish (top reversal):     Hanging Man, Shooting Star
    """
    body = abs(close - open_)
    rng = high - low
    if rng == 0:
        return None

    upper_shadow = high - max(open_, close)
    lower_shadow = min(open_, close) - low
    body_ratio = body / rng
    is_bullish = close >= open_

    # Long lower shadow, small body near top → Hammer (bullish) or Hanging Man (bearish context)
    if lower_shadow >= body * 2 and upper_shadow < body * 0.5 and body_ratio < 0.35:
        return "Hammer" if is_bullish else "Hanging Man"

    # Long upper shadow, small body near bottom → Inverted Hammer (bullish) or Shooting Star (bearish context)
    if upper_shadow >= body * 2 and lower_shadow < body * 0.5 and body_ratio < 0.35:
        return "Inverted Hammer" if is_bullish else "Shooting Star"

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

    Matches Pine Script:
        [st, dir] = ta.supertrend(factor, atrPeriod)
        request.security(syminfo.tickerid, "W", ..., lookahead=barmerge.lookahead_on)

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

    # ── ATR via RMA (Pine ta.rma / Wilder smoothing) ──
    # Pine: alpha = 1/length; sum := alpha*src + (1-alpha)*nz(sum[1])
    # Bar 0: nz(prev) = 0 → atr = alpha * tr
    atr = [0.0] * wn
    alpha = 1.0 / period
    for i in range(wn):
        prev = atr[i - 1] if i > 0 else 0.0
        atr[i] = alpha * tr[i] + (1 - alpha) * prev

    # ── Supertrend (matches Pine ta.supertrend) ──
    up = [0.0] * wn
    dn = [0.0] * wn
    direction = [-1] * wn  # -1 = uptrend, 1 = downtrend

    for i in range(wn):
        src = (w_high[i] + w_low[i]) / 2
        basic_up = src - multiplier * atr[i]
        basic_dn = src + multiplier * atr[i]

        if i == 0:
            up[i] = basic_up
            dn[i] = basic_dn
            direction[i] = -1
        else:
            up[i] = max(basic_up, up[i - 1]) if w_close[i - 1] > up[i - 1] else basic_up
            dn[i] = min(basic_dn, dn[i - 1]) if w_close[i - 1] < dn[i - 1] else basic_dn

            if direction[i - 1] == 1 and w_close[i] > dn[i - 1]:
                direction[i] = -1
            elif direction[i - 1] == -1 and w_close[i] < up[i - 1]:
                direction[i] = 1
            else:
                direction[i] = direction[i - 1]

    # Map weekly direction back to daily bars (lookahead=on: current week value)
    return [direction[week_index[i]] for i in range(n)]


# ── Left-side trading indicators ────────────────────────────────────


def pivot_low(lows: list[float], lookback: int = 10) -> list[float | None]:
    """Detect swing lows (pivot lows) — equivalent to ta.pivotlow(low, lb, lb).

    Returns a list where non-None values are confirmed swing low prices.
    The pivot is confirmed ``lookback`` bars after the actual low, matching
    Pine Script's delayed confirmation behaviour.
    """
    n = len(lows)
    result: list[float | None] = [None] * n
    for i in range(lookback, n - lookback):
        is_pivot = True
        for j in range(i - lookback, i + lookback + 1):
            if j == i:
                continue
            if lows[j] <= lows[i]:
                is_pivot = False
                break
        if is_pivot:
            # Confirmed at bar i + lookback (delayed)
            confirm_bar = i + lookback
            if confirm_bar < n:
                result[confirm_bar] = lows[i]
    return result


def pivot_high(highs: list[float], lookback: int = 10) -> list[float | None]:
    """Detect swing highs (pivot highs) — equivalent to ta.pivothigh(high, lb, lb)."""
    n = len(highs)
    result: list[float | None] = [None] * n
    for i in range(lookback, n - lookback):
        is_pivot = True
        for j in range(i - lookback, i + lookback + 1):
            if j == i:
                continue
            if highs[j] >= highs[i]:
                is_pivot = False
                break
        if is_pivot:
            confirm_bar = i + lookback
            if confirm_bar < n:
                result[confirm_bar] = highs[i]
    return result


def hourly_supertrend(
    dates: list,
    opens: list[float],
    highs: list[float],
    lows: list[float],
    closes: list[float],
    period: int = 10,
    multiplier: float = 3.0,
) -> list[int]:
    """Compute 1-hour Supertrend and map back to daily bars.

    Since the backtest engine uses daily OHLCV, this approximates the
    1H Supertrend by treating each daily bar as a single unit and
    applying the Supertrend. For true intraday, feed intraday data.

    Returns direction per bar: -1 = uptrend, 1 = downtrend.
    """
    n = len(closes)
    if n == 0:
        return []

    # True Range
    tr = [highs[0] - lows[0]]
    for i in range(1, n):
        hl = highs[i] - lows[i]
        hc = abs(highs[i] - closes[i - 1])
        lc = abs(lows[i] - closes[i - 1])
        tr.append(max(hl, hc, lc))

    # ATR via RMA
    atr_vals = [0.0] * n
    alpha = 1.0 / period
    for i in range(n):
        prev = atr_vals[i - 1] if i > 0 else 0.0
        atr_vals[i] = alpha * tr[i] + (1 - alpha) * prev

    # Supertrend
    up_band = [0.0] * n
    dn_band = [0.0] * n
    direction = [-1] * n

    for i in range(n):
        src = (highs[i] + lows[i]) / 2
        basic_up = src - multiplier * atr_vals[i]
        basic_dn = src + multiplier * atr_vals[i]

        if i == 0:
            up_band[i] = basic_up
            dn_band[i] = basic_dn
            direction[i] = -1
        else:
            up_band[i] = max(basic_up, up_band[i - 1]) if closes[i - 1] > up_band[i - 1] else basic_up
            dn_band[i] = min(basic_dn, dn_band[i - 1]) if closes[i - 1] < dn_band[i - 1] else basic_dn

            if direction[i - 1] == 1 and closes[i] > dn_band[i - 1]:
                direction[i] = -1
            elif direction[i - 1] == -1 and closes[i] < up_band[i - 1]:
                direction[i] = 1
            else:
                direction[i] = direction[i - 1]

    return direction


def liquidity_sweep(
    highs: list[float],
    lows: list[float],
    closes: list[float],
    pivot_lows: list[float | None],
    valid_bars: int = 8,
    wick_only: bool = True,
) -> list[dict | None]:
    """Detect liquidity sweeps (fakeouts below swing lows).

    For each bar, checks if price wicked below the most recent confirmed
    swing low then closed back above it.

    Returns a list of dicts (or None) per bar:
      {"sweep_low": float, "sweep_bar": int}
    """
    n = len(closes)
    result: list[dict | None] = [None] * n

    last_swing_low: float | None = None

    for i in range(n):
        # Update latest confirmed swing low
        if pivot_lows[i] is not None:
            last_swing_low = pivot_lows[i]

        if last_swing_low is None:
            continue

        is_sweep = False
        if wick_only:
            is_sweep = lows[i] < last_swing_low and closes[i] > last_swing_low
        else:
            is_sweep = (lows[i] < last_swing_low and closes[i] > last_swing_low) or \
                       (i > 0 and closes[i - 1] < last_swing_low and closes[i] > last_swing_low)

        if is_sweep:
            sweep_low = min(lows[i], last_swing_low)
            result[i] = {"sweep_low": sweep_low, "sweep_bar": i}

    return result


def market_structure_shift(
    highs: list[float],
    lows: list[float],
    closes: list[float],
    pivot_highs_list: list[float | None],
    pivot_lows_list: list[float | None],
) -> list[bool]:
    """Detect Market Structure Shift (Higher Low or Break of Structure).

    Returns a boolean list — True on bars where MSS is detected.
    """
    n = len(closes)
    result = [False] * n

    prev_swing_low: float | None = None
    curr_swing_low: float | None = None
    last_swing_high: float | None = None

    for i in range(n):
        if pivot_lows_list[i] is not None:
            prev_swing_low = curr_swing_low
            curr_swing_low = pivot_lows_list[i]

        if pivot_highs_list[i] is not None:
            last_swing_high = pivot_highs_list[i]

        # Higher Low
        higher_low = (prev_swing_low is not None and curr_swing_low is not None
                      and curr_swing_low > prev_swing_low)

        # Break of Structure: close breaks above last swing high
        bos = (last_swing_high is not None and closes[i] > last_swing_high
               and (i > 0 and closes[i - 1] <= last_swing_high))

        if higher_low or bos:
            result[i] = True

    return result