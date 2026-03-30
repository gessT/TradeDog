"""Fetch KLSE stock 3-year data with 4h candles and save as JSON.

Usage: python scripts/fetch_klse99_4h.py [SYMBOL]
  e.g. python scripts/fetch_klse99_4h.py 5326.KL
"""
import json
import sys
import yfinance as yf
import pandas as pd

sym = sys.argv[1] if len(sys.argv) > 1 else "0099.KL"
code = sym.replace(".KL", "")
tk = yf.Ticker(sym)
name = tk.info.get("shortName", code)

# ── 1) Get hourly data (max ~730 days) and resample to 4h ──
df1h = tk.history(period="max", interval="1h")
df1h.index = df1h.index.tz_localize(None)

df4h = df1h.resample("4h").agg({
    "Open": "first",
    "High": "max",
    "Low": "min",
    "Close": "last",
    "Volume": "sum",
}).dropna()

# ── 2) Get daily data for the earlier period (before 1h starts) ──
df_daily = tk.history(period="3y", interval="1d")
df_daily.index = df_daily.index.tz_localize(None)

cutoff = df4h.index[0]
df_early = df_daily[df_daily.index < cutoff].copy()

# Daily bars for the early period
early_records = []
for ts, row in df_early.iterrows():
    early_records.append({
        "date": ts.strftime("%Y-%m-%d %H:%M:%S"),
        "open": round(float(row["Open"]), 4),
        "high": round(float(row["High"]), 4),
        "low": round(float(row["Low"]), 4),
        "close": round(float(row["Close"]), 4),
        "volume": int(row["Volume"]),
    })

# 4h bars from hourly resampling
h4_records = []
for ts, row in df4h.iterrows():
    h4_records.append({
        "date": ts.strftime("%Y-%m-%d %H:%M:%S"),
        "open": round(float(row["Open"]), 4),
        "high": round(float(row["High"]), 4),
        "low": round(float(row["Low"]), 4),
        "close": round(float(row["Close"]), 4),
        "volume": int(row["Volume"]),
    })

all_records = early_records + h4_records
cutoff_str = cutoff.strftime("%Y-%m-%d")

result = {
    "symbol": sym,
    "name": name,
    "market": "MY",
    "interval": "4h",
    "note": f"Daily bars before {cutoff_str}, then 4h bars from hourly resampling",
    "total_bars": len(all_records),
    "date_range": {
        "from": all_records[0]["date"],
        "to": all_records[-1]["date"],
    },
    "data": all_records,
}

out_path = f"klse_{code}_4h.json"
with open(out_path, "w", encoding="utf-8") as f:
    json.dump(result, f, indent=2)

print(f"Done! {len(early_records)} daily bars + {len(h4_records)} 4h bars = {len(all_records)} total")
print(f"Range: {all_records[0]['date']} -> {all_records[-1]['date']}")
print(f"Saved to {out_path}")
