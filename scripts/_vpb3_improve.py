"""
VPB3 Malaysia improvement script.
1. Baseline current params on 10 favourite stocks
2. Try multiple improved configs
3. Print per-stock grades (same logic as frontend)
"""
import sys, os, warnings
warnings.filterwarnings("ignore")
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from strategies.futures.data_loader import load_yfinance
from strategies.klse.vpb3.strategy import DEFAULT_PARAMS, build_indicators, generate_signals
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

def run_config(name, params, period="2y"):
    print(f"\n{'='*70}")
    print(f"Config: {name}  |  Period: {period}")
    print(f"{'='*70}")
    print(f"{'Stock':<14} {'Trades':>6} {'WR%':>6} {'Ret%':>8} {'PF':>6} {'MaxDD':>6} {'Grade':>6}")
    print("-" * 60)
    
    grades = []
    all_trades = 0
    all_winners = 0
    all_ret = []
    
    for sym, label in FAVS.items():
        try:
            df = load_yfinance(symbol=sym, interval="1d", period=period)
            if df.empty or len(df) < 60:
                print(f"{label:<14} {'skip':>6}")
                continue
            result = run_backtest(df, params=params, capital=5000)
            g = grade(result.total_return_pct, result.win_rate, result.profit_factor)
            grades.append(g)
            all_trades += result.total_trades
            all_winners += result.winners
            all_ret.append(result.total_return_pct)
            print(f"{label:<14} {result.total_trades:>6} {result.win_rate:>5.1f}% {result.total_return_pct:>+7.1f}% {result.profit_factor:>5.2f} {result.max_drawdown_pct:>5.1f}% {g:>6}")
        except Exception as e:
            print(f"{label:<14} ERROR: {e}")
    
    # Summary
    grade_counts = {}
    for g in grades:
        grade_counts[g] = grade_counts.get(g, 0) + 1
    avg_wr = (all_winners / all_trades * 100) if all_trades > 0 else 0
    avg_ret = sum(all_ret) / len(all_ret) if all_ret else 0
    print("-" * 60)
    print(f"{'SUMMARY':<14} {all_trades:>6} {avg_wr:>5.1f}% {avg_ret:>+7.1f}%")
    print(f"Grades: {grade_counts}")
    b_plus = sum(1 for g in grades if g in ("A+", "A", "B+", "B"))
    print(f"B or better: {b_plus}/{len(grades)} stocks")
    return grades


if __name__ == "__main__":
    # ─── 1. BASELINE ───
    print("\n" + "█" * 70)
    print("  BASELINE (current DEFAULT_PARAMS)")
    print("█" * 70)
    baseline_grades = run_config("BASELINE", DEFAULT_PARAMS, period="2y")

    # ─── 2. CONFIG VARIANTS ───
    configs = {}
    
    # V1: Relax RSI + wider breakout + lower volume threshold → more trades
    configs["V1_relax"] = {**DEFAULT_PARAMS,
        "rsi_min": 40, "rsi_max": 72,
        "vol_multiplier": 1.2,
        "breakout_lookback": 8,
        "body_ratio_min": 0.25,
        "close_top_pct": 0.40,
        "tp_r_multiple": 2.0,
        "sl_lookback": 5,
        "trailing_atr_mult": 1.5,
    }
    
    # V2: Higher TP target, wider trailing → let winners run more  
    configs["V2_letrun"] = {**DEFAULT_PARAMS,
        "tp_r_multiple": 2.5,
        "trailing_atr_mult": 2.0,
        "sl_lookback": 5,
        "min_sl_atr": 0.8,
        "cooldown_bars": 2,
    }
    
    # V3: Relaxed entry + trend confirmation + tight SL
    configs["V3_trend"] = {**DEFAULT_PARAMS,
        "rsi_min": 42, "rsi_max": 70,
        "vol_multiplier": 1.2,
        "breakout_lookback": 8,
        "body_ratio_min": 0.30,
        "close_top_pct": 0.40,
        "accum_min_bars": 2,   # easier accumulation
        "tp_r_multiple": 2.0,
        "sl_lookback": 3,
        "min_sl_atr": 0.5,
        "trailing_atr_mult": 1.5,
        "cooldown_bars": 2,
    }
    
    # V4: Disable accumulation (it may filter out good breakouts)
    configs["V4_no_accum"] = {**DEFAULT_PARAMS,
        "accum_min_bars": 0,  # disable accumulation check
        "vol_multiplier": 1.3,
        "breakout_lookback": 8,
        "rsi_min": 42, "rsi_max": 72,
        "body_ratio_min": 0.28,
        "close_top_pct": 0.40,
        "tp_r_multiple": 2.0,
        "sl_lookback": 5,
        "min_sl_atr": 0.7,
        "trailing_atr_mult": 1.8,
        "cooldown_bars": 2,
    }
    
    # V5: Conservative — fewer trades, higher WR — tighter entry + tighter SL + moderate TP
    configs["V5_consrv"] = {**DEFAULT_PARAMS,
        "rsi_min": 48, "rsi_max": 65,
        "vol_multiplier": 1.5,
        "breakout_lookback": 10,
        "body_ratio_min": 0.40,
        "close_top_pct": 0.30,
        "tp_r_multiple": 1.8,
        "sl_lookback": 3,
        "min_sl_atr": 0.5,
        "trailing_atr_mult": 1.0,
        "cooldown_bars": 3,
    }
    
    # V6: Middle ground — relaxed filters + moderate TP + disable ATR filter
    configs["V6_mid"] = {**DEFAULT_PARAMS,
        "rsi_min": 40, "rsi_max": 72,
        "vol_multiplier": 1.2,
        "breakout_lookback": 8,
        "body_ratio_min": 0.25,
        "close_top_pct": 0.40,
        "accum_min_bars": 2,
        "tp_r_multiple": 2.0,
        "sl_lookback": 4,
        "min_sl_atr": 0.6,
        "trailing_atr_mult": 1.5,
        "cooldown_bars": 2,
        "skip_low_atr": False,  # disable ATR expansion filter
    }

    for name, cfg in configs.items():
        run_config(name, cfg, period="2y")
    
    # ─── 3. PICK BEST, re-check on 1y ───
    print("\n\n" + "█" * 70)
    print("  BEST CONFIGS re-test on period=1y")
    print("█" * 70)
    for name, cfg in configs.items():
        run_config(f"{name}_1y", cfg, period="1y")
