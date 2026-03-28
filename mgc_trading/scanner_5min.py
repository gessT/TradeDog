"""
5-Minute Scanner — Real-time signal detection for MGC 5min strategy
====================================================================
• Computes all 5min indicators on live/recent data
• Returns: entry YES/NO, entry price, SL, TP, signal strength (1-10)
• Designed for both Tiger live data and yfinance backtest data
"""
from __future__ import annotations

import math
from dataclasses import dataclass

import pandas as pd

from .config import CONTRACT_SIZE
from .strategy_5min import MGCStrategy5Min, DEFAULT_5MIN_PARAMS
from . import indicators as ind
from . import indicators_5min as ind5


@dataclass
class ScanResult5Min:
    """Result from a 5-minute market scan."""
    found: bool
    direction: str          # "CALL" / "PUT" / "NONE"
    signal_type: str        # "PULLBACK" / "BREAKOUT" / "NONE"
    entry_price: float
    stop_loss: float
    take_profit: float
    risk_reward: float
    strength: int           # 1-10
    strength_detail: dict   # breakdown
    # Indicator snapshot
    rsi: float
    atr: float
    ema_fast: float
    ema_slow: float
    macd_hist: float
    supertrend_dir: int     # 1 = bullish, -1 = bearish
    volume_ratio: float
    bar_time: str


def scan_5min(
    df: pd.DataFrame,
    params: dict | None = None,
) -> ScanResult5Min:
    """Scan the latest completed bar for a 5-minute entry signal.

    Parameters
    ----------
    df : DataFrame with OHLCV data (at least 100 bars of 5min data)
    params : strategy parameter overrides

    Returns
    -------
    ScanResult5Min with signal details
    """
    p = {**DEFAULT_5MIN_PARAMS, **(params or {})}
    strategy = MGCStrategy5Min(p)

    df_ind = strategy.compute_indicators(
        df[["open", "high", "low", "close", "volume"]].copy()
    )
    signals = strategy.generate_signals(df_ind)

    # Use second-to-last bar (last completed bar)
    bar_idx = -2 if len(df_ind) >= 2 else -1
    bar = df_ind.iloc[bar_idx]
    current_price = float(df_ind["close"].iloc[-1])
    bar_time = str(df_ind.index[bar_idx])

    sig_val = int(signals.iloc[bar_idx])
    has_signal = sig_val != 0

    # Determine direction and signal type
    if sig_val == 1:
        direction = "CALL"
        if int(bar.get("breakout", 0)) == 1:
            signal_type = "BREAKOUT"
        else:
            signal_type = "PULLBACK"
    elif sig_val == -1:
        direction = "PUT"
        if int(bar.get("breakout_low", 0)) == 1:
            signal_type = "BREAKOUT"
        else:
            signal_type = "PULLBACK"
    else:
        direction = "NONE"
        signal_type = "NONE"

    # Get indicator values
    atr_val = _safe_float(bar.get("atr", 0))
    rsi_val = _safe_float(bar.get("rsi", 50))
    ema_f = _safe_float(bar.get("ema_fast", 0))
    ema_s = _safe_float(bar.get("ema_slow", 0))
    macd_h = _safe_float(bar.get("macd_hist", 0))
    st_dir = int(bar.get("st_dir", 0))

    vol_ma = df_ind["volume"].rolling(p["vol_period"]).mean()
    vol_ratio = float(bar["volume"] / vol_ma.iloc[bar_idx]) if vol_ma.iloc[bar_idx] > 0 else 1.0

    # Entry / SL / TP
    entry_price = current_price
    if direction == "PUT":
        sl_price = entry_price + p["atr_sl_mult"] * atr_val
        tp_price = entry_price - p["atr_tp_mult"] * atr_val
    else:
        sl_price = entry_price - p["atr_sl_mult"] * atr_val
        tp_price = entry_price + p["atr_tp_mult"] * atr_val
    rr = abs(tp_price - entry_price) / abs(entry_price - sl_price) if abs(entry_price - sl_price) > 0 else 0

    # ── Signal strength scoring (1-10) ────────────────────────────
    score = 0
    detail: dict = {}

    # 1. Trend alignment (0-2)
    is_bullish_trend = ema_f > ema_s
    is_bearish_trend = ema_f < ema_s
    trend_aligned = (direction == "CALL" and is_bullish_trend) or (direction == "PUT" and is_bearish_trend)
    if trend_aligned:
        gap_pct = abs(ema_f - ema_s) / max(ema_s, 1e-10) * 100
        trend_pts = min(2, 1 + (1 if gap_pct > 0.15 else 0))
        score += trend_pts
        detail["trend"] = {"pts": trend_pts, "ema_gap_pct": round(gap_pct, 3)}
    else:
        detail["trend"] = {"pts": 0, "note": "against trend"}

    # 2. RSI sweet spot (0-2)
    if 40 <= rsi_val <= 60:
        rsi_pts = 2
    elif 30 <= rsi_val < 40 or 60 < rsi_val <= 70:
        rsi_pts = 1
    else:
        rsi_pts = 0
    score += rsi_pts
    detail["rsi"] = {"pts": rsi_pts, "value": round(rsi_val, 1)}

    # 3. MACD momentum (0-2)
    macd_aligned = (direction == "CALL" and macd_h > 0) or (direction == "PUT" and macd_h < 0)
    if macd_aligned:
        macd_pts = 2 if abs(macd_h) > atr_val * 0.1 else 1
    else:
        macd_pts = 0
    score += macd_pts
    detail["macd"] = {"pts": macd_pts, "hist": round(macd_h, 4)}

    # 4. Supertrend confirmation (0-2)
    st_aligned = (direction == "CALL" and st_dir == 1) or (direction == "PUT" and st_dir == -1)
    st_pts = 2 if st_aligned else 0
    score += st_pts
    detail["supertrend"] = {"pts": st_pts, "dir": st_dir}

    # 5. Volume spike (0-2)
    if vol_ratio >= 2.0:
        vol_pts = 2
    elif vol_ratio >= 1.3:
        vol_pts = 1
    else:
        vol_pts = 0
    score += vol_pts
    detail["volume"] = {"pts": vol_pts, "ratio": round(vol_ratio, 2)}

    strength = max(1, min(10, score))

    return ScanResult5Min(
        found=has_signal,
        direction=direction,
        signal_type=signal_type,
        entry_price=round(entry_price, 2),
        stop_loss=round(sl_price, 2),
        take_profit=round(tp_price, 2),
        risk_reward=round(rr, 2),
        strength=strength,
        strength_detail=detail,
        rsi=round(rsi_val, 1),
        atr=round(atr_val, 2),
        ema_fast=round(ema_f, 2),
        ema_slow=round(ema_s, 2),
        macd_hist=round(macd_h, 4),
        supertrend_dir=st_dir,
        volume_ratio=round(vol_ratio, 2),
        bar_time=bar_time,
    )


def _safe_float(v, default: float = 0.0) -> float:
    try:
        f = float(v)
        return f if not math.isnan(f) else default
    except (TypeError, ValueError):
        return default
