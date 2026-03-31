"""
Scanner V2 — Real-time signal detector using Strategy V2
==========================================================
• Scans latest completed bars for high-probability long entries
• Returns signal with indicator snapshot + strength score
• Compatible with both yfinance and Tiger live data
"""
from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np
import pandas as pd

from .strategy_v2 import StrategyV2, DEFAULT_V2_PARAMS
from . import indicators as ind


@dataclass
class ScanResultV2:
    """Result from a V2 market scan."""
    found: bool
    entry_price: float
    stop_loss: float
    take_profit: float
    risk_reward: float
    strength: int           # 1–10
    strength_detail: dict   # breakdown by category
    bar_time: str
    # Indicator snapshot
    rsi: float
    atr: float
    ema20: float
    ema50: float
    ema200: float
    ema_align: str          # "bullish" / "bearish" / "mixed"
    ht_dir: str             # "UP" / "DOWN" / "FLIP_UP" / "FLIP_DOWN"
    st_dir: int             # 1 = bullish, -1 = bearish
    macd_hist: float
    vol_ratio: float
    vol_breakout: bool      # volume > 2x average
    candle_body_pct: float


def scan_v2(
    df: pd.DataFrame,
    params: dict | None = None,
) -> ScanResultV2:
    """Scan the latest completed bar for a V2 entry signal."""
    p = {**DEFAULT_V2_PARAMS, **(params or {})}
    strategy = StrategyV2(p)

    df_ind = strategy.compute_indicators(
        df[["open", "high", "low", "close", "volume"]].copy()
    )
    signals = strategy.generate_signals(df_ind)

    bar_idx = -2 if len(df_ind) >= 2 else -1
    bar = df_ind.iloc[bar_idx]
    current_price = float(df_ind["close"].iloc[-1])
    bar_time = str(df_ind.index[bar_idx])

    has_signal = int(signals.iloc[bar_idx]) == 1

    # Indicator values
    atr_val = _sf(bar.get("atr", 0))
    rsi_val = _sf(bar.get("rsi", 50))
    e20 = _sf(bar.get("ema20", 0))
    e50 = _sf(bar.get("ema50", 0))
    e200 = _sf(bar.get("ema200", 0))
    macd_h = _sf(bar.get("macd_hist", 0))
    st = int(bar.get("st_dir", 0))
    vr = _sf(bar.get("vol_ratio", 1))
    ht = int(bar.get("ht_trend", 1))
    cbp = _sf(bar.get("candle_body_pct", 0))

    # HalfTrend direction with flip detection
    if bar_idx > -len(df_ind):
        prev_ht = int(df_ind.iloc[bar_idx - 1].get("ht_trend", 1))
    else:
        prev_ht = ht
    if prev_ht == 1 and ht == 0:
        ht_dir = "FLIP_UP"
    elif prev_ht == 0 and ht == 1:
        ht_dir = "FLIP_DOWN"
    elif ht == 0:
        ht_dir = "UP"
    else:
        ht_dir = "DOWN"

    # EMA alignment
    if e20 > e50 > e200 and e200 > 0:
        ema_align = "bullish"
    elif e20 < e50 < e200:
        ema_align = "bearish"
    else:
        ema_align = "mixed"

    # Entry / SL / TP
    entry_price = current_price
    sl_price = entry_price - p["atr_sl_mult"] * atr_val
    tp_price = entry_price + p["atr_tp_mult"] * atr_val
    rr = abs(tp_price - entry_price) / abs(entry_price - sl_price) if abs(entry_price - sl_price) > 0 else 0

    # ── Strength scoring (1–10) ─────────────────────────────────
    score = 0
    detail: dict = {}

    # 1. EMA alignment (0–3)
    if ema_align == "bullish":
        gap20_50 = abs(e20 - e50) / max(e50, 1e-10) * 100
        ema_pts = 2 + (1 if gap20_50 > 0.5 else 0)
    else:
        ema_pts = 0
    score += ema_pts
    detail["ema"] = {"pts": ema_pts, "align": ema_align}

    # 2. HalfTrend (0–2)
    if ht_dir in ("FLIP_UP", "UP"):
        ht_pts = 2 if ht_dir == "FLIP_UP" else 1
    else:
        ht_pts = 0
    score += ht_pts
    detail["halftrend"] = {"pts": ht_pts, "dir": ht_dir}

    # 3. Supertrend (0–1)
    st_pts = 1 if st == 1 else 0
    score += st_pts
    detail["supertrend"] = {"pts": st_pts, "dir": st}

    # 4. RSI zone (0–2)
    if 45 <= rsi_val <= 65:
        rsi_pts = 2
    elif 35 <= rsi_val < 45 or 65 < rsi_val <= 70:
        rsi_pts = 1
    else:
        rsi_pts = 0
    score += rsi_pts
    detail["rsi"] = {"pts": rsi_pts, "value": round(rsi_val, 1)}

    # 5. Volume (0–2)
    if vr >= 2.0:
        vol_pts = 2
    elif vr >= 1.2:
        vol_pts = 1
    else:
        vol_pts = 0
    score += vol_pts
    detail["volume"] = {"pts": vol_pts, "ratio": round(vr, 2)}

    strength = max(1, min(10, score))

    return ScanResultV2(
        found=has_signal,
        entry_price=round(entry_price, 2),
        stop_loss=round(sl_price, 2),
        take_profit=round(tp_price, 2),
        risk_reward=round(rr, 2),
        strength=strength,
        strength_detail=detail,
        bar_time=bar_time,
        rsi=round(rsi_val, 1),
        atr=round(atr_val, 2),
        ema20=round(e20, 2),
        ema50=round(e50, 2),
        ema200=round(e200, 2),
        ema_align=ema_align,
        ht_dir=ht_dir,
        st_dir=st,
        macd_hist=round(macd_h, 4),
        vol_ratio=round(vr, 2),
        vol_breakout=vr >= 2.0,
        candle_body_pct=round(cbp, 2),
    )


def scan_v2_all(
    df: pd.DataFrame,
    params: dict | None = None,
    lookback: int = 10,
) -> list[ScanResultV2]:
    """Scan last *lookback* completed bars, return all signals (newest first)."""
    p = {**DEFAULT_V2_PARAMS, **(params or {})}
    strategy = StrategyV2(p)

    df_ind = strategy.compute_indicators(
        df[["open", "high", "low", "close", "volume"]].copy()
    )
    signals = strategy.generate_signals(df_ind)

    results: list[ScanResultV2] = []

    start_idx = max(0, len(df_ind) - 1 - lookback)
    end_idx = len(df_ind) - 1

    for i in range(end_idx - 1, start_idx - 1, -1):
        if int(signals.iloc[i]) != 1:
            continue

        bar = df_ind.iloc[i]
        price = float(bar["close"])
        bar_time = str(df_ind.index[i])

        atr_val = _sf(bar.get("atr", 0))
        rsi_val = _sf(bar.get("rsi", 50))
        e20 = _sf(bar.get("ema20", 0))
        e50 = _sf(bar.get("ema50", 0))
        e200 = _sf(bar.get("ema200", 0))
        macd_h = _sf(bar.get("macd_hist", 0))
        st = int(bar.get("st_dir", 0))
        vr = _sf(bar.get("vol_ratio", 1))
        ht = int(bar.get("ht_trend", 1))
        cbp = _sf(bar.get("candle_body_pct", 0))

        prev_ht = int(df_ind.iloc[i - 1].get("ht_trend", 1)) if i > 0 else ht
        if prev_ht == 1 and ht == 0:
            ht_dir = "FLIP_UP"
        elif prev_ht == 0 and ht == 1:
            ht_dir = "FLIP_DOWN"
        elif ht == 0:
            ht_dir = "UP"
        else:
            ht_dir = "DOWN"

        ema_align = "bullish" if e20 > e50 > e200 and e200 > 0 else ("bearish" if e20 < e50 < e200 else "mixed")

        sl_price = price - p["atr_sl_mult"] * atr_val
        tp_price = price + p["atr_tp_mult"] * atr_val
        rr = abs(tp_price - price) / abs(price - sl_price) if abs(price - sl_price) > 0 else 0

        # Strength scoring
        score = 0
        detail: dict = {}

        if ema_align == "bullish":
            gap = abs(e20 - e50) / max(e50, 1e-10) * 100
            ep = 2 + (1 if gap > 0.5 else 0)
        else:
            ep = 0
        score += ep
        detail["ema"] = {"pts": ep, "align": ema_align}

        hp = 2 if ht_dir == "FLIP_UP" else (1 if ht_dir == "UP" else 0)
        score += hp
        detail["halftrend"] = {"pts": hp, "dir": ht_dir}

        sp = 1 if st == 1 else 0
        score += sp
        detail["supertrend"] = {"pts": sp, "dir": st}

        rp = 2 if 45 <= rsi_val <= 65 else (1 if 35 <= rsi_val <= 70 else 0)
        score += rp
        detail["rsi"] = {"pts": rp, "value": round(rsi_val, 1)}

        vp = 2 if vr >= 2.0 else (1 if vr >= 1.2 else 0)
        score += vp
        detail["volume"] = {"pts": vp, "ratio": round(vr, 2)}

        results.append(ScanResultV2(
            found=True,
            entry_price=round(price, 2),
            stop_loss=round(sl_price, 2),
            take_profit=round(tp_price, 2),
            risk_reward=round(rr, 2),
            strength=max(1, min(10, score)),
            strength_detail=detail,
            bar_time=bar_time,
            rsi=round(rsi_val, 1),
            atr=round(atr_val, 2),
            ema20=round(e20, 2),
            ema50=round(e50, 2),
            ema200=round(e200, 2),
            ema_align=ema_align,
            ht_dir=ht_dir,
            st_dir=st,
            macd_hist=round(macd_h, 4),
            vol_ratio=round(vr, 2),
            vol_breakout=vr >= 2.0,
            candle_body_pct=round(cbp, 2),
        ))

    return results


def _sf(v, default: float = 0.0) -> float:
    """Safe float conversion."""
    try:
        f = float(v)
        return f if not math.isnan(f) else default
    except (TypeError, ValueError):
        return default
