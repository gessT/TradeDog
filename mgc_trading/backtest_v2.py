"""
Backtest V2 — Professional bar-by-bar backtester for Strategy V2
=================================================================
• Long-only, bar-by-bar simulation
• Proper equity curve, max drawdown, Sharpe ratio
• Out-of-sample split support
• Grid-search parameter optimizer
"""
from __future__ import annotations

import itertools
import logging
import math
from dataclasses import dataclass, field

import numpy as np
import pandas as pd

from .config import CONTRACT_SIZE, INITIAL_CAPITAL, RISK_PER_TRADE
from .strategy_v2 import StrategyV2, DEFAULT_V2_PARAMS

logger = logging.getLogger(__name__)


# ═══════════════════════════════════════════════════════════════════════
# Data classes
# ═══════════════════════════════════════════════════════════════════════

@dataclass
class TradeV2:
    entry_time: object
    exit_time: object
    entry_price: float
    exit_price: float
    qty: int
    pnl: float
    pnl_pct: float
    reason: str       # "TP", "SL", "TRAILING", "EOD"
    # Indicator snapshot at entry
    rsi: float = 0.0
    ema_align: str = ""     # "bullish" / "mixed"
    ht_dir: str = ""        # "UP" / "DOWN"
    vol_ratio: float = 0.0
    macd_hist: float = 0.0
    st_dir: int = 0
    mae: float = 0.0       # max adverse excursion ($)


@dataclass
class BacktestResultV2:
    trades: list[TradeV2] = field(default_factory=list)
    equity_curve: list[float] = field(default_factory=list)
    timestamps: list[str] = field(default_factory=list)
    initial_capital: float = 0.0
    final_equity: float = 0.0
    total_return_pct: float = 0.0
    total_trades: int = 0
    winners: int = 0
    losers: int = 0
    win_rate: float = 0.0
    avg_win: float = 0.0
    avg_loss: float = 0.0
    avg_pnl_pct: float = 0.0
    profit_factor: float = 0.0
    risk_reward_ratio: float = 0.0
    max_drawdown_pct: float = 0.0
    sharpe_ratio: float = 0.0
    calmar_ratio: float = 0.0
    params: dict = field(default_factory=dict)
    # Out-of-sample
    oos_win_rate: float = 0.0
    oos_total_trades: int = 0
    oos_return_pct: float = 0.0


# ═══════════════════════════════════════════════════════════════════════
# Backtester
# ═══════════════════════════════════════════════════════════════════════

class BacktesterV2:
    """Bar-by-bar backtest engine for StrategyV2 (long-only)."""

    MAX_CONSEC_LOSSES = 5
    MAX_DAILY_TRADES = 10

    def __init__(
        self,
        capital: float = INITIAL_CAPITAL,
        risk_per_trade: float = RISK_PER_TRADE,
    ):
        self.initial_capital = capital
        self.risk_per_trade = risk_per_trade

    def run(
        self,
        df: pd.DataFrame,
        params: dict | None = None,
        oos_split: float = 0.0,
    ) -> BacktestResultV2:
        """Execute backtest. Split data for OOS if oos_split > 0."""
        full_params = {**DEFAULT_V2_PARAMS, **(params or {})}
        strategy = StrategyV2(full_params)

        df_ind = strategy.compute_indicators(
            df[["open", "high", "low", "close", "volume"]].copy()
        )
        signals = strategy.generate_signals(df_ind)

        if oos_split > 0:
            split = int(len(df_ind) * (1 - oos_split))
            is_trades, is_curve, is_ts, is_eq = self._simulate(
                df_ind.iloc[:split], signals.iloc[:split], full_params
            )
            saved = self.initial_capital
            self.initial_capital = is_eq
            oos_trades, oos_curve, oos_ts, oos_eq = self._simulate(
                df_ind.iloc[split:], signals.iloc[split:], full_params
            )
            self.initial_capital = saved
            all_trades = is_trades + oos_trades
            all_curve = is_curve + oos_curve
            all_ts = is_ts + oos_ts
        else:
            all_trades, all_curve, all_ts, _ = self._simulate(df_ind, signals, full_params)
            oos_trades = []

        result = self._compute_metrics(all_trades, all_curve, self.initial_capital, full_params)
        result.timestamps = all_ts

        if oos_trades:
            oos_wins = [t for t in oos_trades if t.pnl > 0]
            result.oos_total_trades = len(oos_trades)
            result.oos_win_rate = round(len(oos_wins) / len(oos_trades) * 100, 1) if oos_trades else 0
            result.oos_return_pct = round(sum(t.pnl for t in oos_trades) / self.initial_capital * 100, 2)

        return result

    def _simulate(
        self,
        df: pd.DataFrame,
        signals: pd.Series,
        params: dict,
    ) -> tuple[list[TradeV2], list[float], list[str], float]:
        """Bar-by-bar simulation loop (long-only)."""
        equity = self.initial_capital
        position: dict | None = None
        trades: list[TradeV2] = []
        equity_curve: list[float] = []
        timestamps: list[str] = []
        consec_losses = 0
        daily_counts: dict[str, int] = {}
        peak_since_entry = 0.0
        worst_unrealized = 0.0

        for i in range(1, len(df)):
            bar = df.iloc[i]
            prev = df.iloc[i - 1]
            bar_date = str(bar.name)[:10]
            bar_ts = str(bar.name)

            # ── 1. If in position → check exits ───────────────
            if position is not None:
                sl = position["sl"]
                tp = position["tp"]
                entry_p = position["entry_price"]
                qty = position["qty"]

                # Track MAE (worst unrealized loss)
                adverse = (float(bar["low"]) - entry_p) * qty * CONTRACT_SIZE
                if adverse < worst_unrealized:
                    worst_unrealized = adverse

                # Trailing stop: activate once price reaches trail_activate_mult × ATR
                if params.get("use_trailing"):
                    if float(bar["high"]) > peak_since_entry:
                        peak_since_entry = float(bar["high"])
                    activate_level = entry_p + params["trail_activate_mult"] * position["entry_atr"]
                    if peak_since_entry >= activate_level:
                        new_sl = peak_since_entry - params["trailing_atr_mult"] * position["entry_atr"]
                        if new_sl > sl:
                            sl = new_sl
                            position["sl"] = sl

                hit_sl = float(bar["low"]) <= sl
                hit_tp = float(bar["high"]) >= tp

                if hit_sl:
                    exit_price = sl
                    pnl = (exit_price - entry_p) * qty * CONTRACT_SIZE
                    pnl_pct = pnl / max(self.initial_capital, 1) * 100
                    equity += pnl
                    reason = "TRAILING" if params.get("use_trailing") and sl != position["orig_sl"] else "SL"
                    trades.append(TradeV2(
                        entry_time=position["entry_time"], exit_time=bar.name,
                        entry_price=entry_p, exit_price=round(exit_price, 2),
                        qty=qty, pnl=round(pnl, 2), pnl_pct=round(pnl_pct, 2),
                        reason=reason, rsi=position["rsi"],
                        ema_align=position["ema_align"], ht_dir=position["ht_dir"],
                        vol_ratio=position["vol_ratio"], macd_hist=position["macd_hist"],
                        st_dir=position["st_dir"], mae=round(worst_unrealized, 2),
                    ))
                    consec_losses = consec_losses + 1 if pnl < 0 else 0
                    position = None
                    worst_unrealized = 0.0

                elif hit_tp:
                    exit_price = tp
                    pnl = (exit_price - entry_p) * qty * CONTRACT_SIZE
                    pnl_pct = pnl / max(self.initial_capital, 1) * 100
                    equity += pnl
                    trades.append(TradeV2(
                        entry_time=position["entry_time"], exit_time=bar.name,
                        entry_price=entry_p, exit_price=round(exit_price, 2),
                        qty=qty, pnl=round(pnl, 2), pnl_pct=round(pnl_pct, 2),
                        reason="TP", rsi=position["rsi"],
                        ema_align=position["ema_align"], ht_dir=position["ht_dir"],
                        vol_ratio=position["vol_ratio"], macd_hist=position["macd_hist"],
                        st_dir=position["st_dir"], mae=round(worst_unrealized, 2),
                    ))
                    consec_losses = 0
                    position = None
                    worst_unrealized = 0.0

            # ── 2. No position → check entry ──────────────────
            if position is None and signals.iloc[i] == 1:
                if consec_losses >= self.MAX_CONSEC_LOSSES:
                    equity_curve.append(equity)
                    timestamps.append(bar_ts)
                    continue
                if daily_counts.get(bar_date, 0) >= self.MAX_DAILY_TRADES:
                    equity_curve.append(equity)
                    timestamps.append(bar_ts)
                    continue

                entry_price = float(bar["open"])
                atr_val = float(prev["atr"])
                if math.isnan(atr_val) or atr_val <= 0:
                    equity_curve.append(equity)
                    timestamps.append(bar_ts)
                    continue

                sl_price = entry_price - params["atr_sl_mult"] * atr_val
                tp_price = entry_price + params["atr_tp_mult"] * atr_val

                risk_per_contract = abs(entry_price - sl_price) * CONTRACT_SIZE
                if risk_per_contract <= 0:
                    equity_curve.append(equity)
                    timestamps.append(bar_ts)
                    continue

                risk_amount = equity * self.risk_per_trade
                qty = max(1, int(risk_amount / risk_per_contract))

                # Snapshot indicators at entry
                e20 = float(prev["ema20"]) if not math.isnan(float(prev["ema20"])) else 0
                e50 = float(prev["ema50"]) if not math.isnan(float(prev["ema50"])) else 0
                e200 = float(prev["ema200"]) if not math.isnan(float(prev["ema200"])) else 0
                ema_align = "bullish" if e20 > e50 > e200 else "mixed"

                position = {
                    "entry_price": entry_price,
                    "sl": sl_price,
                    "orig_sl": sl_price,
                    "tp": tp_price,
                    "qty": qty,
                    "entry_time": bar.name,
                    "entry_atr": atr_val,
                    "rsi": round(float(prev["rsi"]), 1) if not math.isnan(float(prev["rsi"])) else 50,
                    "ema_align": ema_align,
                    "ht_dir": "UP" if int(prev.get("ht_trend", 1)) == 0 else "DOWN",
                    "vol_ratio": round(float(prev.get("vol_ratio", 1)), 2),
                    "macd_hist": round(float(prev.get("macd_hist", 0)), 4),
                    "st_dir": int(prev.get("st_dir", 0)),
                }
                peak_since_entry = entry_price
                worst_unrealized = 0.0
                daily_counts[bar_date] = daily_counts.get(bar_date, 0) + 1

            # ── 3. Record equity ──────────────────────────────
            if position is not None:
                unrealized = (float(bar["close"]) - position["entry_price"]) * position["qty"] * CONTRACT_SIZE
                equity_curve.append(equity + unrealized)
            else:
                equity_curve.append(equity)
            timestamps.append(bar_ts)

        # Close remaining position at last bar
        if position is not None:
            last = df.iloc[-1]
            pnl = (float(last["close"]) - position["entry_price"]) * position["qty"] * CONTRACT_SIZE
            pnl_pct = pnl / max(self.initial_capital, 1) * 100
            equity += pnl
            trades.append(TradeV2(
                entry_time=position["entry_time"], exit_time=last.name,
                entry_price=position["entry_price"],
                exit_price=round(float(last["close"]), 2),
                qty=position["qty"], pnl=round(pnl, 2), pnl_pct=round(pnl_pct, 2),
                reason="EOD", rsi=position["rsi"],
                ema_align=position["ema_align"], ht_dir=position["ht_dir"],
                vol_ratio=position["vol_ratio"], macd_hist=position["macd_hist"],
                st_dir=position["st_dir"], mae=round(worst_unrealized, 2),
            ))

        return trades, equity_curve, timestamps, equity

    @staticmethod
    def _compute_metrics(
        trades: list[TradeV2],
        equity_curve: list[float],
        initial_capital: float,
        params: dict,
    ) -> BacktestResultV2:
        result = BacktestResultV2(
            trades=trades,
            equity_curve=equity_curve,
            initial_capital=initial_capital,
            params=params,
        )
        if not trades:
            result.final_equity = initial_capital
            return result

        wins = [t for t in trades if t.pnl > 0]
        losses = [t for t in trades if t.pnl <= 0]

        result.total_trades = len(trades)
        result.winners = len(wins)
        result.losers = len(losses)
        result.win_rate = round(len(wins) / len(trades) * 100, 1)
        result.avg_win = round(sum(t.pnl for t in wins) / max(len(wins), 1), 2)
        result.avg_loss = round(sum(t.pnl for t in losses) / max(len(losses), 1), 2)
        result.avg_pnl_pct = round(sum(t.pnl_pct for t in trades) / len(trades), 3)
        result.profit_factor = round(
            abs(sum(t.pnl for t in wins) / sum(t.pnl for t in losses)), 2
        ) if losses and sum(t.pnl for t in losses) != 0 else 999.0
        result.risk_reward_ratio = round(
            abs(result.avg_win / result.avg_loss), 2
        ) if result.avg_loss != 0 else 999.0

        final_eq = equity_curve[-1] if equity_curve else initial_capital
        result.final_equity = round(final_eq, 2)
        result.total_return_pct = round((final_eq - initial_capital) / initial_capital * 100, 2)

        # Max drawdown
        if equity_curve:
            peak = equity_curve[0]
            max_dd = 0.0
            for eq in equity_curve:
                if eq > peak:
                    peak = eq
                dd = (peak - eq) / peak if peak > 0 else 0
                if dd > max_dd:
                    max_dd = dd
            result.max_drawdown_pct = round(max_dd * 100, 2)

        # Sharpe (annualised — assuming 78 bars/day for 5min)
        if len(equity_curve) > 1:
            returns = np.diff(equity_curve) / np.maximum(equity_curve[:-1], 1e-10)
            if returns.std() > 0:
                bars_per_year = 252 * 78
                result.sharpe_ratio = round(
                    float(returns.mean() / returns.std() * math.sqrt(bars_per_year)), 2
                )

        # Calmar ratio (annual return / max drawdown)
        if result.max_drawdown_pct > 0:
            result.calmar_ratio = round(result.total_return_pct / result.max_drawdown_pct, 2)

        return result


# ═══════════════════════════════════════════════════════════════════════
# Grid-search Optimizer
# ═══════════════════════════════════════════════════════════════════════

OPTIMIZE_GRID: dict[str, list] = {
    "ema_fast": [10, 20],
    "st_mult": [2.0, 3.0],
    "atr_sl_mult": [1.5, 2.0],
    "atr_tp_mult": [1.0, 1.5],
    "pullback_atr_mult": [2.0, 3.0],
    "min_score": [4, 5],
    "use_trailing": [True, False],
}

# ── Separate params that affect indicators vs signal/trade logic ──
_INDICATOR_PARAMS = {"ema_fast", "ema_mid", "ema_slow", "ht_amplitude",
                     "st_period", "st_mult", "rsi_period", "macd_fast",
                     "macd_slow", "macd_signal", "vol_period", "atr_period"}


def optimize_v2(
    df: pd.DataFrame,
    capital: float = INITIAL_CAPITAL,
    min_trades: int = 5,
    target_wr: float = 60.0,
) -> tuple[BacktestResultV2, list[dict]]:
    """Grid search with indicator pre-computation for speed.

    Indicator params (ema_fast, st_mult) → compute once per unique set.
    Signal/trade params (atr_sl_mult, min_score, ...) → loop quickly.
    """
    keys = list(OPTIMIZE_GRID.keys())
    combos = list(itertools.product(*[OPTIMIZE_GRID[k] for k in keys]))
    logger.info("Optimizing V2: %d combinations", len(combos))

    # Group combos by indicator-affecting params
    ind_keys = [k for k in keys if k in _INDICATOR_PARAMS]
    sig_keys = [k for k in keys if k not in _INDICATOR_PARAMS]
    ind_idx = [keys.index(k) for k in ind_keys]
    sig_idx = [keys.index(k) for k in sig_keys]

    grouped: dict[tuple, list[tuple]] = {}
    for combo in combos:
        ind_vals = tuple(combo[i] for i in ind_idx)
        grouped.setdefault(ind_vals, []).append(combo)

    results: list[dict] = []
    best: BacktestResultV2 | None = None
    best_score = -999.0
    bt = BacktesterV2(capital=capital)
    total = len(combos)
    done = 0

    for ind_vals, sub_combos in grouped.items():
        # Build params for indicator computation
        ind_params = {**DEFAULT_V2_PARAMS}
        for k, v in zip(ind_keys, ind_vals):
            ind_params[k] = v

        strategy = StrategyV2(ind_params)
        df_ind = strategy.compute_indicators(
            df[["open", "high", "low", "close", "volume"]].copy()
        )

        for combo in sub_combos:
            full_params = {**DEFAULT_V2_PARAMS}
            for k, v in zip(keys, combo):
                full_params[k] = v

            try:
                # Re‑use precomputed indicators — only generate signals + simulate
                sig_strategy = StrategyV2(full_params)
                signals = sig_strategy.generate_signals(df_ind)
                trades_list, eq_curve, ts_list, _ = bt._simulate(df_ind, signals, full_params)
            except Exception:
                done += 1
                continue

            if len(trades_list) < min_trades:
                done += 1
                continue

            r = BacktesterV2._compute_metrics(trades_list, eq_curve, capital, full_params)

            score = (
                r.win_rate * 2
                + r.total_return_pct
                - r.max_drawdown_pct * 0.5
                + r.profit_factor * 5
            )

            results.append({
                "params": {k: v for k, v in zip(keys, combo)},
                "trades": r.total_trades,
                "win_rate": r.win_rate,
                "return_pct": r.total_return_pct,
                "max_dd": r.max_drawdown_pct,
                "sharpe": r.sharpe_ratio,
                "pf": r.profit_factor,
                "rr": r.risk_reward_ratio,
                "score": round(score, 2),
            })

            if score > best_score:
                best_score = score
                best = r

            done += 1
            if done % 100 == 0:
                print(f"  [{done}/{total}] best so far: WR={best.win_rate}% Ret={best.total_return_pct}%")

    results.sort(key=lambda x: x["score"], reverse=True)

    if best is None:
        best = BacktestResultV2(initial_capital=capital, final_equity=capital)

    return best, results[:20]
