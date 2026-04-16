"""Final verification: run with actual DEFAULT_PARAMS."""
import sys, os, warnings
warnings.filterwarnings("ignore")
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
from strategies.futures.data_loader import load_yfinance
from strategies.klse.vpb3.strategy import DEFAULT_PARAMS
from strategies.klse.vpb3.backtest import run_backtest

FAVS = {"5347.KL":"Tenaga","1155.KL":"Maybank","1295.KL":"PBBank","5398.KL":"Gamuda","0166.KL":"Inari","5225.KL":"IHH","8869.KL":"PressMetal","6947.KL":"CelcomDigi","5326.KL":"99SpeedMart","5211.KL":"Sunway"}
def grade(r,w,p):
    if r>=40 and w>=55 and p>=2: return "A+"
    if r>=25 and w>=50 and p>=1.5: return "A"
    if r>=15 and w>=45: return "B+"
    if r>=5: return "B"
    if r>=0: return "C"
    return "D"

print(f"min_score={DEFAULT_PARAMS['min_score']}, tp={DEFAULT_PARAMS['tp_r_multiple']}, trail={DEFAULT_PARAMS['trailing_atr_mult']}")
print(f"{'Stock':<14} {'Tr':>4} {'WR%':>6} {'Ret%':>8} {'PF':>6} {'DD':>6} {'Gr':>4}")
print("-"*50)
gs=[]
for sym,nm in FAVS.items():
    df=load_yfinance(symbol=sym,interval="1d",period="2y")
    r=run_backtest(df,params=DEFAULT_PARAMS,capital=5000)
    g=grade(r.total_return_pct,r.win_rate,r.profit_factor)
    gs.append(g)
    print(f"{nm:<14} {r.total_trades:>4} {r.win_rate:>5.1f}% {r.total_return_pct:>+7.1f}% {r.profit_factor:>5.2f} {r.max_drawdown_pct:>5.1f}% {g:>4}")
gc={}
for g in gs: gc[g]=gc.get(g,0)+1
b=sum(1 for g in gs if g in ("A+","A","B+","B"))
print(f"\nGrades: {gc}")
print(f"B or better: {b}/{len(gs)} stocks")
