"""
VPB v2 Backtester — High Win-Rate Breakout
=============================================
Uses pullback_low as SL (from the two-step retest phase)
instead of breakout candle low for tighter risk.
"""
from __future__ import annotations

import logging
import math
from dataclasses import dataclass, field

import numpy as np
import pandas as pd

from .config import SHARE_SIZE, INITIAL_CAPITAL, RISK_PER_TRADE
from .vpb_v2_strategy import VPBv2Strategy, DEFAULT_VPB2_PARAMS

logger = logging.getLogger(__name__)


@dataclass
class VPB2Trade:
    entry_time: object
    exit_time: object
    entry_price: float
    exit_price: float
    qty: int
    pnl: float
    pnl_pct: float
    reason: str
    direction: str = "LONG"
    mae: float = 0.0
    sl_price: float = 0.0
    tp_price: float = 0.0
    bars_held: int = 0
    entry_hour: int = 0
    signal_type: str = "RETEST"


@dataclass
class VPB2Result:
    trades: list[VPB2Trade] = field(default_factory=list)
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
    daily_pnl: list[dict] = field(default_factory=list)
    session_stats: list[dict] = field(default_factory=list)
    long_stats: dict = field(default_factory=dict)
    short_stats: dict = field(default_factory=dict)
    trade_examples: list[dict] = field(default_factory=list)


class VPB2Backtester:
    """Bar-by-bar backtest engine for VPB v2 strategy."""

    MAX_CONSEC_LOSSES = 3
    MAX_DAILY_TRADES = 5

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
        disabled_conditions: set[str] | None = None,
    ) -> VPB2Result:
        full_params = {**DEFAULT_VPB2_PARAMS, **(params or {})}
        strategy = VPBv2Strategy(full_params)

        df_ind = strategy.compute_indicators(
            df[["open", "high", "low", "close", "volume"]].copy()
        )
        signals = strategy.generate_signals(df_ind, disabled=disabled_conditions)

        trades, curve, _ = self._simulate(df_ind, signals, full_params)
        return self._compute_metrics(trades, curve, self.initial_capital, full_params)

    def _simulate(
        self,
        df: pd.DataFrame,
        signals: pd.Series,
        params: dict,
    ) -> tuple[list[VPB2Trade], list[float], float]:
        equity = self.initial_capital
        position: dict | None = None
        trades: list[VPB2Trade] = []
        equity_curve: list[float] = []
        consec_losses = 0
        daily_counts: dict[str, int] = {}
        worst_unrealized = 0.0
        extreme_since_entry = 0.0
        prev_bar_date = ""

        for i in range(1, len(df)):
            bar = df.iloc[i]
            prev = df.iloc[i - 1]
            bar_date = str(bar.name.date()) if hasattr(bar.name, "date") else str(bar.name)[:10]

            if bar_date != prev_bar_date:
                prev_bar_date = bar_date
                consec_losses = 0
                daily_counts[bar_date] = daily_counts.get(bar_date, 0)

            # ── 1. If in position → check exits ──────────────────
            if position is not None:
                sl = position["sl"]
                tp = position["tp"]
                d = position["direction"]

                # MAE
                if d == 1:
                    adverse = (float(bar["low"]) - position["entry_price"]) * position["qty"] * SHARE_SIZE
                else:
                    adverse = (position["entry_price"] - float(bar["high"])) * position["qty"] * SHARE_SIZE
                if adverse < worst_unrealized:
                    worst_unrealized = adverse

                # Breakeven
                if params.get("use_breakeven") and not position.get("be_triggered"):
                    be_thresh = position["entry_price"] + d * params.get("be_atr_mult", 0.8) * position["entry_atr"]
                    triggered = (d == 1 and bar["high"] >= be_thresh) or (d == -1 and bar["low"] <= be_thresh)
                    if triggered:
                        position["be_triggered"] = True
                        offset = params.get("be_offset_atr", 0.1) * position["entry_atr"]
                        new_sl = position["entry_price"] + d * offset
                        if (d == 1 and new_sl > sl) or (d == -1 and new_sl < sl):
                            sl = new_sl
                            position["sl"] = sl

                # Trailing
                if params.get("use_trailing"):
                    if d == 1 and bar["high"] > extreme_since_entry:
                        extreme_since_entry = bar["high"]
                        new_sl = extreme_since_entry - params["trailing_atr_mult"] * prev["atr"]
                        if new_sl > sl:
                            sl = new_sl
                            position["sl"] = sl
                    elif d == -1 and bar["low"] < extreme_since_entry:
                        extreme_since_entry = bar["low"]
                        new_sl = extreme_since_entry + params["trailing_atr_mult"] * prev["atr"]
                        if new_sl < sl:
                            sl = new_sl
                            position["sl"] = sl

                if d == 1:
                    hit_sl = bar["low"] <= sl
                    hit_tp = bar["high"] >= tp
                else:
                    hit_sl = bar["high"] >= sl
                    hit_tp = bar["low"] <= tp

                exit_price = None
                reason = ""
                if hit_sl:
                    exit_price = sl
                    reason = "SL"
                    if params.get("use_breakeven") and position.get("be_triggered"):
                        if (d == 1 and sl >= position["entry_price"]) or \
                           (d == -1 and sl <= position["entry_price"]):
                            reason = "BE"
                    elif params.get("use_trailing") and sl != position["orig_sl"]:
                        reason = "TRAIL"
                elif hit_tp:
                    exit_price = tp
                    reason = "TP"

                if exit_price is not None:
                    pnl = d * (exit_price - position["entry_price"]) * position["qty"] * SHARE_SIZE
                    pnl_pct = pnl / (self.initial_capital or 1) * 100
                    equity += pnl
                    trades.append(VPB2Trade(
                        entry_time=position["entry_time"],
                        exit_time=bar.name,
                        entry_price=position["entry_price"],
                        exit_price=round(exit_price, 2),
                        qty=position["qty"],
                        pnl=round(pnl, 2),
                        pnl_pct=round(pnl_pct, 2),
                        reason=reason,
                        direction="LONG" if d == 1 else "SHORT",
                        mae=round(worst_unrealized, 2),
                        sl_price=round(position["orig_sl"], 2),
                        tp_price=round(tp, 2),
                        bars_held=i - position["entry_bar_idx"],
                        entry_hour=position.get("entry_hour", 0),
                    ))
                    consec_losses = consec_losses + 1 if pnl < 0 else 0
                    position = None
                    worst_unrealized = 0.0

            # ── 2. No position → consider entry ──────────────────
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
                if atr_val <= 0 or entry_price <= 0:
                    equity_curve.append(equity)
                    continue

                direction = int(sig_val)

                # SL = pullback low (from two-step retest)
                if direction == 1:
                    pb_low = float(prev.get("pullback_low", np.nan))
                    if np.isnan(pb_low):
                        pb_low = float(prev["low"])
                    # Fallback: ensure min SL distance
                    min_sl = entry_price - params["atr_sl_mult"] * atr_val
                    sl_price = max(pb_low, min_sl)  # use pullback low but not too far
                    if sl_price >= entry_price:
                        sl_price = entry_price - params["atr_sl_mult"] * atr_val
                else:
                    # Long-only strategy — skip short signals
                    equity_curve.append(equity)
                    continue

                risk_per_share = abs(entry_price - sl_price) * SHARE_SIZE
                if risk_per_share <= 0:
                    equity_curve.append(equity)
                    continue

                # TP
                risk_distance = abs(entry_price - sl_price)
                if params.get("use_atr_tp"):
                    tp_distance = params["atr_tp_mult"] * atr_val
                else:
                    tp_distance = params["tp_r_multiple"] * risk_distance

                if direction == 1:
                    tp_price = entry_price + tp_distance
                else:
                    tp_price = entry_price - tp_distance

                risk_amount = equity * self.risk_per_trade
                qty = max(1, int(risk_amount / risk_per_share))

                entry_hour = bar.name.hour if hasattr(bar.name, "hour") else 0

                position = {
                    "entry_price": entry_price,
                    "sl": sl_price,
                    "orig_sl": sl_price,
                    "tp": tp_price,
                    "qty": qty,
                    "entry_time": bar.name,
                    "entry_atr": atr_val,
                    "be_triggered": False,
                    "direction": direction,
                    "entry_bar_idx": i,
                    "entry_hour": entry_hour,
                }
                extreme_since_entry = entry_price
                worst_unrealized = 0.0
                daily_counts[bar_date] = daily_counts.get(bar_date, 0) + 1

            # ── 3. Record equity ─────────────────────────────────
            if position is not None:
                d = position["direction"]
                unrealized = d * (float(bar["close"]) - position["entry_price"]) * position["qty"] * SHARE_SIZE
                equity_curve.append(equity + unrealized)
            else:
                equity_curve.append(equity)

        # Close remaining position
        if position is not None:
            last = df.iloc[-1]
            d = position["direction"]
            pnl = d * (float(last["close"]) - position["entry_price"]) * position["qty"] * SHARE_SIZE
            equity += pnl
            trades.append(VPB2Trade(
                entry_time=position["entry_time"],
                exit_time=last.name,
                entry_price=position["entry_price"],
                exit_price=round(float(last["close"]), 2),
                qty=position["qty"],
                pnl=round(pnl, 2),
                pnl_pct=round(pnl / (self.initial_capital or 1) * 100, 2),
                reason="EOD",
                direction="LONG" if d == 1 else "SHORT",
                mae=round(worst_unrealized, 2),
                bars_held=len(df) - 1 - position["entry_bar_idx"],
                entry_hour=position.get("entry_hour", 0),
            ))

        return trades, equity_curve, equity

    @staticmethod
    def _compute_metrics(
        trades: list[VPB2Trade],
        equity_curve: list[float],
        initial_capital: float,
        params: dict,
    ) -> VPB2Result:
        result = VPB2Result(
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

        # Sharpe
        if len(equity_curve) > 1:
            returns = np.diff(equity_curve) / np.maximum(equity_curve[:-1], 1e-10)
            if returns.std() > 0:
                result.sharpe_ratio = round(
                    float(returns.mean() / returns.std() * math.sqrt(252 * 7)), 2
                )

        # Daily P&L
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

        # Session stats
        hour_map: dict[int, dict] = {}
        for t in trades:
            hr = t.entry_hour
            if hr not in hour_map:
                hour_map[hr] = {"hour": hr, "trades": 0, "wins": 0, "pnl": 0.0}
            hour_map[hr]["trades"] += 1
            hour_map[hr]["pnl"] += t.pnl
            if t.pnl > 0:
                hour_map[hr]["wins"] += 1
        for s in hour_map.values():
            s["win_rate"] = round(s["wins"] / s["trades"] * 100, 1) if s["trades"] else 0
            s["pnl"] = round(s["pnl"], 2)
        result.session_stats = sorted(hour_map.values(), key=lambda x: x["pnl"], reverse=True)

        # Long/Short breakdown
        longs = [t for t in trades if t.direction == "LONG"]
        shorts = [t for t in trades if t.direction == "SHORT"]
        for subset, attr in [(longs, "long_stats"), (shorts, "short_stats")]:
            w = [t for t in subset if t.pnl > 0]
            setattr(result, attr, {
                "trades": len(subset),
                "wins": len(w),
                "win_rate": round(len(w) / len(subset) * 100, 1) if subset else 0,
                "pnl": round(sum(t.pnl for t in subset), 2),
            })

        # Trade examples (top 5 winners showing entry quality)
        sorted_trades = sorted(trades, key=lambda t: t.pnl, reverse=True)
        for t in sorted_trades[:5]:
            result.trade_examples.append({
                "entry": str(t.entry_time),
                "exit": str(t.exit_time),
                "dir": t.direction,
                "entry_price": t.entry_price,
                "exit_price": t.exit_price,
                "sl": t.sl_price,
                "tp": t.tp_price,
                "pnl": t.pnl,
                "bars_held": t.bars_held,
                "reason": t.reason,
                "hour": t.entry_hour,
            })

        return result
