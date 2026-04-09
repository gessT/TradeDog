"""Analyze losing trades to find cut-loss conditions."""
import yfinance as yf
from mgc_trading.backtest_5min import Backtester5Min
from mgc_trading.strategy_5min import MGCStrategy5Min, DEFAULT_5MIN_PARAMS

# Fetch data
df = yf.download("MGC=F", period="60d", interval="5m", auto_adjust=True)
df.columns = [c[0].lower() if isinstance(c, tuple) else c.lower() for c in df.columns]
print(f"Bars: {len(df)}")

# Run baseline backtest
bt = Backtester5Min()
result = bt.run(df, params=DEFAULT_5MIN_PARAMS, oos_split=0.3)

print(f"\n=== BASELINE ===")
print(f"Trades: {result.total_trades}, WR: {result.win_rate:.1f}%, Return: {result.total_return_pct:.2f}%")
print(f"Avg Win: ${result.avg_win:.2f}, Avg Loss: ${result.avg_loss:.2f}")
print(f"PF: {result.profit_factor:.2f}, Max DD: {result.max_drawdown_pct:.2f}%")
print(f"OOS: {result.oos_total_trades} trades, WR: {result.oos_win_rate:.1f}%, Ret: {result.oos_return_pct:.2f}%")

# Analyze losing trades
losers = [t for t in result.trades if t.pnl < 0]
winners = [t for t in result.trades if t.pnl >= 0]
print(f"\n=== LOSS ANALYSIS ({len(losers)} losers / {len(winners)} winners) ===")
print(f"SL losses: {sum(1 for t in losers if t.reason=='SL')}")
print(f"EOD losses: {sum(1 for t in losers if t.reason=='EOD')}")
print(f"PULLBACK losses: {sum(1 for t in losers if t.signal_type=='PULLBACK')}")
print(f"BREAKOUT losses: {sum(1 for t in losers if t.signal_type=='BREAKOUT')}")
print(f"SIDEWAYS losses: {sum(1 for t in losers if t.mkt_structure==0)}")
print(f"BULL losses: {sum(1 for t in losers if t.mkt_structure==1)}")
print(f"BEAR losses: {sum(1 for t in losers if t.mkt_structure==-1)}")

# MAE analysis
sl_losses = [t for t in losers if t.reason == "SL"]
if sl_losses:
    maes = [abs(t.mae) for t in sl_losses]
    pnls = [abs(t.pnl) for t in sl_losses]
    print(f"\nSL Losses MAE: avg=${sum(maes)/len(maes):.2f}, max=${max(maes):.2f}")
    print(f"SL Losses PNL: avg=${sum(pnls)/len(pnls):.2f}, max=${max(pnls):.2f}")

# Indicator state at entry
strat = MGCStrategy5Min(DEFAULT_5MIN_PARAMS)
df_ind = strat.compute_indicators(df[["open", "high", "low", "close", "volume"]].copy())

def get_bar_at_entry(entry_time, df_ind):
    try:
        idx = df_ind.index.get_indexer([entry_time], method="ffill")[0]
        if idx >= 1:
            return df_ind.iloc[idx - 1]
    except Exception:
        pass
    return None

print("\n=== INDICATOR STATE AT ENTRY ===")
for label, trades in [("WINNERS", winners), ("LOSERS", losers)]:
    rsis, macds, adxs = [], [], []
    for t in trades:
        bar = get_bar_at_entry(t.entry_time, df_ind)
        if bar is not None:
            rsis.append(float(bar.get("rsi", 0) or 0))
            macds.append(float(bar.get("macd_hist", 0) or 0))
            adxs.append(float(bar.get("adx", 0) or 0))
    if rsis:
        print(f"  {label}: RSI={sum(rsis)/len(rsis):.1f}, MACD_hist={sum(macds)/len(macds):.3f}, ADX={sum(adxs)/len(adxs):.1f}, n={len(rsis)}")

# CALL vs PUT
print("\n=== DIRECTION BREAKDOWN ===")
for d in ["CALL", "PUT"]:
    dt = [t for t in result.trades if t.direction == d]
    dw = [t for t in dt if t.pnl >= 0]
    wr = len(dw) / len(dt) * 100 if dt else 0
    pnl = sum(t.pnl for t in dt)
    print(f"  {d}: {len(dt)} trades, WR={wr:.1f}%, PNL=${pnl:.2f}")

# Counter-trend vs With-trend vs Sideways
print("\n=== MARKET STRUCTURE ALIGNMENT ===")
ct = [t for t in result.trades if (t.direction == "CALL" and t.mkt_structure == -1) or (t.direction == "PUT" and t.mkt_structure == 1)]
ct_w = [t for t in ct if t.pnl >= 0]
print(f"  COUNTER-TREND: {len(ct)} trades, WR={len(ct_w)/len(ct)*100 if ct else 0:.1f}%, PNL=${sum(t.pnl for t in ct):.2f}")

wt = [t for t in result.trades if (t.direction == "CALL" and t.mkt_structure == 1) or (t.direction == "PUT" and t.mkt_structure == -1)]
wt_w = [t for t in wt if t.pnl >= 0]
print(f"  WITH-TREND:    {len(wt)} trades, WR={len(wt_w)/len(wt)*100 if wt else 0:.1f}%, PNL=${sum(t.pnl for t in wt):.2f}")

sw = [t for t in result.trades if t.mkt_structure == 0]
sw_w = [t for t in sw if t.pnl >= 0]
print(f"  SIDEWAYS:      {len(sw)} trades, WR={len(sw_w)/len(sw)*100 if sw else 0:.1f}%, PNL=${sum(t.pnl for t in sw):.2f}")

# ADX threshold analysis — find if low ADX = more losses
print("\n=== ADX THRESHOLD ANALYSIS ===")
for thresh in [10, 15, 20, 25]:
    above_w, above_l, below_w, below_l = 0, 0, 0, 0
    for t in result.trades:
        bar = get_bar_at_entry(t.entry_time, df_ind)
        if bar is None:
            continue
        adx_val = float(bar.get("adx", 0) or 0)
        if adx_val >= thresh:
            if t.pnl >= 0: above_w += 1
            else: above_l += 1
        else:
            if t.pnl >= 0: below_w += 1
            else: below_l += 1
    above_total = above_w + above_l
    below_total = below_w + below_l
    above_wr = above_w / above_total * 100 if above_total > 0 else 0
    below_wr = below_w / below_total * 100 if below_total > 0 else 0
    print(f"  ADX>={thresh}: {above_total} trades, WR={above_wr:.1f}% | ADX<{thresh}: {below_total} trades, WR={below_wr:.1f}%")

# RSI extreme analysis — entering when RSI too high (CALL) or too low (PUT)
print("\n=== RSI EXTREME FILTER ===")
for label, trades_list in [("CALL", [t for t in result.trades if t.direction == "CALL"]),
                            ("PUT", [t for t in result.trades if t.direction == "PUT"])]:
    extreme_w, extreme_l, normal_w, normal_l = 0, 0, 0, 0
    for t in trades_list:
        bar = get_bar_at_entry(t.entry_time, df_ind)
        if bar is None:
            continue
        rsi = float(bar.get("rsi", 50) or 50)
        is_extreme = (label == "CALL" and rsi > 65) or (label == "PUT" and rsi < 35)
        if is_extreme:
            if t.pnl >= 0: extreme_w += 1
            else: extreme_l += 1
        else:
            if t.pnl >= 0: normal_w += 1
            else: normal_l += 1
    ext_total = extreme_w + extreme_l
    norm_total = normal_w + normal_l
    ext_wr = extreme_w / ext_total * 100 if ext_total else 0
    norm_wr = normal_w / norm_total * 100 if norm_total else 0
    print(f"  {label} EXTREME RSI: {ext_total} trades, WR={ext_wr:.1f}% | NORMAL: {norm_total} trades, WR={norm_wr:.1f}%")

# MACD histogram alignment strength
print("\n=== MACD HISTOGRAM STRENGTH ===")
for thresh in [0.0, 0.5, 1.0, 2.0]:
    strong_w, strong_l, weak_w, weak_l = 0, 0, 0, 0
    for t in result.trades:
        bar = get_bar_at_entry(t.entry_time, df_ind)
        if bar is None:
            continue
        hist = float(bar.get("macd_hist", 0) or 0)
        aligned = (t.direction == "CALL" and hist > thresh) or (t.direction == "PUT" and hist < -thresh)
        if aligned:
            if t.pnl >= 0: strong_w += 1
            else: strong_l += 1
        else:
            if t.pnl >= 0: weak_w += 1
            else: weak_l += 1
    s_total = strong_w + strong_l
    w_total = weak_w + weak_l
    s_wr = strong_w / s_total * 100 if s_total else 0
    w_wr = weak_w / w_total * 100 if w_total else 0
    print(f"  MACD aligned>{thresh}: {s_total} trades, WR={s_wr:.1f}% | weak: {w_total} trades, WR={w_wr:.1f}%")

# Volume ratio analysis
print("\n=== VOLUME RATIO AT ENTRY ===")
for vr in [1.0, 1.3, 1.5, 2.0]:
    hi_w, hi_l, lo_w, lo_l = 0, 0, 0, 0
    for t in result.trades:
        bar = get_bar_at_entry(t.entry_time, df_ind)
        if bar is None:
            continue
        vol = float(bar.get("volume", 0))
        # Compute avg vol
        idx = df_ind.index.get_indexer([t.entry_time], method="ffill")[0]
        if idx >= 21:
            avg_vol = df_ind["volume"].iloc[idx-20:idx].mean()
            ratio = vol / avg_vol if avg_vol > 0 else 0
        else:
            ratio = 1.0
        if ratio >= vr:
            if t.pnl >= 0: hi_w += 1
            else: hi_l += 1
        else:
            if t.pnl >= 0: lo_w += 1
            else: lo_l += 1
    hi_total = hi_w + hi_l
    lo_total = lo_w + lo_l
    hi_wr = hi_w / hi_total * 100 if hi_total else 0
    lo_wr = lo_w / lo_total * 100 if lo_total else 0
    print(f"  Vol>={vr}x: {hi_total} trades WR={hi_wr:.1f}% | Vol<{vr}x: {lo_total} trades WR={lo_wr:.1f}%")
