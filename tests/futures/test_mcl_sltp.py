"""Quick backtest: find optimal MCL SL/TP multipliers for lower risk."""
import json
import pandas as pd
import numpy as np
from strategies.futures.strategy_5min import MGCStrategy5Min, DEFAULT_5MIN_PARAMS

# Load MCL data
with open("mcl_5min_data.json") as f:
    raw = json.load(f)
df = pd.DataFrame(raw)
df["time"] = pd.to_datetime(df["time"], utc=True)
df = df.set_index("time").sort_index()
df = df[["open", "high", "low", "close", "volume"]].astype(float)
df = df[df["volume"] > 0]
print(f"Loaded {len(df)} MCL 5min bars")

# Grid search SL/TP
results = []
for sl_m in [0.8, 1.0, 1.2, 1.5, 2.0, 2.5, 3.0]:
    for tp_m in [1.0, 1.2, 1.5, 2.0, 2.5, 3.0]:
        p = {**DEFAULT_5MIN_PARAMS, "atr_sl_mult": sl_m, "atr_tp_mult": tp_m}
        strat = MGCStrategy5Min(p)
        dfi = strat.compute_indicators(df.copy())
        signals = strat.generate_signals(dfi)

        # Simple backtest
        capital = 10000.0
        trades = []
        pos = None
        CONTRACT_SIZE = 100  # MCL

        for i in range(200, len(dfi)):
            row = dfi.iloc[i]
            price = float(row["close"])
            atr_v = float(row["atr"]) if not np.isnan(row["atr"]) else 0

            if pos is not None:
                if pos["dir"] == "CALL":
                    if price >= pos["tp"]:
                        pnl = (pos["tp"] - pos["entry"]) * CONTRACT_SIZE
                        trades.append({"won": True, "pnl": pnl})
                        capital += pnl
                        pos = None
                    elif price <= pos["sl"]:
                        pnl = (pos["sl"] - pos["entry"]) * CONTRACT_SIZE
                        trades.append({"won": False, "pnl": pnl})
                        capital += pnl
                        pos = None
                else:
                    if price <= pos["tp"]:
                        pnl = (pos["entry"] - pos["tp"]) * CONTRACT_SIZE
                        trades.append({"won": True, "pnl": pnl})
                        capital += pnl
                        pos = None
                    elif price >= pos["sl"]:
                        pnl = (pos["entry"] - pos["sl"]) * CONTRACT_SIZE
                        trades.append({"won": False, "pnl": pnl})
                        capital += pnl
                        pos = None

            if pos is None and signals.iloc[i] != 0 and atr_v > 0:
                d = "CALL" if signals.iloc[i] == 1 else "PUT"
                if d == "CALL":
                    sl = price - sl_m * atr_v
                    tp = price + tp_m * atr_v
                else:
                    sl = price + sl_m * atr_v
                    tp = price - tp_m * atr_v
                pos = {"entry": price, "sl": sl, "tp": tp, "dir": d}

        if len(trades) < 5:
            continue

        wins = sum(1 for t in trades if t["won"])
        wr = wins / len(trades) * 100
        roi = (capital - 10000) / 10000 * 100
        gross_p = sum(t["pnl"] for t in trades if t["won"])
        gross_l = abs(sum(t["pnl"] for t in trades if not t["won"]))
        pf = gross_p / gross_l if gross_l > 0 else 99

        # Max drawdown
        eq = [10000.0]
        for t in trades:
            eq.append(eq[-1] + t["pnl"])
        eq_s = pd.Series(eq)
        dd = ((eq_s - eq_s.cummax()) / eq_s.cummax() * 100).min()

        # Avg loss (the "cut loss" metric)
        avg_loss = np.mean([t["pnl"] for t in trades if not t["won"]]) if any(not t["won"] for t in trades) else 0

        results.append({
            "sl": sl_m, "tp": tp_m,
            "trades": len(trades), "wr": round(wr, 1),
            "roi": round(roi, 1), "pf": round(pf, 2),
            "dd": round(dd, 1), "avg_loss": round(avg_loss, 0),
            "final": round(capital, 0)
        })

# Sort by ROI
results.sort(key=lambda x: x["roi"], reverse=True)
print(f"\n{'SL':>4} {'TP':>4} | {'Trades':>6} {'WR%':>6} {'ROI%':>7} {'PF':>5} {'DD%':>6} {'AvgLoss$':>9}")
print("-" * 65)
for r in results[:25]:
    flag = " ✅" if 55 <= r["wr"] <= 68 and r["roi"] > 0 and r["dd"] > -10 else ""
    print(f"{r['sl']:>4} {r['tp']:>4} | {r['trades']:>6} {r['wr']:>5.1f}% {r['roi']:>6.1f}% {r['pf']:>5.2f} {r['dd']:>5.1f}% {r['avg_loss']:>8.0f}{flag}")

# Show low-risk picks specifically
print(f"\n{'='*65}")
print("LOW-RISK PICKS (WR ≥ 55%, DD > -5%, small avg loss):")
print("-" * 65)
low_risk = [r for r in results if r["wr"] >= 55 and r["dd"] > -5 and r["roi"] > 0]
low_risk.sort(key=lambda x: x["dd"], reverse=True)  # least drawdown first
for r in low_risk[:10]:
    print(f"SL={r['sl']} TP={r['tp']} | {r['trades']}T WR={r['wr']}% ROI={r['roi']}% PF={r['pf']} DD={r['dd']}% AvgLoss=${r['avg_loss']}")
