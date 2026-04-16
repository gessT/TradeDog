"""Phase 2 PrecSniper optimization with TP tuning."""
import sys; sys.path.insert(0, ".")
import numpy as np
from strategies.futures.data_loader import load_yfinance
from strategies.klse.psniper.backtest import run_backtest
from strategies.klse.psniper.strategy import DEFAULT_PARAMS

STOCKS = ['0233.KL','0208.KL','5398.KL','5248.KL','6742.KL']
data = {}
for s in STOCKS:
    df = load_yfinance(symbol=s, interval='1d', period='2y')
    if len(df) > 100:
        data[s] = df
print(f"{len(data)} stocks loaded")

configs = []
# Refine around best config (8/21/55)
for ms in [3, 4]:
    for sl in [2.0, 2.5, 3.0]:
        for rl in [14, 21]:
            for slb in [5, 7, 10]:
                for tp1 in [1.0, 1.5]:
                    for tp3 in [2.5, 3.0, 4.0]:
                        configs.append(dict(
                            ema_fast=8, ema_slow=21, ema_trend=55,
                            min_score=ms, sl_atr_mult=sl, rsi_len=rl,
                            swing_lookback=slb, tp1_rr=tp1, tp2_rr=2.0, tp3_rr=tp3
                        ))

# Also config #8 variants (13/34/55)
for ms in [3, 4]:
    for sl in [1.5, 2.0, 2.5]:
        for tp1 in [1.0, 1.5]:
            for tp3 in [2.5, 3.0, 4.0]:
                configs.append(dict(
                    ema_fast=13, ema_slow=34, ema_trend=55,
                    min_score=ms, sl_atr_mult=sl, rsi_len=14,
                    swing_lookback=10, tp1_rr=tp1, tp2_rr=2.0, tp3_rr=tp3
                ))

print(f"Testing {len(configs)} configs...")
results = []
for ci, cfg in enumerate(configs):
    p = {**DEFAULT_PARAMS, **cfg}
    tt = tw = 0
    tr_ = pfn = pfd = 0.0
    for s, df in data.items():
        try:
            r = run_backtest(df, params=p, capital=5000)
            tt += r.total_trades
            tw += r.winners
            tr_ += r.total_return_pct
            pfn += sum(t.pnl for t in r.trades if t.win)
            pfd += abs(sum(t.pnl for t in r.trades if not t.win))
        except Exception:
            pass
    if tt < 5:
        continue
    wr = tw / tt * 100
    ar = tr_ / len(data)
    pf = pfn / pfd if pfd > 0 else 999
    sc = wr * 0.4 + min(ar, 50) * 0.4 + min(pf, 5) * 4
    results.append(dict(cfg=cfg, wr=round(wr, 1), ar=round(ar, 2),
                        pf=round(pf, 2), tt=tt, sc=round(sc, 2)))

results.sort(key=lambda x: x['sc'], reverse=True)
print(f"\nTOP 10 (of {len(results)} valid):")
for i, r in enumerate(results[:10]):
    c = r['cfg']
    ema_str = f"{c['ema_fast']}/{c['ema_slow']}/{c['ema_trend']}"
    tp_str = f"{c['tp1_rr']}/{c['tp2_rr']}/{c['tp3_rr']}"
    print(f"  #{i+1} WR={r['wr']:5.1f}% Ret={r['ar']:7.2f}% PF={r['pf']:5.2f} "
          f"T={r['tt']:3d} SC={r['sc']:6.1f} | EMA={ema_str} MS={c['min_score']} "
          f"SL={c['sl_atr_mult']} RSI={c['rsi_len']} SwLB={c['swing_lookback']} TP={tp_str}")

if results:
    print(f"\nBest config: {results[0]['cfg']}")
