"""
1-Hour Backtester — Bar-by-bar simulation for US stock 1h strategy
===================================================================
Same engine as Backtester5Min but:
  • P&L uses SHARE_SIZE (1) instead of CONTRACT_SIZE (10)
  • No EOD forced close (1h bars span days naturally)
  • Sharpe annualised for 1h bars (6.5 bars/day × 252 days)
"""
from __future__ import annotations

import logging
import math
from dataclasses import dataclass, field

import numpy as np
import pandas as pd

from .config import SHARE_SIZE, INITIAL_CAPITAL, RISK_PER_TRADE
from .strategy_1h import USStrategy1H, DEFAULT_1H_PARAMS

logger = logging.getLogger(__name__)


# ═══════════════════════════════════════════════════════════════════════
# Data classes
# ═══════════════════════════════════════════════════════════════════════

@dataclass
class Trade1H:
    entry_time: object
    exit_time: object
    entry_price: float
    exit_price: float
    qty: int
    pnl: float
    pnl_pct: float
    reason: str
    signal_type: str = ""
    direction: str = "CALL"
    mae: float = 0.0
    mkt_structure: int = 0


@dataclass
class BacktestResult1H:
    trades: list[Trade1H] = field(default_factory=list)
    equity_curve: list[float] = field(default_factory=list)
    initial_capital: float = 0.0
    final_equity: float = 0.0
    total_return_pct: float = 0.0
    total_trades: int = 0
    winners: int = 0
    losers: int = 0
    win_rate: float = 0.0
    avg_win: float = 0.0
    avg_loss: float = 0.0
    profit_factor: float = 0.0
    risk_reward_ratio: float = 0.0
    max_drawdown_pct: float = 0.0
    sharpe_ratio: float = 0.0
    params: dict = field(default_factory=dict)
    oos_win_rate: float = 0.0
    oos_total_trades: int = 0
    oos_return_pct: float = 0.0
    daily_pnl: list[dict] = field(default_factory=list)


# ═══════════════════════════════════════════════════════════════════════
# Backtester1H
# ═══════════════════════════════════════════════════════════════════════

class Backtester1H:
    """1-hour bar-by-bar backtest engine."""

    MAX_CONSEC_LOSSES = 4
    MAX_DAILY_TRADES = 10

    def __init__(
        self,
        capital: float = INITIAL_CAPITAL,
        risk_per_trade: float = RISK_PER_TRADE,
    ) -> None:
        self.initial_capital = capital
        self.risk_per_trade = risk_per_trade

    def run(
        self,
        df: pd.DataFrame,
        params: dict | None = None,
        oos_split: float = 0.0,
        disabled_conditions: set[str] | None = None,
        skip_flat: bool = False,
    ) -> BacktestResult1H:
        full_params = {**DEFAULT_1H_PARAMS, **(params or {})}
        strategy = USStrategy1H(full_params)

        df_ind = strategy.compute_indicators(
            df[["open", "high", "low", "close", "volume"]].copy()
        )
        signals = strategy.generate_signals(df_ind, disabled=disabled_conditions)

        if oos_split > 0:
            split_idx = int(len(df_ind) * (1 - oos_split))
            is_trades, is_curve, is_equity = self._simulate(
                df_ind.iloc[:split_idx], signals.iloc[:split_idx], full_params,
                skip_flat=skip_flat,
            )
            saved_capital = self.initial_capital
            self.initial_capital = is_equity
            oos_trades, oos_curve, oos_equity = self._simulate(
                df_ind.iloc[split_idx:], signals.iloc[split_idx:], full_params,
                skip_flat=skip_flat,
            )
            self.initial_capital = saved_capital
            all_trades = is_trades + oos_trades
            all_curve = is_curve + oos_curve
        else:
            all_trades, all_curve, _ = self._simulate(
                df_ind, signals, full_params, skip_flat=skip_flat
            )
            is_trades = all_trades
            oos_trades = []

        result = self._compute_metrics(all_trades, all_curve, self.initial_capital, full_params)

        if oos_trades:
            oos_wins = [t for t in oos_trades if t.pnl > 0]
            result.oos_total_trades = len(oos_trades)
            result.oos_win_rate = len(oos_wins) / len(oos_trades) * 100 if oos_trades else 0
            total_pnl = sum(t.pnl for t in oos_trades)
            result.oos_return_pct = round(total_pnl / self.initial_capital * 100, 2)

        return result

    def _simulate(
        self,
        df: pd.DataFrame,
        signals: pd.Series,
        params: dict,
        skip_flat: bool = False,
    ) -> tuple[list[Trade1H], list[float], float]:
        equity = self.initial_capital
        position: dict | None = None
        trades: list[Trade1H] = []
        equity_curve: list[float] = []
        consec_losses = 0
        daily_counts: dict[str, int] = {}
        extreme_since_entry = 0.0
        worst_unrealized = 0.0
        prev_bar_date = ""

        for i in range(1, len(df)):
            bar = df.iloc[i]
            prev = df.iloc[i - 1]
            bar_date = str(bar.name.date()) if hasattr(bar.name, "date") else str(bar.name)[:10]

            if bar_date != prev_bar_date:
                prev_bar_date = bar_date
                consec_losses = 0
                daily_counts[bar_date] = daily_counts.get(bar_date, 0)

            # ── 1. If in position → check exits ────────────────────
            if position is not None:
                sl = position["sl"]
                tp = position["tp"]
                direction = position["direction"]

                # MAE
                if direction == 1:
                    adverse = (float(bar["low"]) - position["entry_price"]) * position["qty"] * SHARE_SIZE
                else:
                    adverse = (position["entry_price"] - float(bar["high"])) * position["qty"] * SHARE_SIZE
                if adverse < worst_unrealized:
                    worst_unrealized = adverse

                if direction == 1:
                    # Breakeven
                    if params.get("use_breakeven") and not position.get("be_triggered"):
                        be_thresh = position["entry_price"] + params.get("be_atr_mult", 1.0) * position["entry_atr"]
                        if bar["high"] >= be_thresh:
                            position["be_triggered"] = True
                            new_sl = position["entry_price"] + params.get("be_offset_atr", 0.1) * position["entry_atr"]
                            if new_sl > sl:
                                sl = new_sl
                                position["sl"] = sl
                    # Trailing
                    if params.get("use_trailing") and bar["high"] > extreme_since_entry:
                        extreme_since_entry = bar["high"]
                        new_sl = extreme_since_entry - params["trailing_atr_mult"] * prev["atr"]
                        if new_sl > sl:
                            sl = new_sl
                            position["sl"] = sl

                    hit_sl = bar["low"] <= sl
                    hit_tp = bar["high"] >= tp
                else:
                    if params.get("use_breakeven") and not position.get("be_triggered"):
                        be_thresh = position["entry_price"] - params.get("be_atr_mult", 1.0) * position["entry_atr"]
                        if bar["low"] <= be_thresh:
                            position["be_triggered"] = True
                            new_sl = position["entry_price"] - params.get("be_offset_atr", 0.1) * position["entry_atr"]
                            if new_sl < sl:
                                sl = new_sl
                                position["sl"] = sl
                    if params.get("use_trailing") and bar["low"] < extreme_since_entry:
                        extreme_since_entry = bar["low"]
                        new_sl = extreme_since_entry + params["trailing_atr_mult"] * prev["atr"]
                        if new_sl < sl:
                            sl = new_sl
                            position["sl"] = sl

                    hit_sl = bar["high"] >= sl
                    hit_tp = bar["low"] <= tp

                if hit_sl:
                    exit_price = sl
                    pnl = direction * (exit_price - position["entry_price"]) * position["qty"] * SHARE_SIZE
                    pnl_pct = pnl / (self.initial_capital or 1) * 100
                    equity += pnl
                    reason = "SL"
                    if params.get("use_breakeven") and position.get("be_triggered"):
                        if (direction == 1 and sl >= position["entry_price"]) or \
                           (direction == -1 and sl <= position["entry_price"]):
                            reason = "BE"
                    elif params.get("use_trailing") and sl != position["orig_sl"]:
                        reason = "TRAILING"
                    trades.append(Trade1H(
                        entry_time=position["entry_time"],
                        exit_time=bar.name,
                        entry_price=position["entry_price"],
                        exit_price=round(exit_price, 2),
                        qty=position["qty"],
                        pnl=round(pnl, 2),
                        pnl_pct=round(pnl_pct, 2),
                        reason=reason,
                        signal_type=position.get("signal_type", ""),
                        direction="CALL" if direction == 1 else "PUT",
                        mae=round(worst_unrealized, 2),
                        mkt_structure=position.get("mkt_structure", 0),
                    ))
                    consec_losses = consec_losses + 1 if pnl < 0 else 0
                    position = None
                    worst_unrealized = 0.0

                elif hit_tp:
                    exit_price = tp
                    pnl = direction * (exit_price - position["entry_price"]) * position["qty"] * SHARE_SIZE
                    pnl_pct = pnl / (self.initial_capital or 1) * 100
                    equity += pnl
                    trades.append(Trade1H(
                        entry_time=position["entry_time"],
                        exit_time=bar.name,
                        entry_price=position["entry_price"],
                        exit_price=round(exit_price, 2),
                        qty=position["qty"],
                        pnl=round(pnl, 2),
                        pnl_pct=round(pnl_pct, 2),
                        reason="TP",
                        signal_type=position.get("signal_type", ""),
                        direction="CALL" if direction == 1 else "PUT",
                        mae=round(worst_unrealized, 2),
                        mkt_structure=position.get("mkt_structure", 0),
                    ))
                    consec_losses = 0
                    position = None
                    worst_unrealized = 0.0

            # ── 2. No position → consider entry ────────────────────
            sig_val = signals.iloc[i - 1] if i > 0 else 0
            if position is None and sig_val != 0:
                if consec_losses >= self.MAX_CONSEC_LOSSES:
                    equity_curve.append(equity)
                    continue
                if daily_counts.get(bar_date, 0) >= self.MAX_DAILY_TRADES:
                    equity_curve.append(equity)
                    continue

                entry_price = float(bar["open"])
                atr_val = float(prev["atr"]) if not math.isnan(float(prev["atr"])) else 0.0
                if atr_val <= 0:
                    equity_curve.append(equity)
                    continue

                direction = int(sig_val)
                if direction == 1:
                    sl_price = entry_price - params["atr_sl_mult"] * atr_val
                    tp_price = entry_price + params["atr_tp_mult"] * atr_val
                else:
                    sl_price = entry_price + params["atr_sl_mult"] * atr_val
                    tp_price = entry_price - params["atr_tp_mult"] * atr_val

                risk_per_share = abs(entry_price - sl_price) * SHARE_SIZE
                if risk_per_share <= 0:
                    equity_curve.append(equity)
                    continue

                # Position sizing: risk amount / risk per share
                risk_amount = equity * self.risk_per_trade
                qty = max(1, int(risk_amount / risk_per_share))

                sig_type = "PULLBACK"
                if direction == 1 and int(prev.get("breakout", 0)) == 1:
                    sig_type = "BREAKOUT"
                elif direction == -1 and int(prev.get("breakout_low", 0)) == 1:
                    sig_type = "BREAKOUT"

                _mkt_s = int(prev.get("mkt_structure", 0)) if "mkt_structure" in prev.index else 0

                if skip_flat and _mkt_s == 0:
                    equity_curve.append(equity)
                    continue

                position = {
                    "entry_price": entry_price,
                    "sl": sl_price,
                    "orig_sl": sl_price,
                    "tp": tp_price,
                    "qty": qty,
                    "entry_time": bar.name,
                    "signal_type": sig_type,
                    "entry_atr": atr_val,
                    "be_triggered": False,
                    "direction": direction,
                    "mkt_structure": _mkt_s,
                }
                extreme_since_entry = entry_price
                worst_unrealized = 0.0
                daily_counts[bar_date] = daily_counts.get(bar_date, 0) + 1

            # ── 3. Record equity ───────────────────────────────────
            if position is not None:
                d = position["direction"]
                unrealized = d * (float(bar["close"]) - position["entry_price"]) * position["qty"] * SHARE_SIZE
                equity_curve.append(equity + unrealized)
            else:
                equity_curve.append(equity)

        # Close remaining position at last bar
        if position is not None:
            last = df.iloc[-1]
            d = position["direction"]
            pnl = d * (float(last["close"]) - position["entry_price"]) * position["qty"] * SHARE_SIZE
            pnl_pct = pnl / (self.initial_capital or 1) * 100
            equity += pnl
            trades.append(Trade1H(
                entry_time=position["entry_time"],
                exit_time=last.name,
                entry_price=position["entry_price"],
                exit_price=round(float(last["close"]), 2),
                qty=position["qty"],
                pnl=round(pnl, 2),
                pnl_pct=round(pnl_pct, 2),
                reason="EOD",
                signal_type=position.get("signal_type", ""),
                direction="CALL" if d == 1 else "PUT",
                mae=round(worst_unrealized, 2),
                mkt_structure=position.get("mkt_structure", 0),
            ))

        return trades, equity_curve, equity

    @staticmethod
    def _compute_metrics(
        trades: list[Trade1H],
        equity_curve: list[float],
        initial_capital: float,
        params: dict,
    ) -> BacktestResult1H:
        result = BacktestResult1H(
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
        result.win_rate = round(len(wins) / len(trades) * 100, 1) if trades else 0
        result.avg_win = round(sum(t.pnl for t in wins) / len(wins), 2) if wins else 0
        result.avg_loss = round(sum(t.pnl for t in losses) / len(losses), 2) if losses else 0
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

        # Sharpe ratio — 1h bars: ~6.5 bars/day × 252 days
        if len(equity_curve) > 1:
            returns = np.diff(equity_curve) / np.maximum(equity_curve[:-1], 1e-10)
            if returns.std() > 0:
                bars_per_year = 252 * 7  # ~7 hourly bars per US trading day
                result.sharpe_ratio = round(
                    float(returns.mean() / returns.std() * math.sqrt(bars_per_year)), 2
                )

        # Daily P&L breakdown
        day_map: dict[str, dict] = {}
        for t in trades:
            day = str(t.exit_time)[:10]
            if day not in day_map:
                day_map[day] = {"date": day, "pnl": 0.0, "trades": 0, "wins": 0, "losses": 0}
            day_map[day]["pnl"] += t.pnl
            day_map[day]["trades"] += 1
            if t.pnl > 0:
                day_map[day]["wins"] += 1
            else:
                day_map[day]["losses"] += 1
        for d in day_map.values():
            d["pnl"] = round(d["pnl"], 2)
            d["win_rate"] = round(d["wins"] / d["trades"] * 100, 1) if d["trades"] else 0
        result.daily_pnl = sorted(day_map.values(), key=lambda x: x["date"], reverse=True)

        return result
