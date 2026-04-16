"""
strategy.py — PrecSniper (Precision Sniper) Strategy for Bursa Malaysia.

Port of the TradingView "Precision Sniper [WillyAlgoTrader]" indicator
to a Python backtesting framework.  KLSE daily bars, long-only.

Core logic:
  • Three EMAs: fast / slow / trend  (crossover + trend gate)
  • Confluence scoring engine (10 pts max):
      1. EMA fast > EMA slow            → 1.0 pt
      2. Close > EMA trend              → 1.0
      3. RSI in sweet zone (>50, <75)   → 1.0
      4. MACD histogram > 0             → 1.0
      5. MACD line > signal line        → 1.0
      6. Close > VWAP (rolling 20-bar)  → 1.0
      7. Volume > 1.2× avg             → 1.0
      8. ADX > 20 and DI+ > DI-        → 1.0
      9. Weekly HTF bias bullish        → 1.5
     10. Close > EMA fast               → 0.5
  • Entry: EMA bull cross + price > both EMAs + RSI < 75 + score ≥ min
  • Exit:  SL (structure swing low or ATR) / TP1 / TP2 / TP3 / trailing
  • Presets: Conservative / Default / Aggressive / Swing / Custom
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from strategies.klse.hpb.indicators import ema, rsi, atr, sma, avg_volume

# ═══════════════════════════════════════════════════════════════
# Presets — matching Pine Script presets (for daily = Swing)
# ═══════════════════════════════════════════════════════════════

PRESETS: dict[str, dict] = {
    "conservative": dict(ema_fast=12, ema_slow=26, ema_trend=89, rsi_len=14,
                         atr_len=14, min_score=7, sl_atr_mult=2.0),
    "default":      dict(ema_fast=9,  ema_slow=21, ema_trend=55, rsi_len=13,
                         atr_len=14, min_score=5, sl_atr_mult=1.5),
    "aggressive":   dict(ema_fast=8,  ema_slow=18, ema_trend=50, rsi_len=11,
                         atr_len=12, min_score=3, sl_atr_mult=1.2),
    "swing":        dict(ema_fast=13, ema_slow=34, ema_trend=89, rsi_len=21,
                         atr_len=20, min_score=6, sl_atr_mult=2.5),
}

# ═══════════════════════════════════════════════════════════════
# Default parameters — Swing preset tuned for KLSE daily
# ═══════════════════════════════════════════════════════════════

DEFAULT_PARAMS: dict = {
    "preset": "swing",

    # ── EMAs ──
    "ema_fast": 8,
    "ema_slow": 21,
    "ema_trend": 55,

    # ── RSI ──
    "rsi_len": 14,
    "rsi_ob": 75,       # overbought — don't buy above
    "rsi_os": 25,        # oversold   — don't short below
    "rsi_bull_min": 50,  # RSI must be > 50 for bull score

    # ── MACD ──
    "macd_fast": 12,
    "macd_slow": 26,
    "macd_signal": 9,

    # ── ADX/DMI ──
    "adx_len": 14,
    "adx_threshold": 20,

    # ── Volume ──
    "vol_period": 20,
    "vol_mult": 1.2,

    # ── VWAP (rolling) ──
    "vwap_period": 20,

    # ── HTF bias (weekly resampled from daily) ──
    "htf_enabled": True,

    # ── Scoring ──
    "min_score": 6,

    # ── ATR ──
    "atr_len": 20,

    # ── Risk / SL ──
    "sl_atr_mult": 3.5,
    "use_structure_sl": True,
    "swing_lookback": 5,

    # ── TP (R:R multiples) ──
    "tp1_rr": 1.2,
    "tp2_rr": 2.0,
    "tp3_rr": 3.0,

    # ── Simple exit mode (exit entire position at TP1) ──
    "simple_exit": True,

    # ── Trailing stop (used when simple_exit=False) ──
    "use_trailing": True,
    "trail_mode": "tp_step",

    # ── Position sizing ──
    "risk_pct": 5.0,

    # ── Cooldown ──
    "cooldown_bars": 1,
}

VALID_CONDITIONS = {
    "ema_trend", "ema_cross", "rsi_filter", "macd_hist", "macd_cross",
    "vwap_above", "vol_confirm", "adx_trend", "htf_bias", "close_above_fast",
    "sl_exit", "tp_exit", "trail_exit",
}

# ═══════════════════════════════════════════════════════════════
# Indicator helpers (MACD, ADX/DMI, rolling VWAP)
# ═══════════════════════════════════════════════════════════════


def _macd(closes: np.ndarray, fast: int, slow: int, sig: int):
    """MACD line, signal line, histogram."""
    ema_f = ema(closes, fast)
    ema_s = ema(closes, slow)
    macd_line = ema_f - ema_s
    signal_line = ema(macd_line, sig)
    hist = macd_line - signal_line
    return macd_line, signal_line, hist


def _adx_dmi(highs: np.ndarray, lows: np.ndarray, closes: np.ndarray, period: int):
    """ADX, DI+, DI- (Wilder smoothing)."""
    n = len(highs)
    di_plus = np.full(n, np.nan)
    di_minus = np.full(n, np.nan)
    adx_out = np.full(n, np.nan)

    if n < period + 1:
        return adx_out, di_plus, di_minus

    # True Range
    tr = np.empty(n)
    tr[0] = highs[0] - lows[0]
    for i in range(1, n):
        tr[i] = max(highs[i] - lows[i],
                     abs(highs[i] - closes[i - 1]),
                     abs(lows[i] - closes[i - 1]))

    # +DM / -DM
    plus_dm = np.zeros(n)
    minus_dm = np.zeros(n)
    for i in range(1, n):
        up = highs[i] - highs[i - 1]
        down = lows[i - 1] - lows[i]
        if up > down and up > 0:
            plus_dm[i] = up
        if down > up and down > 0:
            minus_dm[i] = down

    # Wilder smoothing
    sm_tr = np.zeros(n, dtype=float)
    sm_pdm = np.zeros(n, dtype=float)
    sm_mdm = np.zeros(n, dtype=float)

    sm_tr[period] = np.sum(tr[1:period + 1])
    sm_pdm[period] = np.sum(plus_dm[1:period + 1])
    sm_mdm[period] = np.sum(minus_dm[1:period + 1])

    for i in range(period + 1, n):
        sm_tr[i] = sm_tr[i - 1] - sm_tr[i - 1] / period + tr[i]
        sm_pdm[i] = sm_pdm[i - 1] - sm_pdm[i - 1] / period + plus_dm[i]
        sm_mdm[i] = sm_mdm[i - 1] - sm_mdm[i - 1] / period + minus_dm[i]

    # DI+, DI-
    for i in range(period, n):
        if sm_tr[i] > 0:
            di_plus[i] = 100.0 * sm_pdm[i] / sm_tr[i]
            di_minus[i] = 100.0 * sm_mdm[i] / sm_tr[i]
        else:
            di_plus[i] = 0.0
            di_minus[i] = 0.0

    # DX → ADX
    dx = np.full(n, np.nan)
    for i in range(period, n):
        s = di_plus[i] + di_minus[i]
        dx[i] = 100.0 * abs(di_plus[i] - di_minus[i]) / s if s > 0 else 0.0

    # First ADX = average of first `period` DX values
    first_valid = period
    adx_start = first_valid + period
    if adx_start < n:
        adx_out[adx_start - 1] = np.nanmean(dx[first_valid:adx_start])
        for i in range(adx_start, n):
            adx_out[i] = (adx_out[i - 1] * (period - 1) + dx[i]) / period

    return adx_out, di_plus, di_minus


def _rolling_vwap(highs: np.ndarray, lows: np.ndarray, closes: np.ndarray,
                  volumes: np.ndarray, period: int) -> np.ndarray:
    """Rolling VWAP over `period` bars (typical_price × volume / cum volume)."""
    n = len(closes)
    tp = (highs + lows + closes) / 3.0
    out = np.full(n, np.nan)
    for i in range(period - 1, n):
        window_tp = tp[i - period + 1: i + 1]
        window_vol = volumes[i - period + 1: i + 1]
        total_vol = np.sum(window_vol)
        if total_vol > 0:
            out[i] = np.sum(window_tp * window_vol) / total_vol
        else:
            out[i] = np.mean(window_tp)
    return out


def _swing_low(lows: np.ndarray, lookback: int) -> np.ndarray:
    """Rolling swing low (min of last `lookback` bars, not including current)."""
    n = len(lows)
    out = np.full(n, np.nan)
    for i in range(lookback, n):
        out[i] = np.min(lows[i - lookback: i])
    return out


def _swing_high(highs: np.ndarray, lookback: int) -> np.ndarray:
    """Rolling swing high (max of last `lookback` bars, not including current)."""
    n = len(highs)
    out = np.full(n, np.nan)
    for i in range(lookback, n):
        out[i] = np.max(highs[i - lookback: i])
    return out


def _weekly_ema_bias(dates: np.ndarray, closes: np.ndarray,
                     ema_fast_len: int, ema_slow_len: int) -> np.ndarray:
    """Compute weekly EMA bias from daily data.

    Returns array aligned to daily bars: +1 bullish, -1 bearish, 0 neutral.
    Uses week-end close (Friday or last bar of each week).
    """
    n = len(closes)
    bias = np.zeros(n, dtype=int)

    # Build weekly close series
    weekly_closes: list[float] = []
    weekly_dates: list[int] = []  # indices into daily array

    if n == 0:
        return bias

    try:
        dts = pd.to_datetime(dates)
    except Exception:
        return bias

    # Group by iso week
    current_week = None
    for i in range(n):
        w = dts[i].isocalendar()[1]
        y = dts[i].year
        key = (y, w)
        if current_week is None or key != current_week:
            if current_week is not None:
                weekly_closes.append(closes[i - 1])
                weekly_dates.append(i - 1)
            current_week = key
    # Last week
    weekly_closes.append(closes[-1])
    weekly_dates.append(n - 1)

    if len(weekly_closes) < max(ema_fast_len, ema_slow_len):
        return bias

    wc = np.array(weekly_closes)
    wf = ema(wc, ema_fast_len)
    ws = ema(wc, ema_slow_len)

    # Map weekly bias back to daily
    for wi in range(len(weekly_closes)):
        if np.isnan(wf[wi]) or np.isnan(ws[wi]):
            continue
        b = 1 if wf[wi] > ws[wi] else (-1 if wf[wi] < ws[wi] else 0)
        start_idx = weekly_dates[wi - 1] + 1 if wi > 0 else 0
        end_idx = weekly_dates[wi] + 1
        bias[start_idx:end_idx] = b

    return bias


# ═══════════════════════════════════════════════════════════════
# Build indicators on DataFrame
# ═══════════════════════════════════════════════════════════════

def build_indicators(df: pd.DataFrame, params: dict) -> pd.DataFrame:
    """Attach all PrecSniper indicators to the DataFrame."""
    p = params
    df = df.copy()

    closes = df["close"].values.astype(float)
    highs = df["high"].values.astype(float)
    lows = df["low"].values.astype(float)
    opens = df["open"].values.astype(float)
    volumes = df["volume"].values.astype(float) if "volume" in df.columns else np.ones(len(df))

    # EMAs
    df["ema_fast"] = ema(closes, p["ema_fast"])
    df["ema_slow"] = ema(closes, p["ema_slow"])
    df["ema_trend"] = ema(closes, p["ema_trend"])

    # RSI
    df["rsi"] = rsi(closes, p["rsi_len"])

    # ATR
    df["atr"] = atr(highs, lows, closes, p["atr_len"])

    # MACD
    macd_line, sig_line, hist = _macd(closes, p["macd_fast"], p["macd_slow"], p["macd_signal"])
    df["macd"] = macd_line
    df["macd_signal"] = sig_line
    df["macd_hist"] = hist

    # ADX / DMI
    adx_arr, di_p, di_m = _adx_dmi(highs, lows, closes, p["adx_len"])
    df["adx"] = adx_arr
    df["di_plus"] = di_p
    df["di_minus"] = di_m

    # Volume average
    df["vol_avg"] = avg_volume(volumes, p["vol_period"])

    # Rolling VWAP
    df["vwap"] = _rolling_vwap(highs, lows, closes, volumes, p["vwap_period"])

    # Swing levels
    df["swing_low"] = _swing_low(lows, p["swing_lookback"])
    df["swing_high"] = _swing_high(highs, p["swing_lookback"])

    # Weekly HTF bias
    if p.get("htf_enabled", True):
        if isinstance(df.index, pd.DatetimeIndex):
            date_arr = df.index.strftime("%Y-%m-%d").values
        elif "date" in df.columns:
            date_arr = df["date"].astype(str).values
        else:
            date_arr = np.arange(len(df)).astype(str)
        df["htf_bias"] = _weekly_ema_bias(date_arr, closes, p["ema_fast"], p["ema_slow"])
    else:
        df["htf_bias"] = 0

    return df


# ═══════════════════════════════════════════════════════════════
# Generate entry signals (confluence scoring + EMA cross trigger)
# ═══════════════════════════════════════════════════════════════

def generate_signals(df: pd.DataFrame, params: dict,
                     disabled: set[str] | None = None) -> np.ndarray:
    """Return boolean array: True where a BUY signal fires."""
    p = params
    dis = disabled or set()
    n = len(df)
    signals = np.zeros(n, dtype=bool)

    closes = df["close"].values.astype(float)
    ema_f = df["ema_fast"].values.astype(float)
    ema_s = df["ema_slow"].values.astype(float)
    ema_t = df["ema_trend"].values.astype(float)
    rsi_arr = df["rsi"].values.astype(float)
    macd_h = df["macd_hist"].values.astype(float)
    macd_l = df["macd"].values.astype(float)
    macd_sig = df["macd_signal"].values.astype(float)
    adx_arr = df["adx"].values.astype(float)
    di_p = df["di_plus"].values.astype(float)
    di_m = df["di_minus"].values.astype(float)
    vol_arr = df["volume"].values.astype(float) if "volume" in df.columns else np.ones(n)
    vol_avg = df["vol_avg"].values.astype(float)
    vwap_arr = df["vwap"].values.astype(float)
    htf_arr = df["htf_bias"].values.astype(int)

    min_score = p["min_score"]
    warmup = max(p["ema_trend"], 50)
    last_dir = 0  # prevent same-direction repeat signals

    for i in range(warmup, n):
        if np.isnan(ema_f[i]) or np.isnan(ema_s[i]) or np.isnan(ema_t[i]):
            continue

        # ── Reset direction on bearish cross (allow new buy later) ──
        bear_cross = (ema_f[i] < ema_s[i]) and (ema_f[i - 1] >= ema_s[i - 1])
        if bear_cross:
            last_dir = 0

        # ── EMA bull cross trigger ──
        cross = (ema_f[i] > ema_s[i]) and (ema_f[i - 1] <= ema_s[i - 1]) if "ema_cross" not in dis else True
        if not cross:
            continue

        # ── Price above both EMAs ──
        if closes[i] <= ema_f[i] or closes[i] <= ema_s[i]:
            continue

        # ── RSI not overbought ──
        if not np.isnan(rsi_arr[i]) and rsi_arr[i] >= p["rsi_ob"]:
            continue

        # ── Confluence score ──
        score = 0.0

        if "ema_trend" not in dis:
            score += 1.0 if ema_f[i] > ema_s[i] else 0.0   # 1
        if "ema_trend" not in dis:
            score += 1.0 if closes[i] > ema_t[i] else 0.0   # 2
        if "rsi_filter" not in dis and not np.isnan(rsi_arr[i]):
            score += 1.0 if rsi_arr[i] > p["rsi_bull_min"] and rsi_arr[i] < p["rsi_ob"] else 0.0  # 3
        if "macd_hist" not in dis and not np.isnan(macd_h[i]):
            score += 1.0 if macd_h[i] > 0 else 0.0          # 4
        if "macd_cross" not in dis and not np.isnan(macd_l[i]):
            score += 1.0 if macd_l[i] > macd_sig[i] else 0.0  # 5
        if "vwap_above" not in dis and not np.isnan(vwap_arr[i]):
            score += 1.0 if closes[i] > vwap_arr[i] else 0.0  # 6
        if "vol_confirm" not in dis and not np.isnan(vol_avg[i]):
            score += 1.0 if vol_arr[i] > vol_avg[i] * p["vol_mult"] else 0.0  # 7
        if "adx_trend" not in dis and not np.isnan(adx_arr[i]):
            score += 1.0 if adx_arr[i] > p["adx_threshold"] and di_p[i] > di_m[i] else 0.0  # 8
        if "htf_bias" not in dis:
            score += 1.5 if htf_arr[i] == 1 else 0.0         # 9
        if "close_above_fast" not in dis:
            score += 0.5 if closes[i] > ema_f[i] else 0.0    # 10

        if score < min_score:
            continue

        # ── Direction filter (no repeat) ──
        if last_dir == 1:
            continue

        signals[i] = True
        last_dir = 1

    return signals
