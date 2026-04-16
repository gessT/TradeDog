"""Final VPB3 Malaysia optimisation — test best combos on 5Y data."""
import sys
sys.path.insert(0, ".")

from strategies.futures.data_loader import load_yfinance
from strategies.klse.vpb3.backtest import run_backtest
from strategies.klse.vpb3.strategy import DEFAULT_PARAMS

stocks = [
    "0208.KL", "5347.KL", "1155.KL", "5398.KL", "8869.KL",
    "5326.KL", "0166.KL", "5211.KL", "6742.KL", "1295.KL",
    "5225.KL", "1023.KL", "0128.KL", "7084.KL", "5296.KL",
]

print("Loading 5Y data...")
data = {}
for sym in stocks:
    try:
        df = load_yfinance(symbol=sym, interval="1d", period="5y")
        if len(df) >= 60:
            data[sym] = df
    except:
        pass
print(f"Loaded {len(data)} stocks\n")

configs = {
    # Current default
    "DEFAULT": DEFAULT_PARAMS,
    
    # Best WR combo: breakout=8, TP=2.0
    "B_BK8_TP2": {**DEFAULT_PARAMS, "breakout_lookback": 8, "tp_r_multiple": 2.0, "trailing_atr_mult": 1.5},
    
    # Best PF combo: tight filters
    "H_tight": {**DEFAULT_PARAMS, "tp_r_multiple": 1.5, "sl_lookback": 3,
                "min_sl_atr": 0.5, "trailing_atr_mult": 1.2,
                "vol_multiplier": 1.4, "body_ratio_min": 0.35},

    # FINAL: merge best of B + H
    "FINAL_v1": {**DEFAULT_PARAMS,
        "breakout_lookback": 8,
        "tp_r_multiple": 1.8,
        "sl_lookback": 3,
        "min_sl_atr": 0.5,
        "trailing_atr_mult": 1.5,
        "vol_multiplier": 1.3,
        "body_ratio_min": 0.3,
        "rsi_min": 45,
        "rsi_max": 68,
        "cooldown_bars": 3,
    },

    # FINAL v2: slightly more aggressive TP
    "FINAL_v2": {**DEFAULT_PARAMS,
        "breakout_lookback": 8,
        "tp_r_multiple": 2.0,
        "sl_lookback": 3,
        "min_sl_atr": 0.5,
        "trailing_atr_mult": 1.5,
        "vol_multiplier": 1.3,
        "body_ratio_min": 0.3,
        "rsi_min": 45,
        "rsi_max": 68,
        "cooldown_bars": 3,
    },

    # FINAL v3: tighter vol for higher WR
    "FINAL_v3": {**DEFAULT_PARAMS,
        "breakout_lookback": 8,
        "tp_r_multiple": 1.8,
        "sl_lookback": 3,
        "min_sl_atr": 0.5,
        "trailing_atr_mult": 1.5,
        "vol_multiplier": 1.4,
        "body_ratio_min": 0.3,
        "rsi_min": 45,
        "rsi_max": 68,
        "cooldown_bars": 3,
    },
}

hdr = f"{'Config':<18} {'Trades':>6} {'WR%':>7} {'AvgRet%':>8} {'PF':>6} {'MaxDD':>7} {'Active':>7}"
print(hdr)
print("=" * len(hdr))

best_name = ""
best_score = -999

for name, params in configs.items():
    all_trades = 0
    all_wins = 0
    all_ret = 0.0
    all_pnl_w = 0.0
    all_pnl_l = 0.0
    max_dd = 0.0
    active = 0
    
    for sym, df in data.items():
        r = run_backtest(df.copy(), params=params, capital=5000)
        all_trades += r.total_trades
        all_wins += r.winners
        if r.total_trades > 0:
            active += 1
        all_ret += r.total_return_pct
        for t in r.trades:
            if t.win:
                all_pnl_w += t.pnl
            else:
                all_pnl_l += abs(t.pnl)
        if r.max_drawdown_pct > max_dd:
            max_dd = r.max_drawdown_pct
    
    wr = (all_wins / all_trades * 100) if all_trades > 0 else 0
    pf = (all_pnl_w / all_pnl_l) if all_pnl_l > 0 else 999.0
    avg_ret = all_ret / len(data) if data else 0
    
    # Score: WR * PF * avg_ret (positive bias)
    score = wr * pf * (1 + avg_ret / 100)
    if score > best_score:
        best_score = score
        best_name = name
    
    print(f"{name:<18} {all_trades:>6} {wr:>7.1f} {avg_ret:>8.1f} {pf:>6.2f} {max_dd:>7.1f} {active:>4}/{len(data)}")

print(f"\n>>> BEST CONFIG: {best_name} (score={best_score:.1f})")

# Show per-stock detail for the best config
print(f"\n=== {best_name} — Per-stock detail (5Y) ===")
params = configs[best_name]
hdr2 = f"{'Sym':<12} {'Trades':>6} {'WR%':>7} {'Ret%':>8} {'PF':>6} {'DD%':>7} {'Sharpe':>7}"
print(hdr2)
print("-" * len(hdr2))
for sym, df in data.items():
    r = run_backtest(df.copy(), params=params, capital=5000)
    print(f"{sym:<12} {r.total_trades:>6} {r.win_rate:>7.1f} {r.total_return_pct:>8.1f} {r.profit_factor:>6.2f} {r.max_drawdown_pct:>7.1f} {r.sharpe_ratio:>7.2f}")
