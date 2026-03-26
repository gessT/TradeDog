"""Test the new TradingView-based sector endpoint."""
import requests as http_requests

TRADINGVIEW_SCANNER_URL = "https://scanner.tradingview.com/malaysia/scan"

YF_TO_TV = {
    "1155.KL": "MAYBANK", "1295.KL": "PBBANK", "1023.KL": "CIMB",
    "5819.KL": "HLBANK", "1066.KL": "RHBBANK", "1082.KL": "HLFG",
    "1015.KL": "AMBANK", "5185.KL": "AFFIN", "1163.KL": "ALLIANZ",
    "1818.KL": "BURSA",
    "4707.KL": "NESTLE", "7052.KL": "PADINI", "6599.KL": "AEON",
    "5296.KL": "MRDIY", "4065.KL": "PPB", "3026.KL": "DLADY",
    "3255.KL": "HEIM", "3689.KL": "F&N", "7084.KL": "QL",
    "3182.KL": "GENTING", "4715.KL": "GENM", "1562.KL": "SPTOTO",
    "5248.KL": "BAUTO",
    "3816.KL": "MISC", "5099.KL": "CAPITALA", "5246.KL": "WPRTS",
    "5983.KL": "MBMR",
    "4863.KL": "TM", "6012.KL": "MAXIS", "6947.KL": "CDB",
    "6888.KL": "AXIATA", "0138.KL": "MYEG",
    "8869.KL": "PMETAL", "4197.KL": "SIME", "5168.KL": "HARTA",
    "7113.KL": "TOPGLOV", "7153.KL": "KOSSAN", "3867.KL": "MPI",
    "5347.KL": "TENAGA",
    "5225.KL": "IHH", "5878.KL": "KPJ", "7081.KL": "DPHARMA",
    "5398.KL": "GAMUDA", "1171.KL": "SUNWAY", "3336.KL": "IJM",
    "5263.KL": "SUNCON", "9679.KL": "WCT",
    "5235SS.KL": "KLCC", "1651.KL": "MRCB", "4677.KL": "YTL",
    "5148.KL": "UEMS", "8664.KL": "SPSETIA", "5053.KL": "OSK",
    "8583.KL": "MAHSING",
    "0166.KL": "INARI", "0097.KL": "VITROX", "0128.KL": "FRONTKN",
    "0208.KL": "GREATEC", "5005.KL": "UNISEM",
    "2445.KL": "KLK", "5285.KL": "SDG", "1961.KL": "IOICORP",
    "2291.KL": "GENP", "5126.KL": "SOP", "1899.KL": "BKAWAN",
    "3034.KL": "HAPSENG",
    "5183.KL": "PCHEM", "5681.KL": "PETDAG", "6033.KL": "PETGAS",
    "5209.KL": "GASMSIA",
    "6742.KL": "YTLPOWR", "5264.KL": "MALAKOF", "3069.KL": "MFCB",
    "5176.KL": "SUNREIT", "5227.KL": "IGBREIT", "5212.KL": "PAVREIT",
    "5106.KL": "AXREIT",
}
TV_TO_YF = {v: k for k, v in YF_TO_TV.items()}

# Simulate BURSA_SECTORS
BURSA_SECTORS = {
    "FINANCE": [
        ("1155.KL", "Maybank"), ("1295.KL", "Public Bank"), ("1023.KL", "CIMB"),
        ("5819.KL", "Hong Leong Bank"), ("1066.KL", "RHB Bank"),
        ("1082.KL", "Hong Leong Financial"), ("1015.KL", "Ambank"),
        ("5185.KL", "AFFIN Bank"), ("1163.KL", "Allianz Malaysia"),
        ("1818.KL", "Bursa Malaysia"),
    ],
    "ENERGY": [
        ("5183.KL", "Petronas Chemicals"), ("5681.KL", "Petronas Dagangan"),
        ("6033.KL", "Petronas Gas"), ("5209.KL", "Gas Malaysia"),
    ],
    "TECHNOLOGY": [
        ("0166.KL", "Inari Amertron"), ("0097.KL", "ViTrox"),
        ("0128.KL", "Frontken"), ("0208.KL", "Greatech"),
        ("5005.KL", "Unisem"),
    ],
}

# Build lookup
tv_lookup = {}
for sector, stocks_list in BURSA_SECTORS.items():
    for yf_code, name in stocks_list:
        tv_ticker = YF_TO_TV.get(yf_code)
        if tv_ticker:
            tv_lookup[tv_ticker] = (sector, yf_code, name)

# Fetch from TradingView
tv_tickers = [f"MYX:{tv}" for tv in YF_TO_TV.values()]
payload = {
    "columns": ["close", "change", "Perf.W", "Perf.1M", "name", "description", "SMA5", "SMA20"],
    "symbols": {"tickers": tv_tickers},
}
resp = http_requests.post(TRADINGVIEW_SCANNER_URL, json=payload, timeout=30)
rows = resp.json().get("data", [])
print(f"Got {len(rows)} stocks from TradingView\n")

for row in rows:
    tv_sym = row["s"]
    tv_ticker = tv_sym.split(":")[-1]
    if tv_ticker not in tv_lookup:
        continue
    sector, yf_code, stock_name = tv_lookup[tv_ticker]
    vals = row["d"]
    close = vals[0] or 0
    change_1d = vals[1] or 0
    perf_w = vals[2] or 0
    perf_1m = vals[3] or 0
    sma5 = vals[6] or 0
    sma20 = vals[7] or 0
    trend = "BULL" if sma5 and sma20 and sma5 > sma20 else "BEAR"
    print(f"  [{sector:12s}] {yf_code:12s} {stock_name:25s}  1D={change_1d:>+7.2f}%  W={perf_w:>+7.2f}%  1M={perf_1m:>+8.2f}%  {trend}")
