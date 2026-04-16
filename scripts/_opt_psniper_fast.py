"""Quick PrecSniper optimization — focused grid."""
import itertools
import numpy as np
import pandas as pd
from strategies.futures.data_loader import load_yfinance
from strategies.klse.psniper.backtest import run_backtest
from strategies.klse.psniper.strategy import DEFAULT_PARAMS

STOCKS = ['0233.KL','0208.KL','1155.KL','5398.KL','0166.KL',
          '8869.KL','5248.KL','5347.KL','6742.KL','5211.KL']

stock_data = {}
for sym in STOCKS:
    df = load_yfinance(symbol=sym, interval='1d', period='5y')
    if not df.empty and len(df) >= 200:
        stock_data[sym] = df
print(f"Loaded {len(stock_data)} stocks")

grid = {
    'ema_fast':  [8, 13],
    'ema_slow':  [21, 34],
    'ema_trend': [55, 89],
    'min_score': [3, 4, 5],
    'sl_atr_mult': [1.5, 2.0, 2.5],
    'rsi_len':  [14, 21],
    'swing_lookback': [7, 10],
}

keys = list(grid.keys())
combos = list(itertools.product(*[grid[k] for k in keys]))
print(f"Testing {len(combos)} combos...")

results = []
for combo in combos:
    p = {**DEFAULT_PARAMS}
    for k, v in zip(keys, combo):
        p[k] = v
    if p['ema_fast'] >= p['ema_slow']:
        continue

    tt = tw = 0
    tr = pfn = pfd = 0.0
    for sym, df in stock_data.items():
        try:
            r = run_backtest(df, params=p, capital=5000)
            tt += r.total_trades
            tw += r.winners
            tr += r.total_return_pct
            pfn += sum(t.pnl for t in r.trades if t.win)
            pfd += abs(sum(t.pnl for t in r.trades if not t.win))
        except Exception:
            pass

    if tt < 10:
        continue

    wr = tw / tt * 100
    ar = tr / len(stock_data)
    pf = pfn / pfd if pfd > 0 else 999.0
    score = wr * 0.4 + min(ar, 50) * 0.4 + min(pf, 5) * 4
    results.append({
        'params': {k: v for k, v in zip(keys, combo)},
        'trades': tt,
        'wr': round(wr, 1),
        'avg_ret': round(ar, 2),
        'pf': round(pf, 2),
        'score': round(score, 2),
    })

results.sort(key=lambda x: x['score'], reverse=True)
print(f"\nTOP 10:")
for i, r in enumerate(results[:10]):
    p = r['params']
    print(f"  #{i+1} Score={r['score']} WR={r['wr']}% Ret={r['avg_ret']}% PF={r['pf']} "
          f"Trades={r['trades']} | EMA={p['ema_fast']}/{p['ema_slow']}/{p['ema_trend']} "
          f"MS={p['min_score']} SL={p['sl_atr_mult']} RSI={p['rsi_len']} SwLB={p['swing_lookback']}")

if results:
    print(f"\nBest params: {results[0]['params']}")
