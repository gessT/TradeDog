"""Test new cut-loss conditions vs baseline."""
import yfinance as yf
from mgc_trading.backtest_5min import Backtester5Min
from mgc_trading.strategy_5min import DEFAULT_5MIN_PARAMS

df = yf.download("MGC=F", period="60d", interval="5m", auto_adjust=True)
df.columns = [c[0].lower() if isinstance(c, tuple) else c.lower() for c in df.columns]

results = []

def run_test(label, params, disabled=None, skip_flat=False, skip_counter_trend=False):
    bt = Backtester5Min()
    r = bt.run(df, params=params, oos_split=0.3, disabled_conditions=disabled,
               skip_flat=skip_flat, skip_counter_trend=skip_counter_trend)
    line = (f"{label:50s} | T={r.total_trades:3d} WR={r.win_rate:5.1f}% "
            f"Ret={r.total_return_pct:7.2f}% PF={r.profit_factor:5.2f} "
            f"DD={r.max_drawdown_pct:5.2f}% | OOS: T={r.oos_total_trades:3d} "
            f"WR={r.oos_win_rate:5.1f}% Ret={r.oos_return_pct:7.2f}%")
    print(line)
    results.append({"label": label, "trades": r.total_trades, "wr": r.win_rate,
                     "ret": r.total_return_pct, "pf": r.profit_factor,
                     "dd": r.max_drawdown_pct, "oos_t": r.oos_total_trades,
                     "oos_wr": r.oos_win_rate, "oos_ret": r.oos_return_pct})
    return r

print("=" * 140)
print(f"{'CONDITION':50s} | {'IS (In-Sample)':43s} | {'OOS (Out-of-Sample)'}")
print("=" * 140)

# ── BASELINE ──
run_test("BASELINE (current)", DEFAULT_5MIN_PARAMS)

print("-" * 140)
print("── SINGLE FILTERS ──")

# 1. Skip counter-trend (CALL in BEAR, PUT in BULL)
run_test("+ no_counter_trend", DEFAULT_5MIN_PARAMS, skip_counter_trend=True)

# 2. Skip flat/sideways
run_test("+ skip_flat", DEFAULT_5MIN_PARAMS, skip_flat=True)

# 3. ADX >= 20
run_test("+ ADX>=20", {**DEFAULT_5MIN_PARAMS, "adx_min": 20})

# 4. ADX >= 25
run_test("+ ADX>=25", {**DEFAULT_5MIN_PARAMS, "adx_min": 25})

# 5. Volume >= 1.0x
run_test("+ vol>=1.0x", {**DEFAULT_5MIN_PARAMS, "vol_spike_mult": 1.0})

# 6. Volume >= 1.3x
run_test("+ vol>=1.3x", {**DEFAULT_5MIN_PARAMS, "vol_spike_mult": 1.3})

print("-" * 140)
print("── COMBO 2 FILTERS ──")

# 7. no_counter_trend + skip_flat
run_test("+ no_counter + skip_flat", DEFAULT_5MIN_PARAMS,
         skip_flat=True, skip_counter_trend=True)

# 8. no_counter_trend + ADX>=25
run_test("+ no_counter + ADX>=25", {**DEFAULT_5MIN_PARAMS, "adx_min": 25},
         skip_counter_trend=True)

# 9. no_counter_trend + vol>=1.0x
run_test("+ no_counter + vol>=1.0x", {**DEFAULT_5MIN_PARAMS, "vol_spike_mult": 1.0},
         skip_counter_trend=True)

# 10. skip_flat + ADX>=25
run_test("+ skip_flat + ADX>=25", {**DEFAULT_5MIN_PARAMS, "adx_min": 25},
         skip_flat=True)

# 11. ADX>=20 + vol>=1.0x
run_test("+ ADX>=20 + vol>=1.0x", {**DEFAULT_5MIN_PARAMS, "adx_min": 20, "vol_spike_mult": 1.0})

print("-" * 140)
print("── COMBO 3 FILTERS (best candidates) ──")

# 12. no_counter + skip_flat + ADX>=25
run_test("+ no_counter + skip_flat + ADX>=25",
         {**DEFAULT_5MIN_PARAMS, "adx_min": 25},
         skip_flat=True, skip_counter_trend=True)

# 13. no_counter + ADX>=25 + vol>=1.0x
run_test("+ no_counter + ADX>=25 + vol>=1.0x",
         {**DEFAULT_5MIN_PARAMS, "adx_min": 25, "vol_spike_mult": 1.0},
         skip_counter_trend=True)

# 14. no_counter + skip_flat + ADX>=20
run_test("+ no_counter + skip_flat + ADX>=20",
         {**DEFAULT_5MIN_PARAMS, "adx_min": 20},
         skip_flat=True, skip_counter_trend=True)

# 15. no_counter + skip_flat + vol>=1.0x
run_test("+ no_counter + skip_flat + vol>=1.0x",
         {**DEFAULT_5MIN_PARAMS, "vol_spike_mult": 1.0},
         skip_flat=True, skip_counter_trend=True)

print("-" * 140)
print("── COMBO 4 FILTERS (maximum filter) ──")

# 16. ALL: no_counter + skip_flat + ADX>=25 + vol>=1.0x
run_test("+ ALL: no_counter + flat + ADX25 + vol1.0",
         {**DEFAULT_5MIN_PARAMS, "adx_min": 25, "vol_spike_mult": 1.0},
         skip_flat=True, skip_counter_trend=True)

# 17. ALL with ADX20
run_test("+ ALL: no_counter + flat + ADX20 + vol1.0",
         {**DEFAULT_5MIN_PARAMS, "adx_min": 20, "vol_spike_mult": 1.0},
         skip_flat=True, skip_counter_trend=True)

print("\n" + "=" * 140)

# ── Summary: rank by OOS win rate × profit factor ──
print("\n── RANKING (by OOS WR x PF, min 50 trades) ──")
valid = [r for r in results if r["trades"] >= 50]
valid.sort(key=lambda x: x["oos_wr"] * x["pf"], reverse=True)
for i, r in enumerate(valid[:10], 1):
    score = r["oos_wr"] * r["pf"]
    print(f"  {i}. {r['label']:50s} Score={score:7.1f}  WR={r['wr']:.1f}%  PF={r['pf']:.2f}  OOS_WR={r['oos_wr']:.1f}%  Ret={r['ret']:.1f}%  DD={r['dd']:.1f}%")
