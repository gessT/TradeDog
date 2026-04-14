"""
VPR Backtester — Bar-by-bar simulation with partial TP
========================================================
Features:
  - ATR-based stop loss (1.3 × ATR)
  - Dual take-profit: 50% at 1R, remainder at 1.8R
  - Max 1 trade per session
  - Position sizing: risk% of equity
  - Explicit trade recording with R-multiples
"""
from __future__ import annotations

import logging
import math
from dataclasses import dataclass, field

import numpy as np
import pandas as pd

from .config import DEFAULT_VPR_PARAMS, INITIAL_CAPITAL, RISK_PER_TRADE
from .strategy import VPRStrategy

logger = logging.getLogger(__name__)


# ═══════════════════════════════════════════════════════════════════════
# Data classes
# ═══════════════════════════════════════════════════════════════════════

@dataclass
class VPRTrade:
    entry_time: object
    exit_time: object
    entry_price: float
    exit_price: float
    qty: int
    pnl: float
    pnl_pct: float
    reason: str              # "TP1", "TP2", "SL", "EOD"
    r_multiple: float = 0.0  # actual R achieved
    sl_price: float = 0.0
    tp1_price: float = 0.0
    tp2_price: float = 0.0
    bars_held: int = 0
    direction: str = "LONG"


@dataclass
class VPRResult:
    trades: list[VPRTrade] = field(default_factory=list)
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
    max_drawdown_pct: float = 0.0
    sharpe_ratio: float = 0.0
    expectancy: float = 0.0
    params: dict = field(default_factory=dict)
    daily_pnl: list[dict] = field(default_factory=list)


# ═══════════════════════════════════════════════════════════════════════
# Backtester
# ═══════════════════════════════════════════════════════════════════════

class VPRBacktester:
    """Bar-by-bar backtest engine for VPR strategy."""

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
        date_from: str | None = None,
        date_to: str | None = None,
        disabled_conditions: set[str] | None = None,
    ) -> VPRResult:
        full_params = {**DEFAULT_VPR_PARAMS, **(params or {})}
        strategy = VPRStrategy(full_params)

        df_work = df[["open", "high", "low", "close", "volume"]].copy()
        df_ind = strategy.compute_indicators(df_work)
        signals = strategy.generate_signals(df_ind, disabled=disabled_conditions)

        # Date filter
        if date_from:
            ts = pd.Timestamp(date_from, tz=df_ind.index.tz) if df_ind.index.tz else pd.Timestamp(date_from)
            mask = df_ind.index >= ts
            df_ind = df_ind[mask]
            signals = signals[mask]
        if date_to:
            ts = pd.Timestamp(date_to, tz=df_ind.index.tz) if df_ind.index.tz else pd.Timestamp(date_to)
            mask = df_ind.index <= ts
            df_ind = df_ind[mask]
            signals = signals[mask]

        trades, curve, equity = self._simulate(df_ind, signals, full_params)
        return self._compute_metrics(trades, curve, self.initial_capital, full_params)

    def _simulate(
        self,
        df: pd.DataFrame,
        signals: pd.Series,
        params: dict,
    ) -> tuple[list[VPRTrade], list[float], float]:
        equity = self.initial_capital
        trades: list[VPRTrade] = []
        equity_curve: list[float] = []
        daily_trade_counts: dict[str, int] = {}

        # Position state
        position: dict | None = None
        tp1_hit = False

        for i in range(1, len(df)):
            bar = df.iloc[i]
            prev = df.iloc[i - 1]
            bar_date = str(bar.name.date()) if hasattr(bar.name, "date") else str(bar.name)[:10]

            # ── 1. If in position → check exits ──────────────────
            if position is not None:
                sl = position["sl"]
                tp1 = position["tp1"]
                tp2 = position["tp2"]
                entry_price = position["entry_price"]
                risk_dist = entry_price - sl  # always positive for longs

                # Check SL hit
                if bar["low"] <= sl:
                    exit_price = sl
                    active_qty = position["active_qty"]
                    pnl = (exit_price - entry_price) * active_qty
                    r_mult = (exit_price - entry_price) / risk_dist if risk_dist > 0 else 0
                    equity += pnl
                    trades.append(VPRTrade(
                        entry_time=position["entry_time"],
                        exit_time=bar.name,
                        entry_price=entry_price,
                        exit_price=round(exit_price, 2),
                        qty=active_qty,
                        pnl=round(pnl, 2),
                        pnl_pct=round(pnl / self.initial_capital * 100, 2),
                        reason="SL",
                        r_multiple=round(r_mult, 2),
                        sl_price=round(sl, 2),
                        tp1_price=round(tp1, 2),
                        tp2_price=round(tp2, 2),
                        bars_held=i - position["entry_idx"],
                    ))
                    position = None
                    tp1_hit = False
                    equity_curve.append(equity)
                    continue

                # Check TP1 (partial exit)
                if not tp1_hit and bar["high"] >= tp1:
                    tp1_hit = True
                    exit_qty = int(position["full_qty"] * params["tp1_exit_pct"])
                    if exit_qty < 1:
                        exit_qty = 1
                    pnl_partial = (tp1 - entry_price) * exit_qty
                    equity += pnl_partial
                    position["active_qty"] -= exit_qty
                    trades.append(VPRTrade(
                        entry_time=position["entry_time"],
                        exit_time=bar.name,
                        entry_price=entry_price,
                        exit_price=round(tp1, 2),
                        qty=exit_qty,
                        pnl=round(pnl_partial, 2),
                        pnl_pct=round(pnl_partial / self.initial_capital * 100, 2),
                        reason="TP1",
                        r_multiple=round(params["tp1_r_mult"], 2),
                        sl_price=round(sl, 2),
                        tp1_price=round(tp1, 2),
                        tp2_price=round(tp2, 2),
                        bars_held=i - position["entry_idx"],
                    ))
                    # Move SL to breakeven after TP1
                    position["sl"] = entry_price
                    sl = entry_price

                    if position["active_qty"] <= 0:
                        position = None
                        tp1_hit = False
                        equity_curve.append(equity)
                        continue

                # Check TP2 (final exit)
                if tp1_hit and bar["high"] >= tp2:
                    active_qty = position["active_qty"]
                    pnl = (tp2 - entry_price) * active_qty
                    equity += pnl
                    trades.append(VPRTrade(
                        entry_time=position["entry_time"],
                        exit_time=bar.name,
                        entry_price=entry_price,
                        exit_price=round(tp2, 2),
                        qty=active_qty,
                        pnl=round(pnl, 2),
                        pnl_pct=round(pnl / self.initial_capital * 100, 2),
                        reason="TP2",
                        r_multiple=round(params["tp2_r_mult"], 2),
                        sl_price=round(sl, 2),
                        tp1_price=round(tp1, 2),
                        tp2_price=round(tp2, 2),
                        bars_held=i - position["entry_idx"],
                    ))
                    position = None
                    tp1_hit = False
                    equity_curve.append(equity)
                    continue

                # Unrealized equity
                unrealized = (float(bar["close"]) - entry_price) * position["active_qty"]
                equity_curve.append(equity + unrealized)
                continue

            # ── 2. No position → consider entry ──────────────────
            sig = signals.iloc[i - 1] if i > 0 else 0
            if sig != 1:
                equity_curve.append(equity)
                continue

            # Max trades per session
            if daily_trade_counts.get(bar_date, 0) >= params["max_trades_per_session"]:
                equity_curve.append(equity)
                continue

            entry_price = float(bar["open"])
            atr_val = float(prev["atr"])
            if math.isnan(atr_val) or atr_val <= 0 or entry_price <= 0:
                equity_curve.append(equity)
                continue

            # SL / TP levels
            sl_price = entry_price - params["atr_sl_mult"] * atr_val
            risk_dist = entry_price - sl_price
            if risk_dist <= 0:
                equity_curve.append(equity)
                continue

            tp1_price = entry_price + params["tp1_r_mult"] * risk_dist
            tp2_price = entry_price + params["tp2_r_mult"] * risk_dist

            # Position sizing: risk amount / risk per share
            risk_amount = equity * self.risk_per_trade
            qty = max(1, int(risk_amount / risk_dist))

            position = {
                "entry_price": entry_price,
                "sl": sl_price,
                "tp1": tp1_price,
                "tp2": tp2_price,
                "full_qty": qty,
                "active_qty": qty,
                "entry_time": bar.name,
                "entry_idx": i,
            }
            tp1_hit = False
            daily_trade_counts[bar_date] = daily_trade_counts.get(bar_date, 0) + 1
            equity_curve.append(equity)

        # Close remaining position at last bar
        if position is not None:
            last = df.iloc[-1]
            entry_price = position["entry_price"]
            active_qty = position["active_qty"]
            exit_price = float(last["close"])
            pnl = (exit_price - entry_price) * active_qty
            risk_dist = entry_price - position["sl"]
            r_mult = (exit_price - entry_price) / risk_dist if risk_dist > 0 else 0
            equity += pnl
            trades.append(VPRTrade(
                entry_time=position["entry_time"],
                exit_time=last.name,
                entry_price=entry_price,
                exit_price=round(exit_price, 2),
                qty=active_qty,
                pnl=round(pnl, 2),
                pnl_pct=round(pnl / self.initial_capital * 100, 2),
                reason="EOD",
                r_multiple=round(r_mult, 2),
                sl_price=round(position["sl"], 2),
                tp1_price=round(position["tp1"], 2),
                tp2_price=round(position["tp2"], 2),
                bars_held=len(df) - 1 - position["entry_idx"],
            ))

        return trades, equity_curve, equity

    @staticmethod
    def _compute_metrics(
        trades: list[VPRTrade],
        equity_curve: list[float],
        initial_capital: float,
        params: dict,
    ) -> VPRResult:
        result = VPRResult(
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

        total_win_pnl = sum(t.pnl for t in wins)
        total_loss_pnl = sum(t.pnl for t in losses)
        result.profit_factor = round(
            abs(total_win_pnl / total_loss_pnl), 2
        ) if total_loss_pnl != 0 else 999.0

        final_eq = equity_curve[-1] if equity_curve else initial_capital
        result.final_equity = round(final_eq, 2)
        result.total_return_pct = round(
            (final_eq - initial_capital) / initial_capital * 100, 2
        )

        # Expectancy = (WR × avg_win) + ((1-WR) × avg_loss)
        wr = result.win_rate / 100
        result.expectancy = round(
            wr * result.avg_win + (1 - wr) * result.avg_loss, 2
        )

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

        # Sharpe ratio (annualised for hourly bars)
        if len(equity_curve) > 1:
            returns = np.diff(equity_curve) / np.maximum(equity_curve[:-1], 1e-10)
            if returns.std() > 0:
                bars_per_year = 252 * 7
                result.sharpe_ratio = round(
                    float(returns.mean() / returns.std() * math.sqrt(bars_per_year)), 2
                )

        # Daily P&L
        day_map: dict[str, dict] = {}
        for t in trades:
            day = str(t.exit_time)[:10]
            if day not in day_map:
                day_map[day] = {"date": day, "pnl": 0.0, "trades": 0, "wins": 0}
            day_map[day]["pnl"] += t.pnl
            day_map[day]["trades"] += 1
            if t.pnl > 0:
                day_map[day]["wins"] += 1
        for d in day_map.values():
            d["pnl"] = round(d["pnl"], 2)
        result.daily_pnl = sorted(day_map.values(), key=lambda x: x["date"], reverse=True)

        return result
