"""Test TradingView symbol matching with our BURSA codes."""
import requests

payload = {
    "columns": ["close", "change", "Perf.W", "Perf.1M", "name", "description", "SMA5", "SMA20"],
    "filter": [{"left": "type", "operation": "equal", "right": "stock"}],
    "sort": {"sortBy": "market_cap_basic", "sortOrder": "desc"},
    "range": [0, 500],
}
resp = requests.post("https://scanner.tradingview.com/malaysia/scan", json=payload, timeout=30)
data = resp.json()
rows = data.get("data", [])

# Build lookup by TV ticker name
tv_by_name = {}
for row in rows:
    sym = row["s"]
    ticker = sym.split(":")[-1] if ":" in sym else sym
    vals = row["d"]
    desc = vals[5] or ""
    tv_by_name[ticker] = desc

# Our stock names to find
our_stocks = {
    "1155.KL": "Maybank", "1295.KL": "Public Bank", "1023.KL": "CIMB",
    "5819.KL": "Hong Leong Bank", "1066.KL": "RHB Bank", "1082.KL": "Hong Leong Financial",
    "1015.KL": "Ambank", "5185.KL": "AFFIN Bank", "1163.KL": "Allianz Malaysia",
    "1818.KL": "Bursa Malaysia",
    "4707.KL": "Nestle", "7052.KL": "Padini", "6599.KL": "AEON",
    "5296.KL": "MR DIY", "4065.KL": "PPB Group", "3026.KL": "Dutch Lady",
    "3255.KL": "Heineken", "3689.KL": "Fraser & Neave", "7084.KL": "QL Resources",
    "3182.KL": "Genting Bhd", "4715.KL": "Genting Malaysia",
    "1562.KL": "Sports Toto", "5248.KL": "Bermaz Auto",
    "3816.KL": "MISC", "5099.KL": "Capital A", "5246.KL": "Westports",
    "5983.KL": "MBM Resources",
    "4863.KL": "Telekom Malaysia", "6012.KL": "Maxis", "6947.KL": "CelcomDigi",
    "6888.KL": "Axiata", "0138.KL": "MyEG",
    "8869.KL": "Press Metal", "4197.KL": "Sime Darby", "5168.KL": "Hartalega",
    "7113.KL": "Top Glove", "7153.KL": "Kossan", "3867.KL": "MPI",
    "5347.KL": "Tenaga Nasional",
    "5225.KL": "IHH Healthcare", "5878.KL": "KPJ Healthcare", "7081.KL": "Duopharma",
    "5398.KL": "Gamuda", "1171.KL": "Sunway", "3336.KL": "IJM Corp",
    "5263.KL": "Sunway Construction", "9679.KL": "WCT Holdings",
    "5235SS.KL": "KLCC Property", "1651.KL": "MRCB",
    "4677.KL": "YTL Corp", "5148.KL": "UEM Sunrise", "8664.KL": "SP Setia",
    "5053.KL": "OSK Holdings", "8583.KL": "Mah Sing",
    "0166.KL": "Inari Amertron", "0097.KL": "ViTrox", "0128.KL": "Frontken",
    "0208.KL": "Greatech", "5005.KL": "Unisem",
    "2445.KL": "KLK", "5285.KL": "SD Guthrie", "1961.KL": "IOI Corp",
    "2291.KL": "Genting Plantations", "5126.KL": "Sarawak Oil Palms",
    "1899.KL": "Batu Kawan", "3034.KL": "Hap Seng",
    "5183.KL": "Petronas Chemicals", "5681.KL": "Petronas Dagangan",
    "6033.KL": "Petronas Gas", "5209.KL": "Gas Malaysia",
    "6742.KL": "YTL Power", "5264.KL": "Malakoff", "3069.KL": "Mega First",
    "5176.KL": "Sunway REIT", "5227.KL": "IGB REIT",
    "5212.KL": "Pavilion REIT", "5106.KL": "Axis REIT",
}

# Print ALL TV tickers for manual mapping
print(f"Total TV stocks: {len(rows)}")
print("\n=== All TV tickers ===")
for ticker in sorted(tv_by_name.keys()):
    print(f"  {ticker:15s} = {tv_by_name[ticker][:50]}")


# Build lookup of TV symbols
tv_map = {}
for row in rows:
    sym = row["s"]
    num = sym.split(":")[-1] if ":" in sym else sym
    vals = row["d"]
    tv_map[num] = {
        "close": vals[0], "change": vals[1],
        "perf_w": vals[2], "perf_1m": vals[3],
        "name": vals[4], "sma5": vals[6], "sma20": vals[7],
    }

# Our stock codes
our_codes = [
    "1155", "1295", "1023", "5819", "4707", "7052", "5296",
    "8869", "5225", "5398", "0166", "0097", "2445", "5285",
    "5183", "6742", "5176", "5235SS", "4863", "6012",
    "3816", "5099", "6947", "6888", "0138", "4197", "5168",
    "7113", "7153", "3867", "5347", "5878", "7081", "1171",
    "3336", "5263", "9679", "1651", "4677", "5148", "8664",
    "5053", "8583", "0128", "0208", "5005", "1961", "2291",
    "5126", "1899", "3034", "5681", "6033", "5209", "5264",
    "3069", "5227", "5212", "5106",
    "1066", "1082", "1015", "5185", "1163", "1818",
    "4065", "3026", "3255", "3689", "3182", "4715", "7084", "1562", "5248",
    "5983", "6599",
]

print(f"Total TV stocks: {len(rows)}")

# Print first 30 symbols to see the format
print("\n=== Sample TV symbols ===")
for row in rows[:30]:
    sym = row["s"]
    num = sym.split(":")[-1] if ":" in sym else sym
    vals = row["d"]
    name = vals[4] or ""
    print(f"  {sym:25s}  num={num:15s}  name={str(name)[:30]}")

found = 0
missing = []
for code in our_codes:
    if code in tv_map:
        found += 1
        d = tv_map[code]
        pw = (d["perf_w"] or 0) * 100
        pm = (d["perf_1m"] or 0) * 100
        sma5 = d["sma5"] or 0
        sma20 = d["sma20"] or 0
        trend = "BULL" if sma5 > sma20 else "BEAR"
        print(f"  {code:8s} OK  {str(d['name'])[:25]:25s}  1D={d['change'] or 0:>+.2f}%  W={pw:>+.2f}%  1M={pm:>+.2f}%  {trend}")
    else:
        missing.append(code)

print(f"\nFound: {found}/{len(our_codes)}")
if missing:
    print(f"Missing: {missing}")
