"""Fetch Greatech Technology 5-year data with 1h candles and save as JSON.

yfinance only provides ~730 days of hourly data, so:
- Daily bars for the early period (before hourly data starts)
- 1h bars from hourly data for the recent period
"""
import json
import yfinance as yf

sym = "0208.KL"
tk = yf.Ticker(sym)
info = tk.info
name = info.get("shortName", "GREATECH TECHNOLOGY")
print(f"Fetching data for {name} ({sym})...")

# ── 1) Get hourly data (max ~730 days) ──
print("Fetching hourly data...")
df1h = tk.history(period="max", interval="1h")
df1h.index = df1h.index.tz_localize(None)
print(f"  Got {len(df1h)} hourly bars, range: {df1h.index[0]} -> {df1h.index[-1]}")

# ── 2) Get daily data for 5 years ──
print("Fetching daily data (5y)...")
df_daily = tk.history(period="5y", interval="1d")
df_daily.index = df_daily.index.tz_localize(None)
print(f"  Got {len(df_daily)} daily bars, range: {df_daily.index[0]} -> {df_daily.index[-1]}")

# ── 3) Use daily bars before hourly data starts ──
cutoff = df1h.index[0]
df_early = df_daily[df_daily.index < cutoff].copy()

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

# ── 4) 1h bars from hourly data ──
h1_records = []
for ts, row in df1h.iterrows():
    h1_records.append({
        "date": ts.strftime("%Y-%m-%d %H:%M:%S"),
        "open": round(float(row["Open"]), 4),
        "high": round(float(row["High"]), 4),
        "low": round(float(row["Low"]), 4),
        "close": round(float(row["Close"]), 4),
        "volume": int(row["Volume"]),
    })

all_records = early_records + h1_records
cutoff_str = cutoff.strftime("%Y-%m-%d")

result = {
    "symbol": sym,
    "name": name,
    "market": "MY",
    "interval": "1h",
    "note": f"Daily bars before {cutoff_str}, then 1h bars from yfinance hourly data",
    "total_bars": len(all_records),
    "date_range": {
        "from": all_records[0]["date"],
        "to": all_records[-1]["date"],
    },
    "data": all_records,
}

out_path = "data/greatech_1h.json"
with open(out_path, "w", encoding="utf-8") as f:
    json.dump(result, f, indent=2)

print(f"\nDone! {len(early_records)} daily bars + {len(h1_records)} 1h bars = {len(all_records)} total")
print(f"Range: {all_records[0]['date']} -> {all_records[-1]['date']}")
print(f"Saved to {out_path}")
