"""Debug: compare SuperTrend values with TradingView."""
from strategies.futures.data_loader import load_yfinance
from strategies.us_stock.tpc.indicators import supertrend, atr as atr_fn
import pandas as pd
import numpy as np

df_w = load_yfinance("AAPL", interval="1wk", period="5y")
print(f"Weekly bars: {len(df_w)}")

st_line, st_dir = supertrend(df_w["high"], df_w["low"], df_w["close"], period=10, multiplier=3.0)

# Show ALL trend flips
print("\n=== Weekly SuperTrend Flips ===")
prev_d = 0
for i in range(len(df_w)):
    d = int(st_dir.iloc[i])
    if d != prev_d:
        idx = df_w.index[i]
        c = df_w.iloc[i]["close"]
        label = "BULLISH" if d == 1 else "BEARISH"
        print(f"  {str(idx)[:10]}  -> {label}  close={c:.2f}  st_line={st_line.iloc[i]:.2f}")
        prev_d = d

# Show last 20 weeks
print("\n=== Last 20 Weeks ===")
print("Date        Close    ST_Line   Dir")
for i in range(-20, 0):
    idx = df_w.index[i]
    c = df_w.iloc[i]["close"]
    d = "UP" if int(st_dir.iloc[i]) == 1 else "DN"
    print(f"  {str(idx)[:10]}  {c:>8.2f}  {st_line.iloc[i]:>8.2f}  {d}")

