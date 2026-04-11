"""V2 validation — full 60d with OOS split using best params."""
import pandas as pd
from strategies.futures.data_loader import load_yfinance
from strategies.futures.backtest_v2 import BacktesterV2

df = load_yfinance(symbol="MGC=F", interval="5m", period="60d")
print(f"Loaded {len(df)} bars ({str(df.index[0])[:10]} to {str(df.index[-1])[:10]})")

best_params = {
    "ema_fast": 10,
    "st_mult": 2.0,
    "atr_sl_mult": 2.0,
    "atr_tp_mult": 1.0,
    "pullback_atr_mult": 2.0,
    "min_score": 4,
    "use_trailing": False,
    "require_ema200": False,
    "require_ht": True,
    "require_st": True,
    "require_macd": False,
    "require_vol": False,
}

bt = BacktesterV2(capital=50000)

# 1) Full dataset
print("\n=== FULL 60d BACKTEST ===")
r = bt.run(df, params=best_params)
print(f"Trades={r.total_trades} WR={r.win_rate}% Ret={r.total_return_pct}% DD={r.max_drawdown_pct}% PF={r.profit_factor} RR={r.risk_reward_ratio} Sharpe={r.sharpe_ratio} Avg PnL={r.avg_pnl_pct}%")

# 2) With 30% OOS split
print("\n=== WITH 30% OOS SPLIT ===")
r2 = bt.run(df, params=best_params, oos_split=0.3)
print(f"All:  Trades={r2.total_trades} WR={r2.win_rate}% Ret={r2.total_return_pct}% DD={r2.max_drawdown_pct}% PF={r2.profit_factor}")
print(f"OOS:  trades={r2.oos_total_trades} wr={r2.oos_win_rate}% ret={r2.oos_return_pct}%")

# 3) Also try atr_tp_mult=1.5 to see if RR improves
print("\n=== TP=1.5 VARIANT ===")
params_15 = {**best_params, "atr_tp_mult": 1.5}
r3 = bt.run(df, params=params_15, oos_split=0.3)
print(f"All:  Trades={r3.total_trades} WR={r3.win_rate}% Ret={r3.total_return_pct}% DD={r3.max_drawdown_pct}% PF={r3.profit_factor} RR={r3.risk_reward_ratio}")
print(f"OOS:  trades={r3.oos_total_trades} wr={r3.oos_win_rate}% ret={r3.oos_return_pct}%")

# 4) Print trade log for full backtest
print("\n--- Last 20 trades ---")
for t in r.trades[-20:]:
    print(
        f"  {str(t.entry_time)[:16]} -> {str(t.exit_time)[:16]}  "
        f"pnl={t.pnl:+.2f} ({t.pnl_pct:+.2f}%)  reason={t.reason}  "
        f"ema={t.ema_align}  ht={t.ht_dir}  rsi={t.rsi}"
    )

print("=== TOP 10 RESULTS ===")
for i, r in enumerate(top[:10]):
    print(
        f"  {i+1}. WR={r['win_rate']}%  Ret={r['return_pct']}%  "
        f"DD={r['max_dd']}%  PF={r['pf']}  RR={r['rr']}  "
        f"Trades={r['trades']}  Sharpe={r['sharpe']}  Score={r['score']}"
    )
    print(f"     Params: {r['params']}")

print(f"\n=== BEST ===")
print(f"Win Rate:  {best.win_rate}%")
print(f"Return:    {best.total_return_pct}%")
print(f"Max DD:    {best.max_drawdown_pct}%")
print(f"Sharpe:    {best.sharpe_ratio}")
print(f"PF:        {best.profit_factor}")
print(f"RR:        {best.risk_reward_ratio}")
print(f"Trades:    {best.total_trades} (W:{best.winners} L:{best.losers})")
print(f"Avg PnL:   {best.avg_pnl_pct}%")
