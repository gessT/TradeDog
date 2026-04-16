"""Quick optimizer for SMP strategy on Pekat Group — Phase 2: fine-tune."""
from strategies.futures.data_loader import load_yfinance
from strategies.klse.smp.backtest import run_backtest
from strategies.klse.smp.strategy import DEFAULT_PARAMS

df = load_yfinance(symbol="0233.KL", interval="1d", period="2y")

results = []

# Fine-tune around winning configs
for min_score in [3, 4]:
    for tp_r in [1.5, 2.0, 2.5]:
        for trail_atr in [2.5, 3.0, 3.5]:
            for sl_lb in [3, 4, 5]:
                for ema_f in [13, 21]:
                    for ema_s in [34, 55]:
                        for pivot_lb in [3, 5, 7]:
                            for ob_lb in [10, 20]:
                                p = {**DEFAULT_PARAMS,
                                     "min_score": min_score,
                                     "tp_r_multiple": tp_r,
                                     "trailing_atr_mult": trail_atr,
                                     "sl_lookback": sl_lb,
                                     "min_sl_atr": 0.3,
                                     "ema_fast": ema_f,
                                     "ema_slow": ema_s,
                                     "pivot_lookback": pivot_lb,
                                     "ob_lookback": ob_lb,
                                     "cooldown_bars": 1}
                                r = run_backtest(df.copy(), params=p, capital=5000)
                                if r.total_trades >= 5:
                                    # Weighted: high WR + high return + good PF + low DD
                                    score = (r.win_rate * 0.5
                                             + r.total_return_pct * 0.3
                                             + min(r.profit_factor, 5) * 6
                                             + r.sharpe_ratio * 5
                                             - r.max_drawdown_pct * 0.3)
                                    results.append((score, p, r))

results.sort(key=lambda x: x[0], reverse=True)
print("Top 5 parameter sets:")
for i, (sc, p, r) in enumerate(results[:5]):
    print(f"{i+1}. Score={sc:.1f} | WR={r.win_rate}% Ret={r.total_return_pct}% PF={r.profit_factor} "
          f"Sharpe={r.sharpe_ratio} DD={r.max_drawdown_pct}% Trades={r.total_trades}")
    print(f"   min_score={p['min_score']} tp_r={p['tp_r_multiple']} "
          f"trail={p['trailing_atr_mult']} sl_lb={p['sl_lookback']} min_sl={p['min_sl_atr']}")
    for t in r.trades:
        print(f"   {t.entry_date}->{t.exit_date} E:{t.entry_price} X:{t.exit_price} "
              f"PnL:{t.pnl}({t.return_pct}%) {t.exit_reason}")
    print()
