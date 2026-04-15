"""Quick baseline check — just the new default params on 10 favourites."""
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

def run_test(params, period="2y"):
    print(f"\n{'Stock':<14} {'Trades':>6} {'WR%':>6} {'Ret%':>8} {'PF':>6} {'MaxDD':>6} {'Grade':>6}")
    print("-" * 60)
    grades = []
    for sym, label in FAVS.items():
        try:
            df = load_yfinance(symbol=sym, interval="1d", period=period)
            if df.empty or len(df) < 60:
                print(f"{label:<14} {'skip':>6}")
                continue
            r = run_backtest(df, params=params, capital=5000)
            g = grade(r.total_return_pct, r.win_rate, r.profit_factor)
            grades.append(g)
            print(f"{label:<14} {r.total_trades:>6} {r.win_rate:>5.1f}% {r.total_return_pct:>+7.1f}% {r.profit_factor:>5.2f} {r.max_drawdown_pct:>5.1f}% {g:>6}")
        except Exception as e:
            print(f"{label:<14} ERROR: {e}")
    grade_counts = {}
    for g in grades: grade_counts[g] = grade_counts.get(g, 0) + 1
    b_plus = sum(1 for g in grades if g in ("A+", "A", "B+", "B"))
    print(f"\nGrades: {grade_counts}")
    print(f"B or better: {b_plus}/{len(grades)} stocks")
    return grades

if __name__ == "__main__":
    print("=== VPB3 IMPROVED (new defaults, 2Y) ===")
    run_test(DEFAULT_PARAMS, "2y")
    
    # Also test with min_score=4 (more permissive)
    print("\n\n=== min_score=4 (more signals) ===")
    p4 = {**DEFAULT_PARAMS, "min_score": 4}
    run_test(p4, "2y")
    
    # Test min_score=6 (stricter)
    print("\n\n=== min_score=6 (stricter) ===")
    p6 = {**DEFAULT_PARAMS, "min_score": 6}
    run_test(p6, "2y")
    
    # Test higher TP
    print("\n\n=== min_score=5, TP=3.0R ===")
    p_tp3 = {**DEFAULT_PARAMS, "tp_r_multiple": 3.0, "trailing_atr_mult": 2.5}
    run_test(p_tp3, "2y")
