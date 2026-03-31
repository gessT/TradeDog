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


def scan_5min_all(
    df: pd.DataFrame,
    params: dict | None = None,
    lookback: int = 10,
) -> list[ScanResult5Min]:
    """Scan the last *lookback* completed bars and return ALL signals found.

    Parameters
    ----------
    df : DataFrame with OHLCV data (at least 100 bars of 5min data)
    params : strategy parameter overrides
    lookback : how many recent completed bars to check (default 10)

    Returns
    -------
    List of ScanResult5Min for every bar that produced a signal, newest first.
    """
    p = {**DEFAULT_5MIN_PARAMS, **(params or {})}
    strategy = MGCStrategy5Min(p)

    df_ind = strategy.compute_indicators(
        df[["open", "high", "low", "close", "volume"]].copy()
    )
    signals = strategy.generate_signals(df_ind)

    vol_ma = df_ind["volume"].rolling(p["vol_period"]).mean()

    results: list[ScanResult5Min] = []

    # Check last `lookback` completed bars (skip the current incomplete bar at -1)
    start_idx = max(0, len(df_ind) - 1 - lookback)
    end_idx = len(df_ind) - 1  # exclusive — skip the live bar

    for i in range(end_idx - 1, start_idx - 1, -1):
        sig_val = int(signals.iloc[i])
        if sig_val == 0:
            continue

        bar = df_ind.iloc[i]
        current_price = float(bar["close"])
        bar_time = str(df_ind.index[i])

        if sig_val == 1:
            direction = "CALL"
            signal_type = "BREAKOUT" if int(bar.get("breakout", 0)) == 1 else "PULLBACK"
        else:
            direction = "PUT"
            signal_type = "BREAKOUT" if int(bar.get("breakout_low", 0)) == 1 else "PULLBACK"

        atr_val = _safe_float(bar.get("atr", 0))
        rsi_val = _safe_float(bar.get("rsi", 50))
        ema_f = _safe_float(bar.get("ema_fast", 0))
        ema_s = _safe_float(bar.get("ema_slow", 0))
        macd_h = _safe_float(bar.get("macd_hist", 0))
        st_dir = int(bar.get("st_dir", 0))

        vol_ratio = float(bar["volume"] / vol_ma.iloc[i]) if vol_ma.iloc[i] > 0 else 1.0

        entry_price = current_price
        if direction == "PUT":
            sl_price = entry_price + p["atr_sl_mult"] * atr_val
            tp_price = entry_price - p["atr_tp_mult"] * atr_val
        else:
            sl_price = entry_price - p["atr_sl_mult"] * atr_val
            tp_price = entry_price + p["atr_tp_mult"] * atr_val
        rr = abs(tp_price - entry_price) / abs(entry_price - sl_price) if abs(entry_price - sl_price) > 0 else 0

        # ── Strength scoring (same logic as scan_5min) ────────
        score = 0
        detail: dict = {}

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

        if 40 <= rsi_val <= 60:
            rsi_pts = 2
        elif 30 <= rsi_val < 40 or 60 < rsi_val <= 70:
            rsi_pts = 1
        else:
            rsi_pts = 0
        score += rsi_pts
        detail["rsi"] = {"pts": rsi_pts, "value": round(rsi_val, 1)}

        macd_aligned = (direction == "CALL" and macd_h > 0) or (direction == "PUT" and macd_h < 0)
        if macd_aligned:
            macd_pts = 2 if abs(macd_h) > atr_val * 0.1 else 1
        else:
            macd_pts = 0
        score += macd_pts
        detail["macd"] = {"pts": macd_pts, "hist": round(macd_h, 4)}

        st_aligned = (direction == "CALL" and st_dir == 1) or (direction == "PUT" and st_dir == -1)
        st_pts = 2 if st_aligned else 0
        score += st_pts
        detail["supertrend"] = {"pts": st_pts, "dir": st_dir}

        if vol_ratio >= 2.0:
            vol_pts = 2
        elif vol_ratio >= 1.3:
            vol_pts = 1
        else:
            vol_pts = 0
        score += vol_pts
        detail["volume"] = {"pts": vol_pts, "ratio": round(vol_ratio, 2)}

        strength = max(1, min(10, score))

        results.append(ScanResult5Min(
            found=True,
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
        ))

    return results


def _safe_float(v, default: float = 0.0) -> float:
    try:
        f = float(v)
        return f if not math.isnan(f) else default
    except (TypeError, ValueError):
        return default


# ═══════════════════════════════════════════════════════════════════════
# Per-condition scan (returns which conditions are met on the last bar)
# ═══════════════════════════════════════════════════════════════════════

@dataclass
class ConditionStatus:
    """Status of each individual entry condition on the last completed bar."""
    # Core conditions
    ema_trend: bool       # EMA fast > slow (CALL) or < (PUT)
    ema_slope: bool       # EMA fast rising (CALL) or falling (PUT)
    pullback: bool        # price pulled back to EMA
    breakout: bool        # breakout above/below recent high/low
    supertrend: bool      # supertrend aligned with direction
    macd_momentum: bool   # MACD histogram aligned
    rsi_momentum: bool    # RSI rising/falling in zone
    volume_spike: bool    # volume above threshold
    # Filters
    atr_range: bool       # ATR sufficient (not flat market)
    session_ok: bool      # within trading session hours
    adx_ok: bool          # ADX above minimum (trend strength)
    # Higher timeframe confirmations
    htf_15m_trend: bool   # 15m EMA trend aligned
    htf_15m_supertrend: bool  # 15m supertrend aligned
    htf_1h_trend: bool    # 1h EMA trend aligned
    htf_1h_supertrend: bool   # 1h supertrend aligned


@dataclass
class MTFScanResult:
    """Extended scan result including per-condition status and MTF confirmation."""
    scan: ScanResult5Min
    conditions: ConditionStatus
    # Which direction to evaluate (even if not all conditions met)
    bias: str             # "CALL" / "PUT" / "NEUTRAL"
    conditions_met: int   # how many of the core conditions are met
    conditions_total: int # total core conditions checked


def scan_5min_mtf(
    df_5m: pd.DataFrame,
    df_15m: pd.DataFrame | None = None,
    df_1h: pd.DataFrame | None = None,
    params: dict | None = None,
) -> MTFScanResult:
    """Scan with multi-timeframe confirmation.

    Computes all indicators on the 5m bar, then checks 15m and 1h for
    trend + supertrend alignment.
    """
    p = {**DEFAULT_5MIN_PARAMS, **(params or {})}
    strategy = MGCStrategy5Min(p)

    # ── 5m indicators ──────────────────────────────────────
    df_ind = strategy.compute_indicators(
        df_5m[["open", "high", "low", "close", "volume"]].copy()
    )
    bar_idx = -2 if len(df_ind) >= 2 else -1
    bar = df_ind.iloc[bar_idx]

    # Determine market bias from EMA + Supertrend
    ema_f = _safe_float(bar.get("ema_fast", 0))
    ema_s = _safe_float(bar.get("ema_slow", 0))
    st_dir = int(bar.get("st_dir", 0))
    if ema_f > ema_s and st_dir == 1:
        bias = "CALL"
    elif ema_f < ema_s and st_dir == -1:
        bias = "PUT"
    else:
        bias = "NEUTRAL"

    # ── Per-condition status on 5m ─────────────────────────
    is_call = bias == "CALL"

    cond = ConditionStatus(
        ema_trend=(ema_f > ema_s) if is_call else (ema_f < ema_s),
        ema_slope=bool(bar.get("ema_slope", 0) == 1) if is_call else bool(bar.get("ema_slope_falling", 0) == 1),
        pullback=bool(bar.get("pullback", 0) == 1),
        breakout=bool(bar.get("breakout", 0) == 1) if is_call else bool(bar.get("breakout_low", 0) == 1),
        supertrend=(st_dir == 1) if is_call else (st_dir == -1),
        macd_momentum=bool(bar.get("macd_mom", 0) == 1) if is_call else bool(bar.get("macd_mom_bear", 0) == 1),
        rsi_momentum=bool(bar.get("rsi_rising", 0) == 1) if is_call else bool(bar.get("rsi_falling", 0) == 1),
        volume_spike=bool(bar.get("vol_spike", 0) == 1),
        atr_range=bool(bar.get("atr_ok", 0) == 1),
        session_ok=bool(bar.get("in_session", 1) == 1),
        adx_ok=bool(_safe_float(bar.get("adx", 0)) >= p.get("adx_min", 0)),
        htf_15m_trend=False,
        htf_15m_supertrend=False,
        htf_1h_trend=False,
        htf_1h_supertrend=False,
    )

    # ── 15m higher timeframe confirmation ──────────────────
    if df_15m is not None and len(df_15m) >= 50:
        _check_htf(df_15m, p, bias, cond, "15m")

    # ── 1h higher timeframe confirmation ───────────────────
    if df_1h is not None and len(df_1h) >= 50:
        _check_htf(df_1h, p, bias, cond, "1h")

    # Count core conditions met
    core = [cond.ema_trend, cond.ema_slope, cond.pullback or cond.breakout,
            cond.supertrend, cond.macd_momentum or cond.rsi_momentum,
            cond.volume_spike, cond.atr_range, cond.session_ok]
    conditions_met = sum(core)

    # Normal scan for the full signal result
    scan_result = scan_5min(df_5m, params)

    return MTFScanResult(
        scan=scan_result,
        conditions=cond,
        bias=bias,
        conditions_met=conditions_met,
        conditions_total=len(core),
    )


def _check_htf(
    df_htf: pd.DataFrame,
    params: dict,
    bias: str,
    cond: ConditionStatus,
    tf: str,
) -> None:
    """Check higher timeframe EMA trend + supertrend alignment."""
    c = df_htf["close"]
    h = df_htf["high"]
    lo = df_htf["low"]

    ema_f = ind.ema(c, params["ema_fast"])
    ema_s = ind.ema(c, params["ema_slow"])
    _, st_dir = ind.supertrend(h, lo, c, params["st_period"], params["st_mult"])

    last_ema_f = _safe_float(ema_f.iloc[-1])
    last_ema_s = _safe_float(ema_s.iloc[-1])
    last_st = int(st_dir.iloc[-1])

    if bias == "CALL":
        trend_ok = last_ema_f > last_ema_s
        st_ok = last_st == 1
    elif bias == "PUT":
        trend_ok = last_ema_f < last_ema_s
        st_ok = last_st == -1
    else:
        trend_ok = False
        st_ok = False

    if tf == "15m":
        cond.htf_15m_trend = trend_ok
        cond.htf_15m_supertrend = st_ok
    elif tf == "1h":
        cond.htf_1h_trend = trend_ok
        cond.htf_1h_supertrend = st_ok
