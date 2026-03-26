"""Test TradingView scanner API directly for sector data."""
import json
import requests

URL = "https://scanner.tradingview.com/malaysia/scan"

# First: Get ALL Malaysia stocks with their sector classification from TradingView
fields = ["close", "change", "Perf.W", "Perf.1M", "name", "sector", "description", "type"]

payload = {
    "columns": fields,
    "filter": [{"left": "type", "operation": "equal", "right": "stock"}],
    "sort": {"sortBy": "market_cap_basic", "sortOrder": "desc"},
    "range": [0, 200],
}

print("Requesting all Malaysia stocks from TradingView scanner API...")
resp = requests.post(URL, json=payload, headers={"Content-Type": "application/json"}, timeout=30)
print(f"Status: {resp.status_code}")

if resp.status_code != 200:
    print(f"Error: {resp.text[:500]}")
    exit(1)

data = resp.json()
rows = data.get("data", [])
print(f"Got {len(rows)} results\n")

# Print first 20 to see the data shape
from collections import defaultdict
sector_stocks = defaultdict(list)

for row in rows:
    sym = row["s"]
    vals = row["d"]
    close = vals[0] or 0
    change_1d = vals[1] or 0
    perf_w = vals[2] or 0
    perf_1m = vals[3] or 0
    name = vals[4] or ""
    sector = vals[5] or "Unknown"
    desc = vals[6] or ""
    stock_type = vals[7] or ""
    
    sector_stocks[sector].append({
        "symbol": sym,
        "name": name,
        "desc": desc,
        "close": close,
        "change_1d": change_1d,
        "perf_w": perf_w,
        "perf_1m": perf_1m,
    })

# Print all sectors found
print("=== TradingView Sectors Found ===")
for sector in sorted(sector_stocks.keys(), key=lambda x: -len(sector_stocks[x])):
    stocks = sector_stocks[sector]
    n = len(stocks)
    if n == 0:
        continue
    avg_1d = sum(s["change_1d"] for s in stocks) / n
    avg_w = sum(s["perf_w"] for s in stocks) / n
    avg_1m = sum(s["perf_1m"] for s in stocks) / n
    print(f"\n{sector} ({n} stocks)  1D={avg_1d:>+.2f}%  W={avg_w:>+.2f}%  1M={avg_1m:>+.2f}%")
    for s in stocks[:5]:
        print(f"  {s['symbol']:14s} {s['name']:20s}  1D={s['change_1d']:>+.2f}%  W={s['perf_w']:>+.2f}%")

