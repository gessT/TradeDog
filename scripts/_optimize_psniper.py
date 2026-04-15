"""Optimizer for PrecSniper strategy — grid search across KLSE stocks."""
import itertools
import pandas as pd
import numpy as np
from strategies.futures.data_loader import load_yfinance
from strategies.klse.psniper.backtest import run_backtest
from strategies.klse.psniper.strategy import DEFAULT_PARAMS

# Diverse KLSE stocks for optimization
STOCKS = [
    "0233.KL", "0208.KL", "1155.KL", "5398.KL", "0166.KL",
    "8869.KL", "5248.KL", "5347.KL", "6742.KL", "5211.KL",
    "1295.KL", "0128.KL", "5168.KL", "5296.KL", "7084.KL",
]

# Load data once
print("Loading data...")
stock_data = {}
for sym in STOCKS:
    df = load_yfinance(symbol=sym, interval="1d", period="5y")
    if not df.empty and len(df) >= 200:
        stock_data[sym] = df
        print(f"  {sym}: {len(df)} bars")
print(f"Loaded {len(stock_data)} stocks\n")

# Parameter grid
grid = {
    "ema_fast":  [8, 10, 13],
    "ema_slow":  [21, 26, 34],
    "ema_trend": [55, 89],
    "min_score": [3, 4, 5, 6],
    "sl_atr_mult": [1.5, 2.0, 2.5],
    "tp1_rr": [1.0],
    "tp2_rr": [2.0],
    "tp3_rr": [3.0],
    "rsi_len":  [14, 21],
    "swing_lookback": [7, 10],
}

keys = list(grid.keys())
combos = list(itertools.product(*[grid[k] for k in keys]))
print(f"Testing {len(combos)} parameter combinations...")

results = []
for idx, combo in enumerate(combos):
    params = {**DEFAULT_PARAMS}
    for k, v in zip(keys, combo):
        params[k] = v

    # Skip invalid EMA combos
    if params["ema_fast"] >= params["ema_slow"]:
        continue

    total_trades = 0
    total_wins = 0
    total_return = 0.0
    total_pf_num = 0.0
    total_pf_den = 0.0

    for sym, df in stock_data.items():
        try:
            r = run_backtest(df, params=params, capital=5000)
            total_trades += r.total_trades
            total_wins += r.winners
            total_return += r.total_return_pct
            total_pf_num += sum(t.pnl for t in r.trades if t.win)
            total_pf_den += abs(sum(t.pnl for t in r.trades if not t.win))
        except Exception:
            continue

    if total_trades < 10:
        continue

    wr = total_wins / total_trades * 100
    avg_ret = total_return / len(stock_data)
    pf = total_pf_num / total_pf_den if total_pf_den > 0 else 999.0
    # Composite score: emphasize WR and return, penalize too few trades
    score = wr * 0.4 + min(avg_ret, 50) * 0.4 + min(pf, 5) * 4

    results.append({
        "params": {k: v for k, v in zip(keys, combo)},
        "trades": total_trades,
        "wr": round(wr, 1),
        "avg_ret": round(avg_ret, 2),
        "pf": round(pf, 2),
        "score": round(score, 2),
    })

    if (idx + 1) % 50 == 0:
        print(f"  {idx+1}/{len(combos)} done...")

# Sort by composite score
results.sort(key=lambda x: x["score"], reverse=True)
print(f"\n{'='*80}")
print(f"TOP 10 RESULTS (out of {len(results)} valid combos):")
print(f"{'='*80}")
for i, r in enumerate(results[:10]):
    p = r["params"]
    print(f"\n#{i+1} — Score={r['score']:.1f}  WR={r['wr']}%  AvgRet={r['avg_ret']}%  PF={r['pf']}  Trades={r['trades']}")
    print(f"   EMA: {p['ema_fast']}/{p['ema_slow']}/{p['ema_trend']}  MinScore={p['min_score']}  "
          f"SL_ATR={p['sl_atr_mult']}  RSI={p['rsi_len']}  SwingLB={p['swing_lookback']}")

# Print best params dict
if results:
    best = results[0]["params"]
    print(f"\nBest params dict:")
    print(best)
