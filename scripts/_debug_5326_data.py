"""Debug 5326.KL: check data dates and HT direction"""
import pandas as pd
from strategies.us_stock.tpc.backtest import TPCBacktester
from strategies.us_stock.tpc.strategy import TPCStrategy

# Check data date range 
strat = TPCStrategy()
df_w, df_d, df_1h = strat.prepare_data("5326.KL", "4Y")
print(f"Weekly data: {df_w.index[0]} -> {df_w.index[-1]} ({len(df_w)} bars)")
print(f"Daily data:  {df_d.index[0]} -> {df_d.index[-1]} ({len(df_d)} bars)")
print(f"1H data:     {df_1h.index[0]} -> {df_1h.index[-1]} ({len(df_1h)} bars)")

# Check HT direction around Feb 2025
if "ht_dir" in df_1h.columns:
    feb_data = df_1h[df_1h.index >= "2025-02-20"]
    if len(feb_data) > 0:
        print("\n=== HT direction around Feb 2025 ===")
        for idx, row in feb_data.head(20).iterrows():
            ht = row.get("ht_dir", "N/A")
            print(f"{idx}: ht_dir={ht}, close={row['close']:.2f}")
    else:
        print("\nNo data >= 2025-02-20")
        print(f"Last 5 dates in 1H: {list(df_1h.index[-5:])}")
else:
    print("\nNo ht_dir column in 1H data")
    print(f"Columns: {list(df_1h.columns)}")
