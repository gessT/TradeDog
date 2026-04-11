"""
MGC Backtester — Bar-by-bar Simulation Engine
==============================================
• No lookahead bias — signals at bar *i* enter at open of bar *i+1*.
• Realistic position sizing based on 1 % account risk.
• Full trade log + equity curve + performance metrics.
"""
from __future__ import annotations

import logging
import math
from dataclasses import dataclass, field

import numpy as np
import pandas as pd

from .config import (
    CONTRACT_SIZE,
    INITIAL_CAPITAL,
    MAX_CONSECUTIVE_LOSSES,
    MAX_DAILY_TRADES,
    RISK_PER_TRADE,
)
from .strategy import MGCStrategy

logger = logging.getLogger(__name__)


# ═══════════════════════════════════════════════════════════════════════
# Data classes
# ═══════════════════════════════════════════════════════════════════════

@dataclass
class Trade:
    entry_time: object
    exit_time: object
    entry_price: float
    exit_price: float
    qty: int
    pnl: float
    pnl_pct: float
    reason: str  # "TP", "SL", "TRAILING", "EOD"


@dataclass
class BacktestResult:
    trades: list[Trade] = field(default_factory=list)
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


# ═══════════════════════════════════════════════════════════════════════
# Backtester
# ═══════════════════════════════════════════════════════════════════════

class Backtester:
    """Bar-by-bar backtest engine for the MGC long-only strategy."""

    def __init__(
        self,
        capital: float = INITIAL_CAPITAL,
        risk_per_trade: float = RISK_PER_TRADE,
        max_consec_losses: int = MAX_CONSECUTIVE_LOSSES,
        max_daily_trades: int = MAX_DAILY_TRADES,
    ) -> None:
        self.initial_capital = capital
        self.risk_per_trade = risk_per_trade
        self.max_consec_losses = max_consec_losses
        self.max_daily_trades = max_daily_trades

    # ── Main entry point ────────────────────────────────────────────
    def run(self, df: pd.DataFrame, params: dict | None = None, interval: str = "15m") -> BacktestResult:
        """Execute the backtest. Returns a ``BacktestResult``."""
        self._interval = interval
        strategy = MGCStrategy(params)
        p = strategy.p

        df = strategy.compute_indicators(df)
        signals = strategy.generate_signals(df)

        equity = self.initial_capital
        position: dict | None = None
        trades: list[Trade] = []
        equity_curve: list[float] = []
        consec_losses = 0
        daily_counts: dict[str, int] = {}
        highest_since_entry = 0.0

        for i in range(1, len(df)):
            bar = df.iloc[i]
            prev = df.iloc[i - 1]
            bar_date = str(bar.name.date()) if hasattr(bar.name, "date") else str(bar.name)[:10]

            # ── 1. If in position → check exits ────────────────────
            if position is not None:
                sl = position["sl"]
                tp = position["tp"]

                # Trailing stop update
                if p.get("use_trailing") and bar["high"] > highest_since_entry:
                    highest_since_entry = bar["high"]
                    new_sl = highest_since_entry - p["trailing_atr_mult"] * prev["atr"]
                    if new_sl > sl:
                        sl = new_sl
                        position["sl"] = sl

                # Check SL first (conservative: assume worst fill)
                if bar["low"] <= sl:
                    exit_price = sl
                    pnl = (exit_price - position["entry_price"]) * position["qty"] * CONTRACT_SIZE
                    pnl_pct = pnl / (self.initial_capital if self.initial_capital else 1) * 100
                    equity += pnl
                    trades.append(Trade(
                        entry_time=position["entry_time"],
                        exit_time=bar.name,
                        entry_price=position["entry_price"],
                        exit_price=exit_price,
                        qty=position["qty"],
                        pnl=round(pnl, 2),
                        pnl_pct=round(pnl_pct, 2),
                        reason="TRAILING" if p.get("use_trailing") and sl > position["orig_sl"] else "SL",
                    ))
                    consec_losses = consec_losses + 1 if pnl < 0 else 0
                    position = None

                elif bar["high"] >= tp:
                    exit_price = tp
                    pnl = (exit_price - position["entry_price"]) * position["qty"] * CONTRACT_SIZE
                    pnl_pct = pnl / (self.initial_capital if self.initial_capital else 1) * 100
                    equity += pnl
                    trades.append(Trade(
                        entry_time=position["entry_time"],
                        exit_time=bar.name,
                        entry_price=position["entry_price"],
                        exit_price=exit_price,
                        qty=position["qty"],
                        pnl=round(pnl, 2),
                        pnl_pct=round(pnl_pct, 2),
                        reason="TP",
                    ))
                    consec_losses = 0
                    position = None

            # ── 2. No position → consider entry ────────────────────
            if position is None and signals.iloc[i - 1] == 1:
                # Risk-management gates
                if consec_losses >= self.max_consec_losses:
                    equity_curve.append(equity)
                    continue
                if daily_counts.get(bar_date, 0) >= self.max_daily_trades:
                    equity_curve.append(equity)
                    continue

                entry_price = bar["open"]  # enter at open of this bar
                atr_val = prev["atr"]
                if atr_val <= 0 or math.isnan(atr_val):
                    equity_curve.append(equity)
                    continue

                sl_price = entry_price - p["atr_sl_mult"] * atr_val
                tp_price = entry_price + p["atr_tp_mult"] * atr_val

                risk_per_contract = abs(entry_price - sl_price) * CONTRACT_SIZE
                if risk_per_contract <= 0:
                    equity_curve.append(equity)
                    continue

                risk_amount = equity * self.risk_per_trade
                qty = max(1, int(risk_amount / risk_per_contract))

                position = {
                    "entry_price": entry_price,
                    "sl": sl_price,
                    "orig_sl": sl_price,
                    "tp": tp_price,
                    "qty": qty,
                    "entry_time": bar.name,
                }
                highest_since_entry = entry_price
                daily_counts[bar_date] = daily_counts.get(bar_date, 0) + 1

            # ── 3. Record equity ───────────────────────────────────
            if position is not None:
                unrealized = (bar["close"] - position["entry_price"]) * position["qty"] * CONTRACT_SIZE
                equity_curve.append(equity + unrealized)
            else:
                equity_curve.append(equity)

        # ── Close any remaining position at last close ─────────────
        if position is not None:
            last = df.iloc[-1]
            pnl = (last["close"] - position["entry_price"]) * position["qty"] * CONTRACT_SIZE
            pnl_pct = pnl / (self.initial_capital if self.initial_capital else 1) * 100
            equity += pnl
            trades.append(Trade(
                entry_time=position["entry_time"],
                exit_time=last.name,
                entry_price=position["entry_price"],
                exit_price=float(last["close"]),
                qty=position["qty"],
                pnl=round(pnl, 2),
                pnl_pct=round(pnl_pct, 2),
                reason="EOD",
            ))

        return self._compute_metrics(trades, equity_curve, self.initial_capital, params or {}, getattr(self, '_interval', '15m'))

    # ── Metrics computation ─────────────────────────────────────────
    @staticmethod
    def _compute_metrics(
        trades: list[Trade],
        equity_curve: list[float],
        initial_capital: float,
        params: dict,
        interval: str = "15m",
    ) -> BacktestResult:
        result = BacktestResult(
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
        result.win_rate = len(wins) / len(trades) * 100 if trades else 0
        result.avg_win = sum(t.pnl for t in wins) / len(wins) if wins else 0
        result.avg_loss = sum(t.pnl for t in losses) / len(losses) if losses else 0
        result.profit_factor = (
            abs(sum(t.pnl for t in wins) / sum(t.pnl for t in losses))
            if losses and sum(t.pnl for t in losses) != 0 else 999.0
        )
        result.risk_reward_ratio = (
            abs(result.avg_win / result.avg_loss)
            if result.avg_loss != 0 else 999.0
        )

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

        # Sharpe ratio (annualised, bars-per-day scaled to interval)
        _bars_per_day = {"1m": 390, "5m": 78, "15m": 26, "30m": 13, "1h": 7, "1d": 1}
        if len(equity_curve) > 1:
            returns = np.diff(equity_curve) / np.maximum(equity_curve[:-1], 1e-10)
            if returns.std() > 0:
                bars_per_year = 252 * _bars_per_day.get(interval, 26)
                result.sharpe_ratio = round(
                    float(returns.mean() / returns.std() * math.sqrt(bars_per_year)),
                    2,
                )

        return result


# ═══════════════════════════════════════════════════════════════════════
# Pretty printer
# ═══════════════════════════════════════════════════════════════════════

def print_result(r: BacktestResult) -> None:
    """Print a backtest summary to stdout."""
    print("\n" + "═" * 60)
    print("  📊  MGC BACKTEST RESULTS")
    print("═" * 60)
    print(f"  Capital          : ${r.initial_capital:,.0f}")
    print(f"  Final Equity     : ${r.final_equity:,.2f}")
    print(f"  Total Return     : {r.total_return_pct:+.2f} %")
    print(f"  Max Drawdown     : {r.max_drawdown_pct:.2f} %")
    print(f"  Sharpe Ratio     : {r.sharpe_ratio}")
    print("─" * 60)
    print(f"  Total Trades     : {r.total_trades}")
    print(f"  Winners          : {r.winners}")
    print(f"  Losers           : {r.losers}")
    print(f"  Win Rate         : {r.win_rate:.1f} %")
    print(f"  Avg Win          : ${r.avg_win:,.2f}")
    print(f"  Avg Loss         : ${r.avg_loss:,.2f}")
    print(f"  Profit Factor    : {r.profit_factor:.2f}")
    print(f"  Risk/Reward      : 1 : {r.risk_reward_ratio:.2f}")
    print("═" * 60)
    if r.params:
        print("  Parameters:")
        for k, v in r.params.items():
            print(f"    {k:24s} = {v}")
        print("═" * 60)
