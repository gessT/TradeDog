"""Final validation — PrecSniper optimized on 15 KLSE stocks."""
import sys; sys.path.insert(0, ".")
from strategies.futures.data_loader import load_yfinance
from strategies.klse.psniper.backtest import run_backtest
from strategies.klse.psniper.strategy import DEFAULT_PARAMS

stocks = [
    ('0233.KL', 'Pekat'), ('0208.KL', 'Greatech'), ('1155.KL', 'Maybank'),
    ('5398.KL', 'Gamuda'), ('0166.KL', 'Inari'), ('8869.KL', 'PressMetal'),
    ('5248.KL', 'Bermaz'), ('5347.KL', 'TNB'), ('6742.KL', 'YTLPower'),
    ('5211.KL', 'Sunway'), ('1295.KL', 'PubBank'), ('0128.KL', 'Frontken'),
    ('5168.KL', 'Hartalega'), ('5296.KL', 'MRDIY'), ('7084.KL', 'QLRes'),
]

print("PrecSniper FINAL — Optimized Defaults")
print(f"  EMA: {DEFAULT_PARAMS['ema_fast']}/{DEFAULT_PARAMS['ema_slow']}/{DEFAULT_PARAMS['ema_trend']}")
print(f"  MinScore: {DEFAULT_PARAMS['min_score']}, SL_ATR: {DEFAULT_PARAMS['sl_atr_mult']}, TP1_RR: {DEFAULT_PARAMS['tp1_rr']}")
print(f"  Simple Exit: {DEFAULT_PARAMS.get('simple_exit', False)}")
print()

header = f"{'Stock':<14} {'Trades':>6} {'WR%':>6} {'Ret%':>8} {'PF':>6} {'DD%':>6} {'Sharpe':>7}"
print(header)
print("-" * 60)

tt = tw = 0
tr_ = 0.0
for sym, name in stocks:
    df = load_yfinance(symbol=sym, interval='1d', period='5y')
    if len(df) < 100:
        print(f"{name:<14} insufficient data")
        continue
    r = run_backtest(df, params=DEFAULT_PARAMS, capital=5000)
    tt += r.total_trades
    tw += r.winners
    tr_ += r.total_return_pct
    flag = " ***" if r.win_rate >= 60 else ""
    print(f"{name:<14} {r.total_trades:>6} {r.win_rate:>5.1f}% {r.total_return_pct:>7.2f}%"
          f" {r.profit_factor:>5.2f} {r.max_drawdown_pct:>5.2f}% {r.sharpe_ratio:>6.2f}{flag}")

print("-" * 60)
wr = tw / tt * 100 if tt else 0
ar = tr_ / 15
print(f"TOTAL: {tt} trades, WR={wr:.1f}%, AvgRet={ar:.2f}%, TotalPnL={tr_:.1f}%")
