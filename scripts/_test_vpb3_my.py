"""Quick backtest runner to test VPB3 Malaysia strategy on multiple stocks."""
import sys
sys.path.insert(0, ".")

from strategies.futures.data_loader import load_yfinance
from strategies.klse.vpb3.backtest import run_backtest
from strategies.klse.vpb3.strategy import DEFAULT_PARAMS

stocks = [
    "0208.KL", "5347.KL", "1155.KL", "5398.KL", "8869.KL",
    "5326.KL", "0166.KL", "5211.KL", "6742.KL", "1295.KL",
    "5225.KL", "1023.KL", "0128.KL", "7084.KL", "5296.KL",
]

print("=== VPB3 Malaysia — DEFAULT PARAMS (2Y daily) ===")
hdr = f"{'Sym':<12} {'Trades':>6} {'WR%':>7} {'Ret%':>8} {'PF':>6} {'DD%':>7} {'Sharpe':>7}"
print(hdr)
print("-" * len(hdr))

total_wr = []
total_ret = []

for sym in stocks:
    try:
        df = load_yfinance(symbol=sym, interval="1d", period="2y")
        if len(df) < 60:
            print(f"{sym:<12} ERROR: not enough data ({len(df)} bars)")
            continue
        r = run_backtest(df, params=DEFAULT_PARAMS, capital=5000)
        print(f"{sym:<12} {r.total_trades:>6} {r.win_rate:>7.1f} {r.total_return_pct:>8.1f} {r.profit_factor:>6.2f} {r.max_drawdown_pct:>7.1f} {r.sharpe_ratio:>7.2f}")
        if r.total_trades > 0:
            total_wr.append(r.win_rate)
            total_ret.append(r.total_return_pct)
    except Exception as e:
        print(f"{sym:<12} ERROR: {str(e)[:60]}")

if total_wr:
    print("-" * len(hdr))
    print(f"{'AVG':<12} {'':>6} {sum(total_wr)/len(total_wr):>7.1f} {sum(total_ret)/len(total_ret):>8.1f}")
    print(f"\nStocks with trades: {len(total_wr)}/{len(stocks)}")

# Now test with tuned params
print("\n\n=== VPB3 Malaysia — TUNED PARAMS (2Y daily) ===")
tuned = {**DEFAULT_PARAMS}
tuned["breakout_lookback"] = 8        # slightly tighter
tuned["vol_multiplier"] = 1.2         # lower vol threshold
tuned["rsi_min"] = 40                 # wider RSI range
tuned["rsi_max"] = 72
tuned["body_ratio_min"] = 0.25        # relax candle quality
tuned["close_top_pct"] = 0.40         # relax close position
tuned["accum_min_bars"] = 2           # easier accumulation (2 of 8)
tuned["accum_vol_ratio"] = 0.90       # relax vol ratio
tuned["tp_r_multiple"] = 2.0          # higher TP
tuned["sl_lookback"] = 4              # tighter SL
tuned["min_sl_atr"] = 0.6
tuned["trailing_atr_mult"] = 1.8
tuned["risk_pct"] = 5.0
tuned["cooldown_bars"] = 2

print(hdr)
print("-" * len(hdr))

tuned_wr = []
tuned_ret = []

for sym in stocks:
    try:
        df = load_yfinance(symbol=sym, interval="1d", period="2y")
        if len(df) < 60:
            continue
        r = run_backtest(df, params=tuned, capital=5000)
        print(f"{sym:<12} {r.total_trades:>6} {r.win_rate:>7.1f} {r.total_return_pct:>8.1f} {r.profit_factor:>6.2f} {r.max_drawdown_pct:>7.1f} {r.sharpe_ratio:>7.2f}")
        if r.total_trades > 0:
            tuned_wr.append(r.win_rate)
            tuned_ret.append(r.total_return_pct)
    except Exception as e:
        print(f"{sym:<12} ERROR: {str(e)[:60]}")

if tuned_wr:
    print("-" * len(hdr))
    print(f"{'AVG':<12} {'':>6} {sum(tuned_wr)/len(tuned_wr):>7.1f} {sum(tuned_ret)/len(tuned_ret):>8.1f}")
    print(f"\nStocks with trades: {len(tuned_wr)}/{len(stocks)}")

# Test v3: relaxed even more
print("\n\n=== VPB3 Malaysia — V3 AGGRESSIVE (2Y daily) ===")
v3 = {**DEFAULT_PARAMS}
v3["breakout_lookback"] = 7
v3["vol_multiplier"] = 1.1
v3["rsi_min"] = 38
v3["rsi_max"] = 75
v3["body_ratio_min"] = 0.2
v3["close_top_pct"] = 0.45
v3["accum_min_bars"] = 0              # disable accumulation
v3["tp_r_multiple"] = 2.5            # much higher TP
v3["sl_lookback"] = 3
v3["min_sl_atr"] = 0.5
v3["trailing_atr_mult"] = 1.5
v3["skip_low_atr"] = False
v3["risk_pct"] = 5.0
v3["cooldown_bars"] = 2

print(hdr)
print("-" * len(hdr))

v3_wr = []
v3_ret = []

for sym in stocks:
    try:
        df = load_yfinance(symbol=sym, interval="1d", period="2y")
        if len(df) < 60:
            continue
        r = run_backtest(df, params=v3, capital=5000)
        print(f"{sym:<12} {r.total_trades:>6} {r.win_rate:>7.1f} {r.total_return_pct:>8.1f} {r.profit_factor:>6.2f} {r.max_drawdown_pct:>7.1f} {r.sharpe_ratio:>7.2f}")
        if r.total_trades > 0:
            v3_wr.append(r.win_rate)
            v3_ret.append(r.total_return_pct)
    except Exception as e:
        print(f"{sym:<12} ERROR: {str(e)[:60]}")

if v3_wr:
    print("-" * len(hdr))
    print(f"{'AVG':<12} {'':>6} {sum(v3_wr)/len(v3_wr):>7.1f} {sum(v3_ret)/len(v3_ret):>8.1f}")
