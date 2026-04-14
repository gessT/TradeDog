"""
VPR Indicators — VWAP, Volume Profile, RSI
=============================================
Strict: only these three indicators are computed.
All functions are pure (no side effects) and non-repainting.
"""
from __future__ import annotations

import numpy as np
import pandas as pd


# ═══════════════════════════════════════════════════════════════════════
# RSI
# ═══════════════════════════════════════════════════════════════════════

def rsi(close: pd.Series, period: int = 14) -> pd.Series:
    """Wilder's RSI — standard non-repainting computation."""
    delta = close.diff()
    gain = delta.clip(lower=0)
    loss = -delta.clip(upper=0)
    avg_gain = gain.ewm(alpha=1 / period, min_periods=period, adjust=False).mean()
    avg_loss = loss.ewm(alpha=1 / period, min_periods=period, adjust=False).mean()
    rs = avg_gain / avg_loss.replace(0, 1e-10)
    return 100 - (100 / (1 + rs))


# ═══════════════════════════════════════════════════════════════════════
# ATR
# ═══════════════════════════════════════════════════════════════════════

def atr(high: pd.Series, low: pd.Series, close: pd.Series, period: int = 14) -> pd.Series:
    """Average True Range."""
    tr1 = high - low
    tr2 = (high - close.shift(1)).abs()
    tr3 = (low - close.shift(1)).abs()
    tr = pd.concat([tr1, tr2, tr3], axis=1).max(axis=1)
    return tr.ewm(span=period, adjust=False).mean()


# ═══════════════════════════════════════════════════════════════════════
# Session VWAP
# ═══════════════════════════════════════════════════════════════════════

def session_vwap(df: pd.DataFrame) -> pd.Series:
    """Compute session VWAP that resets each calendar date.

    Requires columns: high, low, close, volume and a DatetimeIndex.
    Typical price = (H + L + C) / 3.
    """
    typical = (df["high"] + df["low"] + df["close"]) / 3
    pv = typical * df["volume"]

    # Group by calendar date to reset each session
    dates = df.index.date
    cum_pv = pv.groupby(dates).cumsum()
    cum_vol = df["volume"].groupby(dates).cumsum()

    vwap = cum_pv / cum_vol.replace(0, np.nan)
    return vwap.ffill()


# ═══════════════════════════════════════════════════════════════════════
# Volume Profile — POC & HVN detection
# ═══════════════════════════════════════════════════════════════════════

def _build_volume_profile(
    high: np.ndarray,
    low: np.ndarray,
    close: np.ndarray,
    volume: np.ndarray,
    bin_count: int = 50,
) -> tuple[np.ndarray, np.ndarray]:
    """Build a volume profile over the given window.

    Returns (bin_edges, bin_volumes) where bin_volumes[i] is
    the total volume traded in price range [bin_edges[i], bin_edges[i+1]).
    """
    price_min = float(low.min())
    price_max = float(high.max())
    if price_max <= price_min:
        price_max = price_min + 0.01

    bin_edges = np.linspace(price_min, price_max, bin_count + 1)
    bin_vols = np.zeros(bin_count)

    # Distribute each bar's volume across bins its range touches
    for i in range(len(close)):
        bar_lo = low[i]
        bar_hi = high[i]
        bar_vol = volume[i]
        if bar_vol <= 0 or np.isnan(bar_vol):
            continue

        # Find bins this bar spans
        lo_idx = max(0, np.searchsorted(bin_edges, bar_lo, side="right") - 1)
        hi_idx = min(bin_count - 1, np.searchsorted(bin_edges, bar_hi, side="right") - 1)

        span = hi_idx - lo_idx + 1
        if span <= 0:
            span = 1
            hi_idx = lo_idx

        per_bin = bar_vol / span
        for b in range(lo_idx, hi_idx + 1):
            bin_vols[b] += per_bin

    return bin_edges, bin_vols


def volume_profile_levels(
    df: pd.DataFrame,
    lookback: int = 100,
    bin_count: int = 50,
    hvn_percentile: int = 70,
) -> tuple[pd.Series, pd.Series]:
    """Compute per-bar POC price and HVN flag (price near any HVN).

    Returns:
        poc_series: price level of the Point of Control for each bar
        hvn_prices_series: list of HVN price levels for each bar
    """
    n = len(df)
    poc_arr = np.full(n, np.nan)
    hvn_list: list[list[float]] = [[] for _ in range(n)]

    h = df["high"].values
    lo = df["low"].values
    c = df["close"].values
    v = df["volume"].values

    for i in range(lookback, n):
        start = i - lookback
        window_h = h[start:i]
        window_l = lo[start:i]
        window_c = c[start:i]
        window_v = v[start:i]

        edges, vols = _build_volume_profile(window_h, window_l, window_c, window_v, bin_count)

        # POC = bin with max volume
        poc_idx = int(np.argmax(vols))
        poc_price = (edges[poc_idx] + edges[poc_idx + 1]) / 2
        poc_arr[i] = poc_price

        # HVN = bins above percentile threshold
        if vols.max() > 0:
            thresh = np.percentile(vols[vols > 0], hvn_percentile)
            hvn_bins = np.where(vols >= thresh)[0]
            hvn_prices = [(edges[b] + edges[b + 1]) / 2 for b in hvn_bins]
            hvn_list[i] = hvn_prices

    poc_series = pd.Series(poc_arr, index=df.index, name="poc")
    return poc_series, hvn_list


def price_near_level(
    price: float, level: float, tolerance: float
) -> bool:
    """True if price is within tolerance of level."""
    return abs(price - level) <= tolerance


def price_near_any_hvn(
    price: float, hvn_prices: list[float], tolerance: float
) -> bool:
    """True if price is within tolerance of any HVN level."""
    for lvl in hvn_prices:
        if abs(price - lvl) <= tolerance:
            return True
    return False
