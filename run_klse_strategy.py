#!/usr/bin/env python3
"""
run_klse_strategy.py — Run backtest + optimize HalfTrend + Weekly Supertrend
"""
import sys
import os
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from klse_strategy.data_loader import load_json
from klse_strategy.strategy import StrategyParams
from klse_strategy.backtest import run_backtest
from klse_strategy.optimizer import optimize, print_results, DEFAULT_GRID, QUICK_GRID
from klse_strategy.trade_log import print_trade_log, print_summary


def main():
    data_path = os.path.join(os.path.dirname(__file__), "vs_industry_stock.json")
    print(f"📂 Loading data from {data_path}")
    df = load_json(data_path)
    print(f"   {len(df)} daily bars: {df['date'].iloc[0].date()} → {df['date'].iloc[-1].date()}\n")

    # ── Phase 1: Default params baseline ──────────────────────────
    print("═" * 60)
    print("  Phase 1: Baseline Backtest (default params)")
    print("═" * 60)
    baseline = StrategyParams()
    result = run_backtest(df, baseline)
    print_summary(result)
    print_trade_log(result, max_rows=20)

    # ── Phase 2: Optimise ─────────────────────────────────────────
    print("\n" + "═" * 60)
    print("  Phase 2: Parameter Optimisation")
    print("═" * 60)

    t0 = time.time()
    top_results = optimize(
        df,
        grid=DEFAULT_GRID,
        capital=100_000.0,
        min_win_rate=50.0,
        min_trades=5,
        workers=4,
        top_n=10,
    )
    elapsed = time.time() - t0
    print(f"\n⏱  Optimisation completed in {elapsed:.1f}s")

    if not top_results:
        print("❌ No parameter combinations met the minimum criteria.")
        return

    print_results(top_results)

    # ── Phase 3: Best params full report ──────────────────────────
    best_params, best_result, best_score = top_results[0]
    print("\n" + "═" * 60)
    print("  Phase 3: Best Strategy — Full Report")
    print("═" * 60)
    print(f"\n🔥 Best Parameters:")
    for k, v in best_params.items():
        print(f"   {k:25s} = {v}")

    print_summary(best_result)
    print_trade_log(best_result, max_rows=50)

    # ── Save best params ──────────────────────────────────────────
    import json
    out = {
        "symbol": "6963.KL",
        "name": "VS Industry",
        "best_params": best_params,
        "performance": {
            "win_rate": best_result.win_rate,
            "total_return_pct": best_result.total_return_pct,
            "max_drawdown_pct": best_result.max_drawdown_pct,
            "profit_factor": best_result.profit_factor,
            "risk_reward": best_result.risk_reward,
            "sharpe_ratio": best_result.sharpe_ratio,
            "total_trades": best_result.total_trades,
            "winners": best_result.winners,
            "losers": best_result.losers,
        },
        "score": round(best_score, 2),
    }
    out_path = os.path.join(os.path.dirname(__file__), "klse_best_strategy.json")
    with open(out_path, "w") as f:
        json.dump(out, f, indent=2)
    print(f"\n💾 Best strategy saved to {out_path}")


if __name__ == "__main__":
    main()
