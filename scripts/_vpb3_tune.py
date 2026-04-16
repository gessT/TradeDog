"""Fine-tune: combine min_score=4 + higher TP + variants."""
import sys, os, warnings
warnings.filterwarnings("ignore")
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from strategies.futures.data_loader import load_yfinance
from strategies.klse.vpb3.strategy import DEFAULT_PARAMS
from strategies.klse.vpb3.backtest import run_backtest

FAVS = {
    "5347.KL": "Tenaga",
    "1155.KL": "Maybank",
    "1295.KL": "PBBank",
    "5398.KL": "Gamuda",
    "0166.KL": "Inari",
    "5225.KL": "IHH",
    "8869.KL": "PressMetal",
    "6947.KL": "CelcomDigi",
    "5326.KL": "99SpeedMart",
    "5211.KL": "Sunway",
}

def grade(return_pct, win_rate, pf):
    if return_pct >= 40 and win_rate >= 55 and pf >= 2: return "A+"
    if return_pct >= 25 and win_rate >= 50 and pf >= 1.5: return "A"
    if return_pct >= 15 and win_rate >= 45: return "B+"
    if return_pct >= 5: return "B"
    if return_pct >= 0: return "C"
    return "D"

def run_test(name, params, period="2y"):
    print(f"\n{'='*60}")
    print(f" {name}  |  Period: {period}")
    print(f"{'='*60}")
    print(f"{'Stock':<14} {'Trades':>6} {'WR%':>6} {'Ret%':>8} {'PF':>6} {'MaxDD':>6} {'Grade':>6}")
    print("-" * 60)
    grades = []
    for sym, label in FAVS.items():
        try:
            df = load_yfinance(symbol=sym, interval="1d", period=period)
            if df.empty or len(df) < 60: continue
            r = run_backtest(df, params=params, capital=5000)
            g = grade(r.total_return_pct, r.win_rate, r.profit_factor)
            grades.append(g)
            print(f"{label:<14} {r.total_trades:>6} {r.win_rate:>5.1f}% {r.total_return_pct:>+7.1f}% {r.profit_factor:>5.2f} {r.max_drawdown_pct:>5.1f}% {g:>6}")
        except Exception as e:
            print(f"{label:<14} ERROR: {e}")
    gc = {}
    for g in grades: gc[g] = gc.get(g, 0) + 1
    b_plus = sum(1 for g in grades if g in ("A+", "A", "B+", "B"))
    print(f"Grades: {gc}  |  B+: {b_plus}/{len(grades)}")
    return grades, b_plus

if __name__ == "__main__":
    configs = {
        # Best combo: scoring=4 + higher TP + wider trail
        "A: s4_tp3_tr2.5": {**DEFAULT_PARAMS, "min_score": 4, "tp_r_multiple": 3.0, "trailing_atr_mult": 2.5},
        "B: s4_tp2.5_tr2": {**DEFAULT_PARAMS, "min_score": 4, "tp_r_multiple": 2.5, "trailing_atr_mult": 2.0},
        "C: s4_tp2_tr1.5": {**DEFAULT_PARAMS, "min_score": 4, "tp_r_multiple": 2.0, "trailing_atr_mult": 1.5},
        # Same but with accumulation disabled (0 bars)
        "D: s4_tp3_noAccum": {**DEFAULT_PARAMS, "min_score": 4, "tp_r_multiple": 3.0, "trailing_atr_mult": 2.5, "accum_min_bars": 0},
        # min_score=4 + wider SL (more room to breathe)
        "E: s4_tp3_sl7": {**DEFAULT_PARAMS, "min_score": 4, "tp_r_multiple": 3.0, "trailing_atr_mult": 2.5, "sl_lookback": 7, "min_sl_atr": 1.0},
        # min_score=4 + pullback_atr_dist wider
        "F: s4_tp3_pb1.5": {**DEFAULT_PARAMS, "min_score": 4, "tp_r_multiple": 3.0, "trailing_atr_mult": 2.5, "pullback_atr_dist": 1.5},
    }
    
    best_name = ""
    best_count = 0
    for name, cfg in configs.items():
        _, count = run_test(name, cfg, "2y")
        if count > best_count:
            best_count = count
            best_name = name
    
    print(f"\n\n*** BEST: {best_name} with {best_count}/10 B+ ***")
