"""Focused optimization of VPB3 Malaysia — trying multiple param combos."""
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

# Pre-load all data
print("Loading data...")
data = {}
for sym in stocks:
    try:
        df = load_yfinance(symbol=sym, interval="1d", period="2y")
        if len(df) >= 60:
            data[sym] = df
    except:
        pass
print(f"Loaded {len(data)} stocks\n")

configs = {
    "DEFAULT": DEFAULT_PARAMS,
    
    # A: Higher TP, keep strict filters
    "A_TP2.0": {**DEFAULT_PARAMS, "tp_r_multiple": 2.0, "trailing_atr_mult": 1.5},
    
    # B: Wider breakout + higher TP
    "B_BK8_TP2": {**DEFAULT_PARAMS, "breakout_lookback": 8, "tp_r_multiple": 2.0, "trailing_atr_mult": 1.5},
    
    # C: Disable ATR filter + higher TP  
    "C_noATR_TP2": {**DEFAULT_PARAMS, "skip_low_atr": False, "tp_r_multiple": 2.0, "breakout_lookback": 8},
    
    # D: Disable ATR + accum=2 + wider RSI
    "D_easy": {**DEFAULT_PARAMS, "skip_low_atr": False, "accum_min_bars": 2, "rsi_min": 42, "rsi_max": 70,
               "tp_r_multiple": 2.0, "breakout_lookback": 8, "vol_multiplier": 1.2},
    
    # E: Best of above + trailing
    "E_balanced": {**DEFAULT_PARAMS, "skip_low_atr": False, "accum_min_bars": 2,
                   "rsi_min": 42, "rsi_max": 70, "tp_r_multiple": 1.8,
                   "breakout_lookback": 8, "vol_multiplier": 1.2,
                   "trailing_atr_mult": 1.5, "sl_lookback": 4, "min_sl_atr": 0.6},

    # F: Conservative — strong vol + tight SL
    "F_conservative": {**DEFAULT_PARAMS, "vol_multiplier": 1.5, "tp_r_multiple": 1.8,
                       "sl_lookback": 3, "min_sl_atr": 0.5, "trailing_atr_mult": 1.5,
                       "rsi_min": 48, "rsi_max": 65, "body_ratio_min": 0.35},

    # G: Medium — no accum, no ATR, decent vol
    "G_noAccum": {**DEFAULT_PARAMS, "accum_min_bars": 0, "skip_low_atr": False,
                  "tp_r_multiple": 1.8, "breakout_lookback": 8, "vol_multiplier": 1.3,
                  "trailing_atr_mult": 1.5},

    # H: Tight — strict filters, TP 1.5, tight SL
    "H_tight": {**DEFAULT_PARAMS, "tp_r_multiple": 1.5, "sl_lookback": 3,
                "min_sl_atr": 0.5, "trailing_atr_mult": 1.2,
                "vol_multiplier": 1.4, "body_ratio_min": 0.35},
}

hdr = f"{'Config':<18} {'Trades':>6} {'WR%':>7} {'Ret%':>8} {'PF':>6} {'MaxDD':>7} {'Active':>7}"
print(hdr)
print("=" * len(hdr))

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
    print(f"{name:<18} {all_trades:>6} {wr:>7.1f} {avg_ret:>8.1f} {pf:>6.2f} {max_dd:>7.1f} {active:>4}/{len(data)}")
