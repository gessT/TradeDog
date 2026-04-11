"""Quick A/B test: baseline vs loss-reduction filters."""
import sys, os
sys.path.insert(0, os.path.dirname(__file__))

import numpy as np
import yfinance as yf
from strategies.futures.backtest_5min import Backtester5Min

SYMBOL = "MGC=F"
print(f"Fetching {SYMBOL} 5min data (60d)...")
df = yf.download(SYMBOL, period="60d", interval="5m", progress=False)
if hasattr(df.columns, 'droplevel'):
    try: df.columns = df.columns.droplevel(1)
    except: pass
df.columns = [c.lower() for c in df.columns]
print(f"  Got {len(df)} bars\n")

bt = Backtester5Min()

def report(label, r):
    t = r.trades
    w = sum(1 for x in t if x.pnl > 0)
    l = sum(1 for x in t if x.pnl < 0)
    pnl = sum(x.pnl for x in t)
    wr = w / len(t) * 100 if t else 0
    big = sum(1 for x in t if x.pnl < -500)
    avg_l = np.mean([x.pnl for x in t if x.pnl < 0]) if l > 0 else 0
    avg_w = np.mean([x.pnl for x in t if x.pnl > 0]) if w > 0 else 0
    rr = avg_w / abs(avg_l) if avg_l != 0 else 0
    print(f"  {label:<40s} {len(t):>4d} trades  {wr:>5.1f}% WR  {w}W/{l}L  ${pnl:>+10.2f}  DD={r.max_drawdown_pct:.1f}%  R:R={rr:.2f}  AvgL=${avg_l:.0f}  >$500={big}")

# A: Baseline
print("── A: Baseline ──")
rA = bt.run(df, skip_counter_trend=True)
report("Baseline", rA)

# B: Skip hours only
print("\n── B: Skip bad hours (4,16 UTC) ──")
rB = bt.run(df, skip_counter_trend=True, skip_hours={4, 16})
report("Skip hours 4,16", rB)

# C: Skip hours + max_loss 500
print("\n── C: Skip hours + Max Loss $500 ──")
rC = bt.run(df, skip_counter_trend=True, skip_hours={4, 16}, max_loss_per_trade=500)
report("Skip hours + MaxLoss $500", rC)

# D: Higher ATR min threshold (skip very low vol entries)
print("\n── D: Skip hours + Tighter min_atr_pct 0.05 ──")
rD = bt.run(df, params={"min_atr_pct": 0.05}, skip_counter_trend=True, skip_hours={4, 16})
report("Skip hours + min_atr 0.05", rD)

# E: skip_flat + skip_hours
print("\n── E: Skip flat + Skip hours ──")
rE = bt.run(df, skip_counter_trend=True, skip_flat=True, skip_hours={4, 16})
report("Skip flat + Skip hours", rE)

# F: skip_hours + skip_flat + max_loss 500
print("\n── F: Skip flat + Skip hours + MaxLoss $500 ──")
rF = bt.run(df, skip_counter_trend=True, skip_flat=True, skip_hours={4, 16}, max_loss_per_trade=500)
report("Skip flat + hours + MaxLoss500", rF)

print(f"\nBaseline P&L: ${sum(t.pnl for t in rA.trades):.2f}")
for lbl, r in [("B: Skip hours", rB), ("C: +MaxLoss500", rC), ("D: +min_atr", rD), ("E: +skip_flat", rE), ("F: flat+hrs+ML500", rF)]:
    delta = sum(t.pnl for t in r.trades) - sum(t.pnl for t in rA.trades)
    print(f"  {lbl}: delta ${delta:+.2f}")
