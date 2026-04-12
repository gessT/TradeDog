"""Final TPC strategy backtest report with optimized parameters."""
from strategies.us_stock.tpc.backtest import TPCBacktester
from strategies.futures.data_loader import load_yfinance
import logging

logging.basicConfig(level=logging.WARNING)

symbols = ["NVDA", "AAPL", "MSFT", "TSLA", "META", "AMZN", "GOOGL", "AMD", "PLTR", "COIN"]

print("=" * 85)
print("TPC STRATEGY — FINAL BACKTEST REPORT (Optimized Parameters)")
print("Weekly SuperTrend + EMA200 + ADX + HalfTrend Pullback → 1H Entry")
print("SL=2.0xATR | TP1=1.0R (50%) | TP2=2.5R | Trailing 2.5xATR | Capital=$5000 | Risk=3%")
print("=" * 85)

header = f"{'Symbol':<8} {'WR%':>6} {'ROI%':>8} {'PF':>6} {'RR':>6} {'DD%':>6} {'Sharpe':>7} {'Trades':>7} {'AvgWin':>8} {'AvgLoss':>8}"
print(header)
print("-" * 85)

tw = tl = 0
total_roi = 0.0
max_dd_all = 0.0

for sym in symbols:
    df_w = load_yfinance(sym, "1wk", "5y")
    df_d = load_yfinance(sym, "1d", "5y")
    df_h = load_yfinance(sym, "1h", "730d")
    bt = TPCBacktester(capital=5000, risk_per_trade=0.03)
    r = bt.run(symbol=sym, period="2y", df_weekly=df_w, df_daily=df_d, df_1h=df_h)

    tw += r.winners
    tl += r.losers
    total_roi += r.total_return_pct
    max_dd_all = max(max_dd_all, r.max_drawdown_pct)

    pf = f"{r.profit_factor:.2f}" if r.profit_factor < 900 else "inf"
    rr = f"{r.risk_reward_ratio:.2f}" if r.risk_reward_ratio < 900 else "inf"
    print(f"{sym:<8} {r.win_rate:>5.1f}% {r.total_return_pct:>7.1f}% {pf:>6} {rr:>6} {r.max_drawdown_pct:>5.1f}% {r.sharpe_ratio:>7.2f} {r.total_trades:>7} {r.avg_win:>8.2f} {r.avg_loss:>8.2f}")

    # Exit breakdown
    reasons = {}
    for t in r.trades:
        reasons[t.reason] = reasons.get(t.reason, 0) + 1
    print(f"         exits: {reasons}")

tt = tw + tl
wr = tw / tt * 100 if tt else 0
avg_roi = total_roi / len(symbols)

print("=" * 85)
print(f"AGGREGATE: {tw}/{tt} = {wr:.1f}% WR | Avg ROI = {avg_roi:.1f}% | Max DD = {max_dd_all:.1f}%")
print(f"Trades/stock avg = {tt / len(symbols):.1f}")
print("=" * 85)
