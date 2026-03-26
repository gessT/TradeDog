"""Find all our stocks' TradingView ticker names."""
import requests

# Request a large range to get everything
payload = {
    "columns": ["close", "change", "Perf.W", "Perf.1M", "name", "description", "SMA5", "SMA20"],
    "filter": [{"left": "type", "operation": "in_range", "right": ["stock", "fund"]}],
    "sort": {"sortBy": "market_cap_basic", "sortOrder": "desc"},
    "range": [0, 1500],
}
resp = requests.post("https://scanner.tradingview.com/malaysia/scan", json=payload, timeout=30)
data = resp.json()
rows = data.get("data", [])
print(f"Total: {len(rows)}")

# Build description lookup
tv_desc = {}
for row in rows:
    ticker = row["s"].split(":")[-1]
    desc = (row["d"][5] or "").lower()
    tv_desc[ticker] = desc

# Search for our stocks by keyword
search_terms = {
    "MYEG": "myeg", "KLCC": "klcc", "SUNREIT": "sunway reit", "IGBREIT": "igb reit",
    "PAVREIT": "pavilion", "AXREIT": "axis", "SWKPLNT": "sarawak",
}

for keyword in ["myeg", "klcc", "sunway reit", "igb reit", "pavilion reit", "axis reit",
                 "sarawak plant", "sarawak oil", "hap seng", "mega first"]:
    matches = [(t, d) for t, d in tv_desc.items() if keyword in d]
    print(f"\n'{keyword}': {len(matches)} matches")
    for t, d in matches[:5]:
        print(f"  {t:15s} = {d[:60]}")

# Also search for all REIT type
print("\n=== Stocks with 'reit' in name ===")
for t, d in sorted(tv_desc.items()):
    if "reit" in d or "reit" in t.lower():
        print(f"  {t:15s} = {d[:60]}")
