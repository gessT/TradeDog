"""
Analyze 5min backtest losses — find common patterns and recommend fixes.
"""
import sys, os
sys.path.insert(0, os.path.dirname(__file__))

import pandas as pd
import numpy as np
from mgc_trading.backtest_5min import Backtester5Min, Trade5Min
from mgc_trading.strategy_5min import MGCStrategy5Min, DEFAULT_5MIN_PARAMS

# Fetch data same way as the API
import yfinance as yf
from datetime import datetime, timedelta

SYMBOL = "MGC=F"
PERIOD = "60d"

print(f"Fetching {SYMBOL} 5min data ({PERIOD})...")
df = yf.download(SYMBOL, period=PERIOD, interval="5m", progress=False)
if hasattr(df.columns, 'droplevel'):
    try:
        df.columns = df.columns.droplevel(1)
    except Exception:
        pass
df.columns = [c.lower() for c in df.columns]
print(f"  Got {len(df)} bars from {df.index[0]} to {df.index[-1]}")

# Run backtest with default params
bt = Backtester5Min()
result = bt.run(df, skip_counter_trend=True)
trades = result.trades

print(f"\n{'='*70}")
print(f"TOTAL TRADES: {len(trades)}")
losses = [t for t in trades if t.pnl < 0]
wins = [t for t in trades if t.pnl > 0]
print(f"WINS: {len(wins)} ({len(wins)/len(trades)*100:.1f}%)  |  LOSSES: {len(losses)} ({len(losses)/len(trades)*100:.1f}%)")
print(f"Total P&L: ${sum(t.pnl for t in trades):.2f}")
print(f"Avg Win: ${np.mean([t.pnl for t in wins]):.2f}" if wins else "No wins")
print(f"Avg Loss: ${np.mean([t.pnl for t in losses]):.2f}" if losses else "No losses")
print(f"{'='*70}")

if not losses:
    print("No losses found!")
    sys.exit(0)

# ── 1. Loss by Exit Reason ──
print(f"\n── LOSSES BY EXIT REASON ──")
reason_map = {}
for t in losses:
    reason_map.setdefault(t.reason, []).append(t)
for reason, tlist in sorted(reason_map.items(), key=lambda x: sum(t.pnl for t in x[1])):
    avg_loss = np.mean([t.pnl for t in tlist])
    total_loss = sum(t.pnl for t in tlist)
    print(f"  {reason:12s}: {len(tlist):3d} trades  avg=${avg_loss:+.2f}  total=${total_loss:+.2f}")

# ── 2. Loss by Direction ──
print(f"\n── LOSSES BY DIRECTION ──")
for d in ["CALL", "PUT"]:
    dl = [t for t in losses if t.direction == d]
    if dl:
        print(f"  {d:6s}: {len(dl):3d} losses  total=${sum(t.pnl for t in dl):+.2f}  avg=${np.mean([t.pnl for t in dl]):+.2f}")
    dw = [t for t in wins if t.direction == d]
    if dw:
        print(f"  {d:6s}: {len(dw):3d} wins    total=${sum(t.pnl for t in dw):+.2f}  avg=${np.mean([t.pnl for t in dw]):+.2f}")

# ── 3. Loss by Signal Type ──
print(f"\n── LOSSES BY SIGNAL TYPE ──")
for st in ["PULLBACK", "BREAKOUT"]:
    sl = [t for t in losses if t.signal_type == st]
    sw = [t for t in wins if t.signal_type == st]
    if sl or sw:
        total_l = sum(t.pnl for t in sl) if sl else 0
        total_w = sum(t.pnl for t in sw) if sw else 0
        cnt_l = len(sl)
        cnt_w = len(sw)
        wr = cnt_w / (cnt_w + cnt_l) * 100 if (cnt_w + cnt_l) > 0 else 0
        print(f"  {st:12s}: {cnt_w}W/{cnt_l}L (WR {wr:.0f}%)  net=${total_w + total_l:+.2f}")

# ── 4. Loss by Market Structure ──
print(f"\n── LOSSES BY MARKET STRUCTURE ──")
struct_names = {1: "BULL", -1: "BEAR", 0: "FLAT"}
for ms in [1, -1, 0]:
    sl = [t for t in losses if t.mkt_structure == ms]
    sw = [t for t in wins if t.mkt_structure == ms]
    if sl or sw:
        total_l = sum(t.pnl for t in sl) if sl else 0
        total_w = sum(t.pnl for t in sw) if sw else 0
        cnt_l = len(sl)
        cnt_w = len(sw)
        wr = cnt_w / (cnt_w + cnt_l) * 100 if (cnt_w + cnt_l) > 0 else 0
        print(f"  {struct_names[ms]:6s}: {cnt_w}W/{cnt_l}L (WR {wr:.0f}%)  net=${total_w + total_l:+.2f}")

# ── 5. MAE Analysis (how bad losses get before SL hit) ──
print(f"\n── MAE ANALYSIS (Max Adverse Excursion) ──")
sl_losses = [t for t in losses if t.reason == "SL"]
if sl_losses:
    maes = [t.mae for t in sl_losses]
    print(f"  SL losses avg MAE: ${np.mean(maes):.2f}")
    print(f"  SL losses median MAE: ${np.median(maes):.2f}")
    # How many SL losses had MAE much worse than final loss
    risk_per = [abs(t.pnl) for t in sl_losses]
    print(f"  SL losses avg actual loss: ${np.mean(risk_per):.2f}")

# ── 6. Consecutive Loss Streaks ──
print(f"\n── CONSECUTIVE LOSS STREAKS ──")
streak = 0
max_streak = 0
streak_pnl = 0
worst_streak_pnl = 0
for t in trades:
    if t.pnl < 0:
        streak += 1
        streak_pnl += t.pnl
        if streak > max_streak:
            max_streak = streak
        if streak_pnl < worst_streak_pnl:
            worst_streak_pnl = streak_pnl
    else:
        streak = 0
        streak_pnl = 0
print(f"  Max consecutive losses: {max_streak}")
print(f"  Worst streak P&L: ${worst_streak_pnl:.2f}")

# ── 7. EOD losses — trades force-closed at end of day ──
print(f"\n── EOD (END-OF-DAY FORCE CLOSE) LOSSES ──")
eod_losses = [t for t in losses if t.reason == "EOD"]
eod_wins = [t for t in wins if t.reason == "EOD"]
eod_all = eod_losses + eod_wins
if eod_all:
    print(f"  EOD trades: {len(eod_all)} ({len(eod_wins)}W/{len(eod_losses)}L)")
    print(f"  EOD net P&L: ${sum(t.pnl for t in eod_all):+.2f}")
    if eod_losses:
        print(f"  EOD avg loss: ${np.mean([t.pnl for t in eod_losses]):.2f}")
    # Check how many EOD losses were close to TP
    close_to_tp = [t for t in eod_losses if t.tp > 0 and t.entry_price > 0]
    if close_to_tp:
        pcts = []
        for t in close_to_tp:
            d = 1 if t.direction == "CALL" else -1
            total_range = abs(t.tp - t.entry_price)
            progress = d * (t.exit_price - t.entry_price)
            if total_range > 0:
                pcts.append(progress / total_range * 100)
        if pcts:
            print(f"  EOD losses avg TP progress: {np.mean(pcts):.0f}% of the way to TP")

# ── 8. Time-of-day analysis ──
print(f"\n── LOSSES BY HOUR (Entry Time) ──")
hour_loss = {}
hour_win = {}
for t in trades:
    h = t.entry_time.hour if hasattr(t.entry_time, 'hour') else None
    if h is None:
        continue
    if t.pnl < 0:
        hour_loss.setdefault(h, []).append(t.pnl)
    else:
        hour_win.setdefault(h, []).append(t.pnl)

all_hours = sorted(set(list(hour_loss.keys()) + list(hour_win.keys())))
worst_hours = []
for h in all_hours:
    wl = hour_loss.get(h, [])
    ww = hour_win.get(h, [])
    net = sum(ww) + sum(wl)
    total = len(ww) + len(wl)
    wr = len(ww) / total * 100 if total > 0 else 0
    tag = " *** BAD" if net < -50 and wr < 45 else ""
    print(f"  {h:02d}:00  {len(ww)}W/{len(wl)}L  WR={wr:.0f}%  net=${net:+.2f}{tag}")
    if net < -50 and wr < 45:
        worst_hours.append(h)

# ── 9. Large losses (outliers) ──
print(f"\n── LARGEST LOSSES (top 10) ──")
sorted_losses = sorted(losses, key=lambda t: t.pnl)
for t in sorted_losses[:10]:
    d = t.direction
    print(f"  ${t.pnl:+.2f}  {d:5s}  {t.signal_type:10s}  {t.reason:10s}  struct={struct_names.get(t.mkt_structure,'?')}  entry={t.entry_price}  {t.entry_time}")

# ── 10. Summary Recommendations ──
print(f"\n{'='*70}")
print("RECOMMENDATIONS BASED ON ANALYSIS:")
print(f"{'='*70}")

# Check if FLAT structure is net negative
flat_trades = [t for t in trades if t.mkt_structure == 0]
flat_net = sum(t.pnl for t in flat_trades) if flat_trades else 0
if flat_net < -20:
    print(f"  [1] FLAT market entries net=${flat_net:+.2f} → SKIP FLAT entries (skip_flat=True)")

# Check EOD
eod_net = sum(t.pnl for t in eod_all) if eod_all else 0
if eod_net < -20:
    print(f"  [2] EOD force-close net=${eod_net:+.2f} → Consider time cutoff (no entries in last 2h)")

# Check BREAKOUT vs PULLBACK
for st in ["BREAKOUT", "PULLBACK"]:
    st_trades = [t for t in trades if t.signal_type == st]
    st_net = sum(t.pnl for t in st_trades) if st_trades else 0
    st_wr = sum(1 for t in st_trades if t.pnl > 0) / len(st_trades) * 100 if st_trades else 0
    if st_net < -50 and st_wr < 40:
        print(f"  [3] {st} signals net=${st_net:+.2f} WR={st_wr:.0f}% → Consider disabling {st.lower()}")

# Check worst hours
if worst_hours:
    print(f"  [4] Worst hours: {worst_hours} → Consider session filter for these hours")

# Check direction imbalance
for d in ["CALL", "PUT"]:
    d_all = [t for t in trades if t.direction == d]
    d_net = sum(t.pnl for t in d_all) if d_all else 0
    d_wr = sum(1 for t in d_all if t.pnl > 0) / len(d_all) * 100 if d_all else 0
    if d_net < -100 and d_wr < 40:
        print(f"  [5] {d} trades net=${d_net:+.2f} WR={d_wr:.0f}% → Direction may be problematic")

# SL too wide?
sl_losses_pnl = [abs(t.pnl) for t in losses if t.reason == "SL"]
tp_wins_pnl = [t.pnl for t in wins if t.reason == "TP"]
if sl_losses_pnl and tp_wins_pnl:
    avg_sl = np.mean(sl_losses_pnl)
    avg_tp = np.mean(tp_wins_pnl)
    rr = avg_tp / avg_sl if avg_sl > 0 else 0
    print(f"  [6] Risk/Reward: avg SL loss=${avg_sl:.2f}, avg TP win=${avg_tp:.2f}, R:R={rr:.2f}")
    if rr < 0.8:
        print(f"      → R:R is below 0.8 — tighten SL or widen TP")

print(f"\nDone.")
