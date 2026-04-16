"""Debug 5326.KL backtest"""
from strategies.us_stock.tpc.backtest import TPCBacktester

bt = TPCBacktester(capital=10000)

# Default run (all exits enabled)
result = bt.run("5326.KL", "4Y")
print("=== DEFAULT (all exits enabled) ===")
for t in result.trades:
    print(f"Entry: {t.entry_time}, Exit: {t.exit_time}, Reason: {t.reason}, PnL: {t.pnl}")
print(f"Total trades: {result.total_trades}, Win rate: {result.win_rate}%")

# Only HT_FLIP exit
print("\n=== ONLY HT_FLIP exit ===")
result2 = bt.run("5326.KL", "4Y", disabled_conditions={
    "sl_exit", "tp1_exit", "tp2_exit", "trail_exit", "wst_flip_exit", "ema28_break_exit"
})
for t in result2.trades:
    print(f"Entry: {t.entry_time}, Exit: {t.exit_time}, Reason: {t.reason}, PnL: {t.pnl}")
print(f"Total trades: {result2.total_trades}, Win rate: {result2.win_rate}%")
