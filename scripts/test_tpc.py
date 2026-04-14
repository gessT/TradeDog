"""Quick optimization test for TPC strategy."""
from strategies.us_stock.tpc.backtest import TPCBacktester
from strategies.futures.data_loader import load_yfinance
import logging

logging.basicConfig(level=logging.WARNING)

configs = [
    {"name": "v1: SL1.5 TP1=1.0", "params": {"atr_sl_mult": 1.5, "tp1_r_mult": 1.0, "tp2_r_mult": 2.5}},
    {"name": "v2: SL2.0 TP1=1.0", "params": {"atr_sl_mult": 2.0, "tp1_r_mult": 1.0, "tp2_r_mult": 2.5}},
    {"name": "v3: SL1.5 TP1=1.5 ADX15", "params": {"atr_sl_mult": 1.5, "tp1_r_mult": 1.5, "d_adx_min": 15}},
    {"name": "v4: SL2.0 TP1=1.0 ADX15", "params": {"atr_sl_mult": 2.0, "tp1_r_mult": 1.0, "d_adx_min": 15, "tp2_r_mult": 2.5}},
    {"name": "v5: SL2.5 TP1=1.5 trail2", "params": {"atr_sl_mult": 2.5, "tp1_r_mult": 1.5, "trailing_atr_mult": 2.0}},
]

symbols = ["NVDA", "AAPL", "MSFT", "TSLA", "META", "AMZN", "GOOGL", "AMD", "PLTR", "COIN"]

# Pre-load data
print("Loading data...")
data_cache = {}
for sym in symbols:
    df_w = load_yfinance(sym, "1wk", "5y")
    df_d = load_yfinance(sym, "1d", "5y")
    df_h = load_yfinance(sym, "1h", "730d")
    data_cache[sym] = (df_w, df_d, df_h)

print(f"\n{'Config':<32} {'WR%':>6} {'Trades':>7} {'AvgROI':>8} {'MaxDD':>7}")
print("=" * 65)

for cfg in configs:
    tw = tt = 0
    tr = 0.0
    tdd = 0.0
    for sym in symbols:
        df_w, df_d, df_h = data_cache[sym]
        bt = TPCBacktester(capital=5000, risk_per_trade=0.03)
        r = bt.run(
            symbol=sym, period="2y", params=cfg["params"],
            df_weekly=df_w, df_daily=df_d, df_1h=df_h,
        )
        tw += r.winners
        tt += r.total_trades
        tr += r.total_return_pct
        tdd = max(tdd, r.max_drawdown_pct)

    wr = tw / tt * 100 if tt else 0
    avg_roi = tr / len(symbols)
    print(f"{cfg['name']:<32} {wr:>5.1f}% {tt:>6}  {avg_roi:>7.1f}% {tdd:>6.1f}%")
