"""
strategy_v2.py — EMA Trend-Pullback + Supertrend + RSI Strategy.

Adapted from strategy_final.py for use in the web platform.

ENTRY MODES:
  A) EMA Bounce: candle low dips below fast EMA, close recovers above
  B) EMA Cross:  close crosses above fast EMA from below
  C) ST Flip:    Supertrend just turned bullish

All modes require: trend (EMA fast > slow), RSI in zone, ATR alive.

EXIT:
  - SL: entry - slk × ATR  (with breakeven trail at +0.5R)
  - TP: entry + tpk × ATR
  - Supertrend flips bearish → exit at close
  - RSI < 33 → exit at close

GRID OPTIMISER included.
"""
from __future__ import annotations

from itertools import product as iproduct

import numpy as np
import pandas as pd


# ═══════════════════════ CONSTANTS ═══════════════════════════════
COMMISSION  = 0.001   # 0.1% per side
SLIPPAGE    = 0.0005  # 0.05% half-spread


# ═══════════════════════ INDICATORS ══════════════════════════════

def _ema(s: pd.Series, n: int) -> pd.Series:
    return s.ewm(span=n, adjust=False).mean()


def _atr(df: pd.DataFrame, n: int = 14) -> pd.Series:
    tr = pd.concat([
        df["high"] - df["low"],
        (df["high"] - df["close"].shift()).abs(),
        (df["low"]  - df["close"].shift()).abs(),
    ], axis=1).max(axis=1)
    return tr.ewm(span=n, adjust=False).mean()


def _rsi(s: pd.Series, n: int = 14) -> pd.Series:
    d = s.diff()
    g = d.clip(lower=0).ewm(alpha=1/n, adjust=False).mean()
    l = (-d.clip(upper=0)).ewm(alpha=1/n, adjust=False).mean()
    return 100 - (100 / (1 + g / l.replace(0, np.nan)))


def _supertrend(df: pd.DataFrame, period: int = 10, mult: float = 3.0):
    a   = _atr(df, period)
    hl2 = (df["high"] + df["low"]) / 2
    ub  = (hl2 + mult * a).values.copy()
    lb  = (hl2 - mult * a).values.copy()
    cl  = df["close"].values
    st  = np.full(len(df), np.nan)
    dr  = np.ones(len(df), dtype=int)
    for i in range(1, len(df)):
        ub[i] = ub[i] if ub[i] < ub[i-1] or cl[i-1] > ub[i-1] else ub[i-1]
        lb[i] = lb[i] if lb[i] > lb[i-1] or cl[i-1] < lb[i-1] else lb[i-1]
        if st[i-1] == ub[i-1]:
            dr[i] = 1 if cl[i] > ub[i] else -1
        else:
            dr[i] = -1 if cl[i] < lb[i] else 1
        st[i] = lb[i] if dr[i] == 1 else ub[i]
    st[0] = lb[0]
    dr[0] = 1
    return pd.Series(st, index=df.index), pd.Series(dr, index=df.index)


def build_indicators(df: pd.DataFrame, ef: int = 20, es: int = 50,
                     st_mult: float = 3.0) -> pd.DataFrame:
    """Compute all indicator columns."""
    d = df.copy()
    d["ema_f"]   = _ema(d["close"], ef)
    d["ema_s"]   = _ema(d["close"], es)
    d["atr"]     = _atr(d)
    d["rsi"]     = _rsi(d["close"])
    d["vol_ma"]  = d["volume"].rolling(20).mean()
    d["st"], d["st_dir"] = _supertrend(d, 10, st_mult)
    return d.dropna()


# ═══════════════════════ SIGNALS ═════════════════════════════════

def generate_signals(df: pd.DataFrame, rlo: int = 38, rhi: int = 80,
                     slk: float = 1.0, tpk: float = 2.0) -> pd.DataFrame:
    """Generate entry signals + SL/TP levels."""
    d = df.copy()
    trend    = d["ema_f"] > d["ema_s"]
    st_bull  = d["st_dir"] == 1
    rsi_zone = d["rsi"].between(rlo, rhi)
    atr_ok   = d["atr"] > 0.002 * d["close"]

    # MODE A: EMA bounce
    ema_bounce = (d["low"] < d["ema_f"]) & (d["close"] > d["ema_f"])
    # MODE B: EMA cross up
    ema_cross = (d["close"] > d["ema_f"]) & (d["close"].shift(1) <= d["ema_f"].shift(1))
    # MODE C: Supertrend flip
    st_flip = (d["st_dir"] == 1) & (d["st_dir"].shift(1) == -1)

    sig = trend & rsi_zone & atr_ok & (ema_bounce | ema_cross | st_flip)

    d["signal"] = sig.astype(int)
    d["sl"]     = d["close"] - slk * d["atr"]
    d["tp"]     = d["close"] + tpk * d["atr"]
    return d


# ═══════════════════════ BACKTEST ════════════════════════════════

def backtest(df: pd.DataFrame, capital: float = 10_000.0):
    """
    Bar-by-bar backtest. Signal at bar[i] → entry at bar[i+1] open.

    Returns (trades_df, equity_series, final_capital).
    """
    cap    = float(capital)
    equity = []
    trades = []
    in_pos = False
    entry_p = sl = tp = entry_date = None

    cl  = df["close"].values
    hi  = df["high"].values
    lo  = df["low"].values
    op  = df["open"].values
    sig = df["signal"].values
    sl_ = df["sl"].values
    tp_ = df["tp"].values
    rd  = df["st_dir"].values
    rs  = df["rsi"].values
    idx = df.index

    for i in range(len(df)):
        if in_pos:
            ex = None
            rsn = ""
            # Trailing breakeven: move SL to entry once +0.5R gained
            if cl[i] - entry_p > (tp - entry_p) * 0.5:
                sl = max(sl, entry_p - COMMISSION * entry_p)
            if lo[i] <= sl:
                ex = sl; rsn = "SL"
            elif hi[i] >= tp:
                ex = tp; rsn = "TP"
            elif rd[i] == -1:
                ex = cl[i]; rsn = "ST_flip"
            elif rs[i] < 33:
                ex = cl[i]; rsn = "RSI_exit"
            if ex is not None:
                ex_p = ex * (1 - SLIPPAGE)
                ret  = (ex_p - entry_p) / entry_p - COMMISSION * 2
                cap *= (1 + ret)
                trades.append({
                    "entry_date": str(entry_date),
                    "exit_date": str(idx[i]),
                    "entry": round(entry_p, 4),
                    "exit": round(ex_p, 4),
                    "sl": round(sl, 4),
                    "tp": round(tp, 4),
                    "pnl_pct": round(ret * 100, 3),
                    "win": ret > 0,
                    "reason": rsn,
                    "capital": round(cap, 2),
                })
                in_pos = False

        if not in_pos and i > 0 and sig[i-1] == 1:
            entry_p    = op[i] * (1 + SLIPPAGE)
            sl         = sl_[i-1]
            tp         = tp_[i-1]
            entry_date = idx[i]
            in_pos     = True

        equity.append(cap)

    eq = pd.Series(equity, index=idx)
    return pd.DataFrame(trades), eq, cap


# ═══════════════════════ METRICS ═════════════════════════════════

def calc_metrics(trades_df: pd.DataFrame, eq: pd.Series,
                 init_capital: float = 10_000.0) -> dict:
    """Compute strategy performance metrics."""
    t = trades_df
    if t.empty or len(t) < 1:
        return {
            "win_rate": 0, "roi": 0, "max_dd": 0, "sharpe": 0,
            "n": 0, "avg_win": 0, "avg_loss": 0, "profit_factor": 0,
            "expect": 0, "final_equity": init_capital,
        }
    wr  = t["win"].mean() * 100
    roi = (eq.iloc[-1] - init_capital) / init_capital * 100
    pk  = eq.cummax()
    mdd = ((eq - pk) / pk).min() * 100
    rt  = eq.pct_change().dropna()
    sh  = rt.mean() / rt.std() * np.sqrt(252 * 6) if rt.std() > 0 else 0
    gw  = t.loc[t["win"],  "pnl_pct"].sum()
    gl  = t.loc[~t["win"], "pnl_pct"].abs().sum()
    pf  = gw / gl if gl > 0 else 99.0
    aw  = t.loc[t["win"],  "pnl_pct"].mean() if t["win"].any() else 0
    al  = t.loc[~t["win"], "pnl_pct"].mean() if (~t["win"]).any() else 0
    ex  = wr / 100 * aw + (1 - wr / 100) * al
    return {
        "win_rate": round(wr, 2),
        "roi": round(roi, 2),
        "max_dd": round(mdd, 2),
        "sharpe": round(sh, 2),
        "n": len(t),
        "avg_win": round(aw, 3),
        "avg_loss": round(al, 3),
        "profit_factor": round(pf, 2),
        "expect": round(ex, 3),
        "final_equity": round(eq.iloc[-1], 2),
    }


# ═══════════════════════ GRID OPTIMISER ══════════════════════════

DEFAULT_GRID = {
    "ef":  [10, 15, 20, 30],
    "es":  [50, 70, 100],
    "slk": [0.7, 1.0, 1.2],
    "tpk": [1.5, 2.0, 2.5, 3.0],
    "rlo": [38, 42, 46],
    "stm": [2.5, 3.0, 3.5],
}

QUICK_GRID = {
    "ef":  [15, 20],
    "es":  [50, 100],
    "slk": [1.0, 1.2],
    "tpk": [2.0, 2.5],
    "rlo": [38, 42],
    "stm": [3.0],
}


def composite_score(m: dict) -> float:
    """Score for ranking parameter combos."""
    if m["n"] < 1:
        return -999.0
    return (
        m["roi"] * 1.0
        + m["win_rate"] * 0.3
        - abs(m["max_dd"]) * 0.2
        + min(m["profit_factor"], 5) * 5
    )


def optimize(df_raw: pd.DataFrame, capital: float = 100_000.0,
             grid: dict | None = None, top_n: int = 10):
    """
    Grid search over parameter combos.

    Parameters
    ----------
    df_raw : DataFrame with columns [open, high, low, close, volume] and DatetimeIndex.
    capital : Starting capital.
    grid : Parameter grid dict. Defaults to DEFAULT_GRID.
    top_n : Number of top results to return.

    Returns list of (params_dict, trades_df, equity_series, metrics_dict, score).
    """
    if grid is None:
        grid = DEFAULT_GRID
    keys   = list(grid.keys())
    combos = list(iproduct(*grid.values()))
    valid  = [(ef, es, slk, tpk, rlo, stm) for ef, es, slk, tpk, rlo, stm
              in combos if ef < es]

    results = []
    for ef, es, slk, tpk, rlo, stm in valid:
        try:
            di = build_indicators(df_raw, ef, es, stm)
            ds = generate_signals(di, rlo=rlo, slk=slk, tpk=tpk)
            t, eq, _ = backtest(ds, capital)
            m = calc_metrics(t, eq, capital)
            if m["n"] >= 1:
                params = {"ef": ef, "es": es, "slk": slk, "tpk": tpk,
                          "rlo": rlo, "stm": stm}
                score = composite_score(m)
                results.append((params, t, eq, m, score))
        except Exception:
            pass

    results.sort(key=lambda x: x[4], reverse=True)
    return results[:top_n]
