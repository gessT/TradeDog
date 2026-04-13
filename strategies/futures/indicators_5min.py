"""
5-Minute Indicators — MACD, Breakout, Session Filter, ATR Range
================================================================
Dedicated indicator functions for the 5-minute scalping strategy.
Uses existing EMA/RSI/ATR/Supertrend from indicators.py.
"""
from __future__ import annotations

import math
import numpy as np
import pandas as pd


# ═══════════════════════════════════════════════════════════════════════
# MACD
# ═══════════════════════════════════════════════════════════════════════

def macd(
    close: pd.Series,
    fast: int = 12,
    slow: int = 26,
    signal: int = 9,
) -> tuple[pd.Series, pd.Series, pd.Series]:
    """Return (macd_line, signal_line, histogram)."""
    ema_fast = close.ewm(span=fast, adjust=False).mean()
    ema_slow = close.ewm(span=slow, adjust=False).mean()
    macd_line = ema_fast - ema_slow
    signal_line = macd_line.ewm(span=signal, adjust=False).mean()
    histogram = macd_line - signal_line
    return macd_line, signal_line, histogram


# ═══════════════════════════════════════════════════════════════════════
# Breakout / Pullback detection
# ═══════════════════════════════════════════════════════════════════════

def breakout_high(
    close: pd.Series,
    high: pd.Series,
    lookback: int = 20,
) -> pd.Series:
    """True when close breaks above the highest high of *lookback* bars (shifted)."""
    prev_high = high.rolling(lookback).max().shift(1)
    return (close > prev_high).astype(int)


def breakout_low(
    close: pd.Series,
    low: pd.Series,
    lookback: int = 20,
) -> pd.Series:
    """True when close breaks below the lowest low of *lookback* bars (shifted)."""
    prev_low = low.rolling(lookback).min().shift(1)
    return (close < prev_low).astype(int)


def pullback_to_ema(
    close: pd.Series,
    ema_line: pd.Series,
    atr_vals: pd.Series,
    max_dist_atr: float = 2.0,
) -> pd.Series:
    """True when price is within *max_dist_atr* × ATR of the EMA (either side).

    Allows both slight dips below EMA and hovering above — captures
    real pullback‐to‐support behaviour instead of only "above EMA".
    """
    dist = (close - ema_line).abs()
    return (dist <= max_dist_atr * atr_vals).astype(int)


def ema_slope(
    ema_line: pd.Series,
    lookback: int = 3,
) -> pd.Series:
    """True when EMA has been rising over the last *lookback* bars."""
    return (ema_line > ema_line.shift(lookback)).astype(int)


def ema_slope_falling(
    ema_line: pd.Series,
    lookback: int = 3,
) -> pd.Series:
    """True when EMA has been falling over the last *lookback* bars."""
    return (ema_line < ema_line.shift(lookback)).astype(int)


# ═══════════════════════════════════════════════════════════════════════
# Volume Spike
# ═══════════════════════════════════════════════════════════════════════

def volume_spike(
    volume: pd.Series,
    period: int = 20,
    threshold: float = 0.8,
) -> pd.Series:
    """True when volume exceeds *threshold* × rolling mean.

    Default 0.8 is intentionally loose — filters out only dead-volume
    bars rather than requiring an actual spike.  The trend + pullback +
    supertrend conditions already provide quality filtering.
    """
    vol_ma = volume.rolling(period).mean()
    return (volume > threshold * vol_ma).astype(int)


# ═══════════════════════════════════════════════════════════════════════
# Session Time Filter
# ═══════════════════════════════════════════════════════════════════════

def in_session(
    index: pd.DatetimeIndex,
    sessions: list[tuple[int, int]] | None = None,
) -> pd.Series:
    """Return boolean Series — True when bar falls within allowed sessions.

    *sessions* is a list of (start_hour, end_hour) in UTC.
    Defaults to NY main session (13:30–20:00 UTC) + London overlap (07:00–11:30 UTC).
    """
    if sessions is None:
        sessions = [
            (13, 20),   # NY session  09:30–16:00 ET → 13:30–20:00 UTC (approx)
            (7, 12),    # London overlap  03:00–07:30 ET → 07:00–12:00 UTC
        ]

    hours = index.hour
    mask = pd.Series(False, index=index)
    for start_h, end_h in sessions:
        mask = mask | ((hours >= start_h) & (hours < end_h))
    return mask.astype(int)


# ═══════════════════════════════════════════════════════════════════════
# ATR Range Filter  (skip low-volatility / ranging markets)
# ═══════════════════════════════════════════════════════════════════════

def atr_range_ok(
    atr_vals: pd.Series,
    min_atr_pct: float = 0.05,
    close: pd.Series | None = None,
) -> pd.Series:
    """True when ATR as % of close exceeds *min_atr_pct*%.

    Filters out flat / ranging bars where signals are unreliable.
    """
    if close is None:
        return pd.Series(True, index=atr_vals.index)
    pct = atr_vals / close * 100
    return (pct >= min_atr_pct).astype(int)


# ═══════════════════════════════════════════════════════════════════════
# RSI momentum shift
# ═══════════════════════════════════════════════════════════════════════

def rsi_rising(
    rsi_vals: pd.Series,
    low_thresh: float = 35.0,
    strength_thresh: float = 45.0,
) -> pd.Series:
    """True when RSI shows bullish momentum."""
    was_low = rsi_vals.rolling(5).min() < low_thresh
    now_strong = rsi_vals > strength_thresh
    in_zone = (rsi_vals >= 35) & (rsi_vals <= 65)
    rising = rsi_vals > rsi_vals.shift(2)
    return ((was_low & now_strong) | (in_zone & rising)).astype(int)


def rsi_falling(
    rsi_vals: pd.Series,
    high_thresh: float = 65.0,
    weakness_thresh: float = 55.0,
) -> pd.Series:
    """True when RSI shows bearish momentum (mirror of rsi_rising)."""
    was_high = rsi_vals.rolling(5).max() > high_thresh
    now_weak = rsi_vals < weakness_thresh
    in_zone = (rsi_vals >= 35) & (rsi_vals <= 65)
    falling = rsi_vals < rsi_vals.shift(2)
    return ((was_high & now_weak) | (in_zone & falling)).astype(int)


def macd_momentum(
    macd_hist: pd.Series,
    lookback: int = 3,
) -> pd.Series:
    """True when MACD histogram is positive OR has just crossed above zero."""
    positive = macd_hist > 0
    was_neg = macd_hist.rolling(lookback).min() < 0
    fresh_cross = positive & was_neg
    return (positive | fresh_cross).astype(int)


def macd_momentum_bear(
    macd_hist: pd.Series,
    lookback: int = 3,
) -> pd.Series:
    """True when MACD histogram is negative OR has just crossed below zero."""
    negative = macd_hist < 0
    was_pos = macd_hist.rolling(lookback).max() > 0
    fresh_cross = negative & was_pos
    return (negative | fresh_cross).astype(int)


# ═══════════════════════════════════════════════════════════════════════
# ADX — Average Directional Index (trend strength filter)
# ═══════════════════════════════════════════════════════════════════════

def adx(
    high: pd.Series,
    low: pd.Series,
    close: pd.Series,
    period: int = 14,
) -> pd.Series:
    """Compute ADX (trend strength 0–100).

    ADX > 20 = trending market (good for entries).
    ADX < 20 = ranging/choppy (avoid signals).
    """
    plus_dm = high.diff()
    minus_dm = -low.diff()
    plus_dm = plus_dm.where((plus_dm > minus_dm) & (plus_dm > 0), 0.0)
    minus_dm = minus_dm.where((minus_dm > plus_dm) & (minus_dm > 0), 0.0)

    tr1 = high - low
    tr2 = (high - close.shift(1)).abs()
    tr3 = (low - close.shift(1)).abs()
    tr = pd.concat([tr1, tr2, tr3], axis=1).max(axis=1)

    atr_smooth = tr.ewm(span=period, adjust=False).mean()
    plus_di = 100 * (plus_dm.ewm(span=period, adjust=False).mean() / atr_smooth)
    minus_di = 100 * (minus_dm.ewm(span=period, adjust=False).mean() / atr_smooth)

    dx = (plus_di - minus_di).abs() / (plus_di + minus_di).replace(0, 1e-10) * 100
    adx_val = dx.ewm(span=period, adjust=False).mean()
    return adx_val


def higher_tf_trend(
    close: pd.Series,
    ema_period: int = 50,
) -> pd.Series:
    """Simulate a higher timeframe trend using a longer EMA.

    Returns 1 when close is above the long EMA (bullish bias).
    This acts as a regime filter — only trade longs in uptrends.
    """
    long_ema = close.ewm(span=ema_period, adjust=False).mean()
    return (close > long_ema).astype(int)


# ═══════════════════════════════════════════════════════════════════════
# Market Structure — Higher High / Lower Low detection
# ═══════════════════════════════════════════════════════════════════════

def _find_swing_points(
    high: pd.Series,
    low: pd.Series,
    order: int = 3,
) -> tuple[list[tuple[int, float]], list[tuple[int, float]]]:
    """Detect swing highs/lows using a ±order bar window.

    A swing high is a bar whose high is the highest in [i-order, i+order].
    A swing low is a bar whose low is the lowest in [i-order, i+order].

    Returns (swing_highs, swing_lows) as lists of (index_position, price).
    """
    swing_highs: list[tuple[int, float]] = []
    swing_lows: list[tuple[int, float]] = []

    h_vals = high.values
    l_vals = low.values
    n = len(h_vals)

    for i in range(order, n - order):
        # Swing high: bar i is highest in window
        window_h = h_vals[i - order : i + order + 1]
        if h_vals[i] == window_h.max() and h_vals[i] > h_vals[i - 1]:
            swing_highs.append((i, float(h_vals[i])))

        # Swing low: bar i is lowest in window
        window_l = l_vals[i - order : i + order + 1]
        if l_vals[i] == window_l.min() and l_vals[i] < l_vals[i - 1]:
            swing_lows.append((i, float(l_vals[i])))

    return swing_highs, swing_lows


def market_structure(
    high: pd.Series,
    low: pd.Series,
    close: pd.Series,
    lookback: int = 100,
    swing_order: int = 3,
) -> pd.Series:
    """Detect market structure over *lookback* bars.

    Returns a Series with values:
       1 = BULL  (Higher Highs + Higher Lows)
      -1 = BEAR  (Lower Highs + Lower Lows)
       0 = SIDEWAYS (横盘) — mixed or no clear structure

    Uses multi-layer voting:
    1. Swing point analysis (last bar in the window)
    2. EMA slope confirmation
    3. Price vs EMA position
    Majority vote across layers decides the structure.
    """
    n = len(close)
    result = pd.Series(0, index=close.index, dtype=int)

    # Pre-compute EMAs for trend confirmation
    ema20 = close.ewm(span=20, adjust=False).mean()
    ema50 = close.ewm(span=50, adjust=False).mean()

    for i in range(lookback, n):
        votes_bull = 0
        votes_bear = 0

        # ── Layer 1: Swing Point Analysis ────────────────────────────
        start = max(0, i - lookback)
        h_window = high.iloc[start : i + 1]
        l_window = low.iloc[start : i + 1]

        swing_highs, swing_lows = _find_swing_points(
            h_window, l_window, order=swing_order
        )

        if len(swing_highs) >= 2:
            recent_h = swing_highs[-4:]  # last 4 swings for more data
            hh = sum(1 for j in range(1, len(recent_h))
                     if recent_h[j][1] > recent_h[j - 1][1])
            lh = sum(1 for j in range(1, len(recent_h))
                     if recent_h[j][1] < recent_h[j - 1][1])
            pairs = len(recent_h) - 1
            if pairs > 0:
                if hh / pairs >= 0.5:
                    votes_bull += 1
                if lh / pairs >= 0.5:
                    votes_bear += 1

        if len(swing_lows) >= 2:
            recent_l = swing_lows[-4:]
            hl = sum(1 for j in range(1, len(recent_l))
                     if recent_l[j][1] > recent_l[j - 1][1])
            ll = sum(1 for j in range(1, len(recent_l))
                     if recent_l[j][1] < recent_l[j - 1][1])
            pairs = len(recent_l) - 1
            if pairs > 0:
                if hl / pairs >= 0.5:
                    votes_bull += 1
                if ll / pairs >= 0.5:
                    votes_bear += 1

        # ── Layer 2: EMA Slope (last 10 bars trend) ─────────────────
        if i >= 10:
            ema20_now = ema20.iloc[i]
            ema20_ago = ema20.iloc[i - 10]
            ema50_now = ema50.iloc[i]
            ema50_ago = ema50.iloc[i - 10]

            if ema20_now > ema20_ago and ema50_now > ema50_ago:
                votes_bull += 1
            elif ema20_now < ema20_ago and ema50_now < ema50_ago:
                votes_bear += 1

        # ── Layer 3: Price Position vs EMA ───────────────────────────
        price = close.iloc[i]
        if price > ema20.iloc[i] and price > ema50.iloc[i]:
            votes_bull += 1
        elif price < ema20.iloc[i] and price < ema50.iloc[i]:
            votes_bear += 1

        # ── Final Vote (need ≥2 out of 4 layers) ────────────────────
        if votes_bull >= 2 and votes_bull > votes_bear:
            result.iloc[i] = 1
        elif votes_bear >= 2 and votes_bear > votes_bull:
            result.iloc[i] = -1
        else:
            result.iloc[i] = 0

    return result


# ═══════════════════════════════════════════════════════════════════════
# Smart Money Concepts (SMC) — LuxAlgo-inspired
# ═══════════════════════════════════════════════════════════════════════


def smc_order_blocks(
    open_: pd.Series,
    high: pd.Series,
    low: pd.Series,
    close: pd.Series,
    lookback: int = 10,
) -> pd.Series:
    """Detect bullish/bearish Order Blocks (OB).

    An Order Block is the last opposing candle before an impulsive move:
    - **Bullish OB**: Last bearish candle before a strong bullish impulse.
      Price returning to this zone = institutional demand (buy zone).
    - **Bearish OB**: Last bullish candle before a strong bearish impulse.
      Price returning to this zone = institutional supply (sell zone).

    Returns:
       1 = price is at a bullish OB (buy zone)
      -1 = price is at a bearish OB (sell zone)
       0 = no OB context
    """
    n = len(close)
    result = np.zeros(n, dtype=int)
    o = open_.values
    h = high.values
    l = low.values
    c = close.values

    # Threshold for "impulsive move" — body > 1.5× average body
    body = np.abs(c - o)
    avg_body = pd.Series(body).rolling(20, min_periods=5).mean().values

    for i in range(lookback + 2, n):
        # Detect impulsive bullish candle (big green body)
        if body[i] > 1.5 * avg_body[i] and c[i] > o[i]:
            # Find last bearish candle before this impulse
            for j in range(i - 1, max(i - lookback, 0) - 1, -1):
                if c[j] < o[j]:  # bearish candle = bullish OB
                    ob_top = max(o[j], c[j])
                    ob_bot = min(l[j], min(o[j], c[j]))
                    if ob_bot <= c[i] <= ob_top * 1.005:
                        result[i] = 1
                    break

        # Detect impulsive bearish candle (big red body)
        if body[i] > 1.5 * avg_body[i] and c[i] < o[i]:
            for j in range(i - 1, max(i - lookback, 0) - 1, -1):
                if c[j] > o[j]:  # bullish candle = bearish OB
                    ob_top = max(h[j], max(o[j], c[j]))
                    ob_bot = min(o[j], c[j])
                    if ob_bot * 0.995 <= c[i] <= ob_top:
                        result[i] = -1
                    break

    return pd.Series(result, index=close.index)


def smc_fair_value_gap(
    high: pd.Series,
    low: pd.Series,
    close: pd.Series,
) -> pd.Series:
    """Detect Fair Value Gaps (FVG / imbalance zones).

    An FVG is a 3-candle pattern where there's an un-overlapped gap:
    - **Bullish FVG**: candle[i-2].high < candle[i].low — gap up unfilled.
      Price returning to fill the gap = buy opportunity.
    - **Bearish FVG**: candle[i-2].low > candle[i].high — gap down unfilled.
      Price returning to fill the gap = sell opportunity.

    Returns:
       1 = price is in/near a bullish FVG zone (potential buy)
      -1 = price is in/near a bearish FVG zone (potential sell)
       0 = no FVG context
    """
    n = len(close)
    result = np.zeros(n, dtype=int)
    h = high.values
    l = low.values
    c = close.values

    bull_fvgs: list[tuple[float, float, int]] = []  # (bottom, top, bar_idx)
    bear_fvgs: list[tuple[float, float, int]] = []
    max_age = 50  # FVGs expire after 50 bars

    for i in range(2, n):
        # Detect new bullish FVG: candle[i-2].high < candle[i].low
        if h[i - 2] < l[i]:
            bull_fvgs.append((h[i - 2], l[i], i))

        # Detect new bearish FVG: candle[i-2].low > candle[i].high
        if l[i - 2] > h[i]:
            bear_fvgs.append((h[i], l[i - 2], i))

        # Check if price is in any active bullish FVG
        remaining_bull: list[tuple[float, float, int]] = []
        for bot, top, created in bull_fvgs:
            if i - created > max_age:
                continue
            remaining_bull.append((bot, top, created))
            if bot <= c[i] <= top:
                result[i] = 1
        bull_fvgs = remaining_bull

        # Check if price is in any active bearish FVG
        remaining_bear: list[tuple[float, float, int]] = []
        for bot, top, created in bear_fvgs:
            if i - created > max_age:
                continue
            remaining_bear.append((bot, top, created))
            if bot <= c[i] <= top:
                result[i] = -1
        bear_fvgs = remaining_bear

    return pd.Series(result, index=close.index)


def smc_break_of_structure(
    high: pd.Series,
    low: pd.Series,
    close: pd.Series,
    swing_order: int = 3,
    persist_bars: int = 60,
) -> pd.Series:
    """Detect Break of Structure (BOS) — the core SMC concept.

    - **Bullish BOS**: Price breaks above a recent swing high,
      confirming continuation of the uptrend (Higher High formed).
    - **Bearish BOS**: Price breaks below a recent swing low,
      confirming continuation of the downtrend (Lower Low formed).

    Signal persists for *persist_bars* after the break (default 60 = ~5 hours on 5m).

    Returns:
       1 = recent bullish BOS (upside break — favor longs)
      -1 = recent bearish BOS (downside break — favor shorts)
       0 = no recent BOS
    """
    n = len(close)
    c = close.values

    swing_highs, swing_lows = _find_swing_points(high, low, order=swing_order)

    # For each bar, track the last confirmed swing high/low
    sh_prices = [sh[1] for sh in swing_highs]
    sh_bars = [sh[0] for sh in swing_highs]
    sl_prices = [sl[1] for sl in swing_lows]
    sl_bars = [sl[0] for sl in swing_lows]

    result = np.zeros(n, dtype=int)
    last_bos_bar = -persist_bars - 1
    last_bos_dir = 0
    sh_ptr = 0
    sl_ptr = 0
    cur_sh: float | None = None
    cur_sl: float | None = None

    for i in range(swing_order, n):
        # Advance to latest confirmed swing (lagged by swing_order)
        while sh_ptr < len(sh_bars) and sh_bars[sh_ptr] <= i - swing_order:
            cur_sh = sh_prices[sh_ptr]
            sh_ptr += 1
        while sl_ptr < len(sl_bars) and sl_bars[sl_ptr] <= i - swing_order:
            cur_sl = sl_prices[sl_ptr]
            sl_ptr += 1

        # Bullish BOS: close breaks above last swing high
        if cur_sh is not None and c[i] > cur_sh:
            last_bos_bar = i
            last_bos_dir = 1

        # Bearish BOS: close breaks below last swing low
        if cur_sl is not None and c[i] < cur_sl:
            last_bos_bar = i
            last_bos_dir = -1

        # Persist BOS signal
        if i - last_bos_bar <= persist_bars:
            result[i] = last_bos_dir

    return pd.Series(result, index=close.index)


# ═══════════════════════════════════════════════════════════════════════
# HalfTrend
# ═══════════════════════════════════════════════════════════════════════

def halftrend(
    high: pd.Series,
    low: pd.Series,
    close: pd.Series,
    amplitude: int = 5,
    channel_deviation: float = 2.0,
    atr_length: int = 100,
) -> tuple[pd.Series, pd.Series]:
    """Return (ht_line, ht_dir).

    ht_dir: 0 = uptrend (bullish), 1 = downtrend (bearish).
    Same algorithm as US stock / KLSE HalfTrend (Pine Script port).
    """
    highs = high.values
    lows = low.values
    closes = close.values
    n = len(closes)

    # ATR via RMA (Wilder's smoothing)
    prev_c = np.empty(n, dtype=np.float64)
    prev_c[0] = closes[0]
    prev_c[1:] = closes[:-1]
    tr = np.maximum(highs - lows, np.maximum(np.abs(highs - prev_c), np.abs(lows - prev_c)))
    atr_arr = np.full(n, np.nan, dtype=np.float64)
    atr_arr[0] = tr[0]
    alpha = 1.0 / atr_length
    for i in range(1, n):
        atr_arr[i] = alpha * tr[i] + (1 - alpha) * atr_arr[i - 1]

    trend_arr = np.zeros(n, dtype=np.int8)
    ht_arr = np.full(n, np.nan, dtype=np.float64)

    next_trend = 0
    max_low = lows[0]
    min_high = highs[0]
    up_val = lows[0]
    down_val = highs[0]
    ht_arr[0] = up_val

    for i in range(1, n):
        start = max(0, i - amplitude + 1)
        high_price = highs[start: i + 1].max()
        low_price = lows[start: i + 1].min()
        high_ma = highs[start: i + 1].mean()
        low_ma = lows[start: i + 1].mean()

        cur_trend = trend_arr[i - 1]

        if next_trend == 1:
            max_low = max(low_price, max_low)
            if high_ma < max_low and closes[i] < lows[i - 1]:
                cur_trend = 1
                next_trend = 0
                min_high = high_price
        else:
            min_high = min(high_price, min_high)
            if low_ma > min_high and closes[i] > highs[i - 1]:
                cur_trend = 0
                next_trend = 1
                max_low = low_price

        trend_arr[i] = cur_trend

        if cur_trend == 0:  # uptrend
            if trend_arr[i - 1] != 0:
                up_val = down_val if not math.isnan(down_val) else max_low
            else:
                up_val = max(max_low, up_val)
            ht_arr[i] = up_val
        else:  # downtrend
            if trend_arr[i - 1] != 1:
                down_val = up_val if not math.isnan(up_val) else min_high
            else:
                down_val = min(min_high, down_val)
            ht_arr[i] = down_val

    return (
        pd.Series(ht_arr, index=close.index, name="ht_line"),
        pd.Series(trend_arr, index=close.index, name="ht_dir"),
    )
