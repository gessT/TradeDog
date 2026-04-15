"""Phase 3 — higher quality signals, more selective configs."""
import sys; sys.path.insert(0, ".")
from strategies.futures.data_loader import load_yfinance
from strategies.klse.psniper.backtest import run_backtest
from strategies.klse.psniper.strategy import DEFAULT_PARAMS

stocks = [
    ('0233.KL', 'Pekat'), ('0208.KL', 'Greatech'), ('1155.KL', 'Maybank'),
    ('5398.KL', 'Gamuda'), ('0166.KL', 'Inari'), ('8869.KL', 'PressMetal'),
    ('5248.KL', 'Bermaz'), ('5347.KL', 'TNB'), ('6742.KL', 'YTLPower'),
    ('5211.KL', 'Sunway'),
]

data = {}
for sym, name in stocks:
    df = load_yfinance(symbol=sym, interval='1d', period='5y')
    if len(df) > 200:
        data[sym] = (df, name)
print(f"Loaded {len(data)} stocks (5y data)")

configs = [
    # Selective configs with higher min_score
    dict(ema_fast=8,  ema_slow=21, ema_trend=55, min_score=4, sl_atr_mult=2.0, rsi_len=14, swing_lookback=5),
    dict(ema_fast=8,  ema_slow=21, ema_trend=55, min_score=4, sl_atr_mult=2.5, rsi_len=14, swing_lookback=7),
    dict(ema_fast=8,  ema_slow=21, ema_trend=55, min_score=5, sl_atr_mult=2.0, rsi_len=14, swing_lookback=7),
    dict(ema_fast=8,  ema_slow=21, ema_trend=55, min_score=5, sl_atr_mult=2.5, rsi_len=14, swing_lookback=5),
    dict(ema_fast=8,  ema_slow=21, ema_trend=55, min_score=5, sl_atr_mult=2.5, rsi_len=21, swing_lookback=7),
    dict(ema_fast=13, ema_slow=34, ema_trend=55, min_score=4, sl_atr_mult=2.0, rsi_len=14, swing_lookback=10),
    dict(ema_fast=13, ema_slow=34, ema_trend=55, min_score=4, sl_atr_mult=2.5, rsi_len=14, swing_lookback=7),
    dict(ema_fast=13, ema_slow=34, ema_trend=55, min_score=5, sl_atr_mult=2.0, rsi_len=14, swing_lookback=10),
    dict(ema_fast=13, ema_slow=34, ema_trend=55, min_score=5, sl_atr_mult=2.5, rsi_len=14, swing_lookback=7),
    dict(ema_fast=13, ema_slow=34, ema_trend=89, min_score=4, sl_atr_mult=2.0, rsi_len=14, swing_lookback=10),
    dict(ema_fast=13, ema_slow=34, ema_trend=89, min_score=5, sl_atr_mult=2.0, rsi_len=14, swing_lookback=10),
    dict(ema_fast=13, ema_slow=34, ema_trend=89, min_score=5, sl_atr_mult=2.5, rsi_len=21, swing_lookback=7),
    # Conservative approach
    dict(ema_fast=13, ema_slow=34, ema_trend=89, min_score=6, sl_atr_mult=2.5, rsi_len=21, swing_lookback=10),
    dict(ema_fast=13, ema_slow=34, ema_trend=89, min_score=6, sl_atr_mult=2.0, rsi_len=14, swing_lookback=7),
    dict(ema_fast=8,  ema_slow=21, ema_trend=55, min_score=6, sl_atr_mult=2.5, rsi_len=14, swing_lookback=5),
    dict(ema_fast=8,  ema_slow=21, ema_trend=55, min_score=6, sl_atr_mult=2.0, rsi_len=21, swing_lookback=7),
    # With TP1=1.5 for quicker partial profits
    dict(ema_fast=8,  ema_slow=21, ema_trend=55, min_score=4, sl_atr_mult=2.5, rsi_len=14,
         swing_lookback=5, tp1_rr=1.5, tp3_rr=4.0),
    dict(ema_fast=13, ema_slow=34, ema_trend=55, min_score=4, sl_atr_mult=2.0, rsi_len=14,
         swing_lookback=10, tp1_rr=1.5, tp3_rr=4.0),
    dict(ema_fast=8,  ema_slow=21, ema_trend=55, min_score=5, sl_atr_mult=2.5, rsi_len=14,
         swing_lookback=5, tp1_rr=1.5, tp3_rr=4.0),
]

print(f"Testing {len(configs)} configs...")
results = []
for ci, cfg in enumerate(configs):
    p = {**DEFAULT_PARAMS, **cfg}
    tt = tw = 0
    tr_ = pfn = pfd = 0.0
    per_stock = []
    for sym, (df, name) in data.items():
        try:
            r = run_backtest(df, params=p, capital=5000)
            tt += r.total_trades
            tw += r.winners
            tr_ += r.total_return_pct
            pfn += sum(t.pnl for t in r.trades if t.win)
            pfd += abs(sum(t.pnl for t in r.trades if not t.win))
            per_stock.append((name, r.total_trades, r.win_rate, r.total_return_pct))
        except Exception:
            pass
    if tt < 8:
        continue
    wr = tw / tt * 100
    ar = tr_ / len(data)
    pf = pfn / pfd if pfd > 0 else 999
    sc = wr * 0.5 + min(ar, 50) * 0.3 + min(pf, 5) * 4
    results.append(dict(cfg=cfg, wr=round(wr, 1), ar=round(ar, 2),
                        pf=round(pf, 2), tt=tt, sc=round(sc, 2),
                        per_stock=per_stock))

results.sort(key=lambda x: x['sc'], reverse=True)
print(f"\nTOP 10 (of {len(results)} valid):")
for i, r in enumerate(results[:10]):
    c = r['cfg']
    ema_s = f"{c['ema_fast']}/{c['ema_slow']}/{c['ema_trend']}"
    tp1 = c.get('tp1_rr', 1.0)
    tp3 = c.get('tp3_rr', 3.0)
    print(f"  #{i+1} WR={r['wr']:5.1f}% Ret={r['ar']:7.2f}% PF={r['pf']:5.2f} "
          f"T={r['tt']:3d} SC={r['sc']:6.1f} | EMA={ema_s} MS={c['min_score']} "
          f"SL={c['sl_atr_mult']} RSI={c['rsi_len']} SwLB={c['swing_lookback']} "
          f"TP1={tp1} TP3={tp3}")

# Show per-stock breakdown for top config
print(f"\n--- Top config per-stock breakdown ---")
if results:
    top = results[0]
    for name, trades, wr, ret in top['per_stock']:
        flag = " ***" if wr >= 50 else ""
        print(f"  {name:<14} T={trades:2d} WR={wr:5.1f}% Ret={ret:7.2f}%{flag}")
    print(f"\nFinal best: {top['cfg']}")
