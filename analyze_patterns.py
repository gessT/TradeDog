"""
AAPL Technical Analysis — PineScript-Style Strategy Tester
==========================================================
Write your own strategies using PineScript-like syntax!

Available functions (just like TradingView PineScript):
───────────────────────────────────────────────────────
  PRICE DATA:
    close, open_, high, low, volume     ← numpy arrays, use directly
    close[i]                            ← value on bar i

  INDICATORS (ta.xxx):
    ta.sma(source, length)              ← Simple Moving Average
    ta.ema(source, length)              ← Exponential Moving Average
    ta.rsi(source, length)              ← RSI (default 14)
    ta.macd(source, fast, slow, signal) ← returns (macd_line, signal_line, histogram)
    ta.bb(source, length, mult)         ← Bollinger Bands → (mid, lower, upper)
    ta.atr(length)                      ← Average True Range
    ta.stoch(length, k_smooth, d_smooth)← Stochastic → (k, d)
    ta.vwap()                           ← Volume Weighted Average Price (rolling)
    ta.highest(source, length)          ← Rolling highest value
    ta.lowest(source, length)           ← Rolling lowest value
    ta.change(source, length=1)         ← Difference: source - source[length ago]
    ta.roc(source, length)              ← Rate of Change %
    ta.wma(source, length)              ← Weighted Moving Average
    ta.dema(source, length)             ← Double EMA
    ta.tema(source, length)             ← Triple EMA
    ta.adx(length)                      ← ADX → (adx, plus_di, minus_di)

  CROSSOVER HELPERS:
    ta.crossover(a, b)                  ← True on bars where a crosses ABOVE b
    ta.crossunder(a, b)                 ← True on bars where a crosses BELOW b

  COMPARISON (works element-wise on arrays):
    a > b, a < b, a >= b, a <= b        ← returns boolean array
    (cond1) & (cond2)                   ← AND
    (cond1) | (cond2)                   ← OR

HOW TO ADD YOUR STRATEGY:
──────────────────────────
  Just add a @strategy("Name") decorated function that returns a boolean array.

  @strategy("My Strategy")
  def my_strat():
      return ta.crossover(ta.ema(close, 9), ta.ema(close, 21))
"""

import json
import pandas as pd
import numpy as np

# ── Load data ────────────────────────────────────────────────────────────────
with open("apple_stock.json", "r") as f:
    raw = json.load(f)

df = pd.DataFrame(raw["data"])
for col in ["Open", "High", "Low", "Close", "Volume"]:
    df[col] = df[col].astype(float)
df["Date"] = pd.to_datetime(df["Date"])
df.sort_values("Date", inplace=True)
df.reset_index(drop=True, inplace=True)

# ── PineScript-style price variables ────────────────────────────────────────
close  = df["Close"].values
open_  = df["Open"].values
high   = df["High"].values
low    = df["Low"].values
volume = df["Volume"].values
n      = len(close)


# ═══════════════════════════════════════════════════════════════════════════════
#  ta.* — PineScript-style indicator library
# ═══════════════════════════════════════════════════════════════════════════════
class ta:
    """Technical Analysis functions — use exactly like PineScript's ta.xxx()"""

    @staticmethod
    def sma(source, length):
        """ta.sma(close, 20)"""
        return pd.Series(source).rolling(length).mean().values

    @staticmethod
    def ema(source, length):
        """ta.ema(close, 12)"""
        return pd.Series(source).ewm(span=length, adjust=False).mean().values

    @staticmethod
    def wma(source, length):
        """ta.wma(close, 20) — Weighted Moving Average"""
        weights = np.arange(1, length + 1, dtype=float)
        return pd.Series(source).rolling(length).apply(
            lambda x: np.dot(x, weights) / weights.sum(), raw=True
        ).values

    @staticmethod
    def dema(source, length):
        """ta.dema(close, 20) — Double EMA"""
        e1 = ta.ema(source, length)
        e2 = ta.ema(e1, length)
        return 2 * e1 - e2

    @staticmethod
    def tema(source, length):
        """ta.tema(close, 20) — Triple EMA"""
        e1 = ta.ema(source, length)
        e2 = ta.ema(e1, length)
        e3 = ta.ema(e2, length)
        return 3 * e1 - 3 * e2 + e3

    @staticmethod
    def rsi(source, length=14):
        """ta.rsi(close, 14)"""
        s = pd.Series(source, dtype="float64")
        delta = s.diff()
        gain = delta.clip(lower=0).rolling(length).mean()
        loss = (-delta.clip(upper=0)).rolling(length).mean()
        rs = gain / loss.replace(0, np.nan)
        return (100 - 100 / (1 + rs)).fillna(50).values

    @staticmethod
    def macd(source, fast=12, slow=26, signal=9):
        """macd_line, signal_line, histogram = ta.macd(close, 12, 26, 9)"""
        ema_fast = ta.ema(source, fast)
        ema_slow = ta.ema(source, slow)
        macd_line = ema_fast - ema_slow
        signal_line = ta.ema(macd_line, signal)
        hist = macd_line - signal_line
        return macd_line, signal_line, hist

    @staticmethod
    def bb(source, length=20, mult=2):
        """mid, lower, upper = ta.bb(close, 20, 2)"""
        s = pd.Series(source, dtype="float64")
        mid = s.rolling(length).mean()
        std = s.rolling(length).std()
        return mid.values, (mid - mult * std).values, (mid + mult * std).values

    @staticmethod
    def atr(length=14):
        """ta.atr(14) — Average True Range"""
        h = pd.Series(high, dtype="float64")
        l = pd.Series(low, dtype="float64")
        c = pd.Series(close, dtype="float64")
        tr = pd.concat([h - l, (h - c.shift()).abs(), (l - c.shift()).abs()], axis=1).max(axis=1)
        return tr.rolling(length).mean().values

    @staticmethod
    def stoch(length=14, k_smooth=3, d_smooth=3):
        """k, d = ta.stoch(14, 3, 3) — Stochastic Oscillator"""
        h = pd.Series(high).rolling(length).max()
        l = pd.Series(low).rolling(length).min()
        raw_k = 100 * (pd.Series(close) - l) / (h - l).replace(0, np.nan)
        k = raw_k.rolling(k_smooth).mean().values
        d = pd.Series(k).rolling(d_smooth).mean().values
        return k, d

    @staticmethod
    def adx(length=14):
        """adx_val, plus_di, minus_di = ta.adx(14)"""
        h = pd.Series(high, dtype="float64")
        l = pd.Series(low, dtype="float64")
        c = pd.Series(close, dtype="float64")
        tr = pd.concat([h - l, (h - c.shift()).abs(), (l - c.shift()).abs()], axis=1).max(axis=1)
        plus_dm = (h - h.shift()).clip(lower=0)
        minus_dm = (l.shift() - l).clip(lower=0)
        # zero out when other is bigger
        plus_dm[plus_dm < minus_dm] = 0
        minus_dm[minus_dm < plus_dm] = 0
        atr_ = tr.ewm(span=length, adjust=False).mean()
        plus_di = 100 * plus_dm.ewm(span=length, adjust=False).mean() / atr_
        minus_di = 100 * minus_dm.ewm(span=length, adjust=False).mean() / atr_
        dx = 100 * (plus_di - minus_di).abs() / (plus_di + minus_di).replace(0, np.nan)
        adx_val = dx.ewm(span=length, adjust=False).mean()
        return adx_val.values, plus_di.values, minus_di.values

    @staticmethod
    def vwap():
        """ta.vwap() — cumulative VWAP (resets conceptually per-session but
        here we use rolling 20-day for daily data)"""
        tp = (pd.Series(high) + pd.Series(low) + pd.Series(close)) / 3
        cum_tp_vol = (tp * pd.Series(volume)).rolling(20).sum()
        cum_vol = pd.Series(volume).rolling(20).sum()
        return (cum_tp_vol / cum_vol.replace(0, np.nan)).values

    @staticmethod
    def highest(source, length):
        """ta.highest(high, 252) — rolling max"""
        return pd.Series(source).rolling(length).max().values

    @staticmethod
    def lowest(source, length):
        """ta.lowest(low, 50) — rolling min"""
        return pd.Series(source).rolling(length).min().values

    @staticmethod
    def change(source, length=1):
        """ta.change(close, 1) — difference from N bars ago"""
        s = pd.Series(source, dtype="float64")
        return s.diff(length).values

    @staticmethod
    def roc(source, length=1):
        """ta.roc(close, 10) — Rate of Change %"""
        s = pd.Series(source, dtype="float64")
        return s.pct_change(length).values * 100

    @staticmethod
    def crossover(a, b):
        """ta.crossover(fast_ma, slow_ma) — True when a crosses ABOVE b"""
        a = np.asarray(a, dtype="float64")
        b = np.asarray(b, dtype="float64") if hasattr(b, '__len__') else np.full(len(a), b, dtype="float64")
        prev_below = np.empty(len(a), dtype=bool)
        prev_below[0] = False
        prev_below[1:] = a[:-1] <= b[:-1]
        now_above = a > b
        valid = ~(np.isnan(a) | np.isnan(b))
        return prev_below & now_above & valid

    @staticmethod
    def crossunder(a, b):
        """ta.crossunder(fast_ma, slow_ma) — True when a crosses BELOW b"""
        a = np.asarray(a, dtype="float64")
        b = np.asarray(b, dtype="float64") if hasattr(b, '__len__') else np.full(len(a), b, dtype="float64")
        prev_above = np.empty(len(a), dtype=bool)
        prev_above[0] = False
        prev_above[1:] = a[:-1] >= b[:-1]
        now_below = a < b
        valid = ~(np.isnan(a) | np.isnan(b))
        return prev_above & now_below & valid


# ═══════════════════════════════════════════════════════════════════════════════
#  Strategy registry — use @strategy("Name") to register
# ═══════════════════════════════════════════════════════════════════════════════
_strategies = {}

def strategy(name):
    """Decorator: register a strategy function by name."""
    def decorator(fn):
        _strategies[name] = fn
        return fn
    return decorator


# ═══════════════════════════════════════════════════════════════════════════════
#  ✏️  YOUR STRATEGIES — Write them here like PineScript!
# ═══════════════════════════════════════════════════════════════════════════════

@strategy("SMA Crossover (20/50)")
def _():
    return ta.crossover(ta.sma(close, 20), ta.sma(close, 50))

@strategy("EMA Crossover (12/26)")
def _():
    return ta.crossover(ta.ema(close, 12), ta.ema(close, 26))

@strategy("RSI Oversold Bounce")
def _():
    return ta.crossover(ta.rsi(close, 14), 30)   # RSI crosses back above 30

@strategy("RSI Momentum (>70)")
def _():
    return ta.crossover(ta.rsi(close, 14), 70)   # RSI breaks above 70

@strategy("MACD Crossover")
def _():
    macd_line, signal_line, _ = ta.macd(close, 12, 26, 9)
    return ta.crossover(macd_line, signal_line)

@strategy("Bollinger Band Bounce")
def _():
    _, bb_lower, _ = ta.bb(close, 20, 2)
    return close < bb_lower                       # price below lower band

@strategy("Golden Cross (50/200)")
def _():
    return ta.crossover(ta.sma(close, 50), ta.sma(close, 200))

@strategy("Mean Reversion (2σ)")
def _():
    _, bb_lower, _ = ta.bb(close, 20, 2)
    return ta.crossunder(close, bb_lower)         # price just dropped below band

@strategy("52-Week Breakout")
def _():
    prev_high = np.roll(ta.highest(high, 252), 1)  # yesterday's 52w high
    prev_high[0] = np.nan
    return close > prev_high

@strategy("Volume Spike + Up Close")
def _():
    vol_avg = ta.sma(volume, 20)
    return (volume > 2 * vol_avg) & (close > open_)

# ─────────────────────────────────────────────────────────────────────────────
#  ✏️  ADD YOUR OWN STRATEGIES BELOW — just copy the pattern!
# ─────────────────────────────────────────────────────────────────────────────
# Examples:
#
# @strategy("EMA 9/21 Crossover")
# def _():
#     return ta.crossover(ta.ema(close, 9), ta.ema(close, 21))
#
# @strategy("Stoch Oversold")
# def _():
#     k, d = ta.stoch(14, 3, 3)
#     return ta.crossover(k, 20) & (d < 30)
#
# @strategy("ADX Trend + EMA")
# def _():
#     adx_val, plus_di, minus_di = ta.adx(14)
#     return (adx_val > 25) & ta.crossover(plus_di, minus_di)
#
# @strategy("VWAP Reclaim")
# def _():
#     return ta.crossover(close, ta.vwap())
#
# @strategy("Triple EMA Crossover")
# def _():
#     return ta.crossover(ta.tema(close, 10), ta.tema(close, 30))


# ═══════════════════════════════════════════════════════════════════════════════
#  Backtest engine (no need to touch this)
# ═══════════════════════════════════════════════════════════════════════════════
HOLD_DAYS = [5, 10, 20]

results = []

for name, fn in _strategies.items():
    raw_signals = fn()
    signals = np.asarray(raw_signals, dtype=bool)
    for hold in HOLD_DAYS:
        wins = 0
        losses = 0
        total_return_pct = 0.0
        returns_list = []

        for i in range(n):
            if signals[i] and i + hold < n:
                entry = close[i]
                exit_ = close[i + hold]
                ret = (exit_ - entry) / entry * 100
                returns_list.append(ret)
                total_return_pct += ret
                if exit_ > entry:
                    wins += 1
                else:
                    losses += 1

        total = wins + losses
        win_rate = (wins / total * 100) if total > 0 else 0
        avg_ret = (total_return_pct / total) if total > 0 else 0
        median_ret = float(np.median(returns_list)) if returns_list else 0
        max_win = max(returns_list) if returns_list else 0
        max_loss = min(returns_list) if returns_list else 0

        results.append({
            "Strategy": name,
            "Hold Days": hold,
            "Signals": total,
            "Wins": wins,
            "Losses": losses,
            "Win Rate %": round(win_rate, 2),
            "Avg Return %": round(avg_ret, 3),
            "Median Return %": round(median_ret, 3),
            "Max Win %": round(max_win, 2),
            "Max Loss %": round(max_loss, 2),
        })

res_df = pd.DataFrame(results)

# ── Print results ────────────────────────────────────────────────────────────
print("=" * 120)
print(f"  AAPL TECHNICAL ANALYSIS PATTERN COMPARISON  |  Data: {df['Date'].iloc[0].date()} → {df['Date'].iloc[-1].date()}  |  {n:,} bars")
print("=" * 120)

for hold in HOLD_DAYS:
    sub = res_df[res_df["Hold Days"] == hold].sort_values("Win Rate %", ascending=False)
    print(f"\n{'─'*120}")
    print(f"  HOLD PERIOD: {hold} DAYS")
    print(f"{'─'*120}")
    print(sub.to_string(index=False))

# ── Summary: best strategy per metric ────────────────────────────────────────
print("\n" + "=" * 120)
print("  BEST STRATEGIES SUMMARY (across all hold periods)")
print("=" * 120)

best_winrate = res_df.loc[res_df["Win Rate %"].idxmax()]
best_avgret  = res_df.loc[res_df["Avg Return %"].idxmax()]
best_medret  = res_df.loc[res_df["Median Return %"].idxmax()]

print(f"\n  🏆 Highest Win Rate:      {best_winrate['Strategy']}  |  Hold {best_winrate['Hold Days']}d  |  {best_winrate['Win Rate %']:.1f}%  ({best_winrate['Signals']} trades, avg ret {best_winrate['Avg Return %']:.3f}%)")
print(f"  💰 Highest Avg Return:    {best_avgret['Strategy']}  |  Hold {best_avgret['Hold Days']}d  |  {best_avgret['Avg Return %']:.3f}%  (win rate {best_avgret['Win Rate %']:.1f}%)")
print(f"  📊 Highest Median Return: {best_medret['Strategy']}  |  Hold {best_medret['Hold Days']}d  |  {best_medret['Median Return %']:.3f}%  (win rate {best_medret['Win Rate %']:.1f}%)")

# ── Risk-adjusted: only show strategies with >= 10 signals ───────────────────
reliable = res_df[res_df["Signals"] >= 10].copy()
if not reliable.empty:
    print(f"\n  (Filtered to strategies with ≥ 10 signals for reliability)")
    best_wr = reliable.loc[reliable["Win Rate %"].idxmax()]
    best_ar = reliable.loc[reliable["Avg Return %"].idxmax()]
    print(f"  🏆 Best Reliable Win Rate:   {best_wr['Strategy']}  |  Hold {best_wr['Hold Days']}d  |  {best_wr['Win Rate %']:.1f}%  ({best_wr['Signals']} trades)")
    print(f"  💰 Best Reliable Avg Return: {best_ar['Strategy']}  |  Hold {best_ar['Hold Days']}d  |  {best_ar['Avg Return %']:.3f}%  ({best_ar['Signals']} trades)")

print()
