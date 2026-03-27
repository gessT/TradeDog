"""
MGC Pro Backtester — Enhanced Bar-by-bar Simulation
====================================================
Supports:
  • Long AND short positions
  • ATR-based stop-loss / take-profit
  • Trailing stop (ATR-based)
  • Time-based exit (max bars in trade)
  • No lookahead bias
  • Commission & slippage
  • Consecutive loss pause
  • Walk-forward validation
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
from .strategy_pro import MGCProStrategy

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
    side: str  # "LONG" or "SHORT"
    qty: int
    pnl: float
    pnl_pct: float
    reason: str  # "TP", "SL", "TRAILING", "TIME_EXIT", "EOD"


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
    strategy_type: str = ""


# ═══════════════════════════════════════════════════════════════════════
# Enhanced Backtester
# ═══════════════════════════════════════════════════════════════════════

class ProBacktester:
    """Bar-by-bar backtest engine with long/short, trailing, time exit."""

    def __init__(
        self,
        capital: float = INITIAL_CAPITAL,
        risk_per_trade: float = RISK_PER_TRADE,
        max_consec_losses: int = MAX_CONSECUTIVE_LOSSES,
        max_daily_trades: int = MAX_DAILY_TRADES,
        commission_per_contract: float = 2.50,  # $2.50 per side
        slippage_ticks: int = 1,                # 1 tick slippage
        tick_size: float = 0.10,
    ) -> None:
        self.initial_capital = capital
        self.risk_per_trade = risk_per_trade
        self.max_consec_losses = max_consec_losses
        self.max_daily_trades = max_daily_trades
        self.commission = commission_per_contract
        self.slippage = slippage_ticks * tick_size

    def run(self, df: pd.DataFrame, params: dict | None = None) -> BacktestResult:
        """Execute backtest. Returns BacktestResult."""
        strategy = MGCProStrategy(params)
        p = strategy.p

        df = strategy.compute_indicators(df)
        signals = strategy.generate_signals(df)

        equity = self.initial_capital
        position: dict | None = None
        trades: list[Trade] = []
        equity_curve: list[float] = []
        consec_losses = 0
        daily_counts: dict[str, int] = {}
        best_price_since_entry = 0.0
        bars_in_trade = 0

        for i in range(1, len(df)):
            bar = df.iloc[i]
            prev = df.iloc[i - 1]
            bar_date = str(bar.name.date()) if hasattr(bar.name, "date") else str(bar.name)[:10]

            # ── 1. Manage open position ─────────────────────────────
            if position is not None:
                bars_in_trade += 1
                side = position["side"]
                sl = position["sl"]
                tp = position["tp"]

                # Trailing stop update
                if p.get("use_trailing"):
                    trail_dist = p["trailing_atr_mult"] * prev["atr"]
                    if side == "LONG":
                        if bar["high"] > best_price_since_entry:
                            best_price_since_entry = bar["high"]
                        new_sl = best_price_since_entry - trail_dist
                        if new_sl > sl:
                            sl = new_sl
                            position["sl"] = sl
                    else:  # SHORT
                        if bar["low"] < best_price_since_entry:
                            best_price_since_entry = bar["low"]
                        new_sl = best_price_since_entry + trail_dist
                        if new_sl < sl:
                            sl = new_sl
                            position["sl"] = sl

                # Time exit
                if p.get("use_time_exit") and bars_in_trade >= p["max_bars_in_trade"]:
                    exit_price = bar["close"]
                    pnl = self._calc_pnl(position, exit_price)
                    equity += pnl
                    trades.append(self._make_trade(position, bar.name, exit_price, pnl, "TIME_EXIT"))
                    consec_losses = consec_losses + 1 if pnl < 0 else 0
                    position = None
                    bars_in_trade = 0

                # Check stop-loss
                elif side == "LONG" and bar["low"] <= sl:
                    exit_price = sl - self.slippage  # adverse slippage
                    pnl = self._calc_pnl(position, exit_price)
                    equity += pnl
                    reason = "TRAILING" if p.get("use_trailing") and sl > position["orig_sl"] else "SL"
                    trades.append(self._make_trade(position, bar.name, exit_price, pnl, reason))
                    consec_losses = consec_losses + 1 if pnl < 0 else 0
                    position = None
                    bars_in_trade = 0

                elif side == "SHORT" and bar["high"] >= sl:
                    exit_price = sl + self.slippage
                    pnl = self._calc_pnl(position, exit_price)
                    equity += pnl
                    reason = "TRAILING" if p.get("use_trailing") and sl < position["orig_sl"] else "SL"
                    trades.append(self._make_trade(position, bar.name, exit_price, pnl, reason))
                    consec_losses = consec_losses + 1 if pnl < 0 else 0
                    position = None
                    bars_in_trade = 0

                # Check take-profit
                elif side == "LONG" and bar["high"] >= tp:
                    exit_price = tp - self.slippage  # conservative fill
                    pnl = self._calc_pnl(position, exit_price)
                    equity += pnl
                    trades.append(self._make_trade(position, bar.name, exit_price, pnl, "TP"))
                    consec_losses = 0
                    position = None
                    bars_in_trade = 0

                elif side == "SHORT" and bar["low"] <= tp:
                    exit_price = tp + self.slippage
                    pnl = self._calc_pnl(position, exit_price)
                    equity += pnl
                    trades.append(self._make_trade(position, bar.name, exit_price, pnl, "TP"))
                    consec_losses = 0
                    position = None
                    bars_in_trade = 0

            # ── 2. No position → consider entry ────────────────────
            if position is None and signals.iloc[i - 1] != 0:
                sig = signals.iloc[i - 1]

                # Risk gates
                if consec_losses >= self.max_consec_losses:
                    equity_curve.append(equity)
                    continue
                if daily_counts.get(bar_date, 0) >= self.max_daily_trades:
                    equity_curve.append(equity)
                    continue

                atr_val = prev["atr"]
                if atr_val <= 0 or math.isnan(atr_val):
                    equity_curve.append(equity)
                    continue

                entry_price = bar["open"]

                if sig == 1:  # LONG
                    entry_price += self.slippage
                    sl_price = entry_price - p["atr_sl_mult"] * atr_val
                    tp_price = entry_price + p["atr_tp_mult"] * atr_val
                    side = "LONG"
                elif sig == -1:  # SHORT
                    entry_price -= self.slippage
                    sl_price = entry_price + p["atr_sl_mult"] * atr_val
                    tp_price = entry_price - p["atr_tp_mult"] * atr_val
                    side = "SHORT"
                else:
                    equity_curve.append(equity)
                    continue

                risk_per_contract = abs(entry_price - sl_price) * CONTRACT_SIZE
                if risk_per_contract <= 0:
                    equity_curve.append(equity)
                    continue

                risk_amount = equity * self.risk_per_trade
                qty = max(1, int(risk_amount / risk_per_contract))

                # Commission cost
                entry_commission = self.commission * qty

                position = {
                    "entry_price": entry_price,
                    "sl": sl_price,
                    "orig_sl": sl_price,
                    "tp": tp_price,
                    "qty": qty,
                    "entry_time": bar.name,
                    "side": side,
                    "commission": entry_commission,
                }
                best_price_since_entry = entry_price
                bars_in_trade = 0
                daily_counts[bar_date] = daily_counts.get(bar_date, 0) + 1

            # ── 3. Record equity ───────────────────────────────────
            if position is not None:
                if position["side"] == "LONG":
                    unrealized = (bar["close"] - position["entry_price"]) * position["qty"] * CONTRACT_SIZE
                else:
                    unrealized = (position["entry_price"] - bar["close"]) * position["qty"] * CONTRACT_SIZE
                equity_curve.append(equity + unrealized)
            else:
                equity_curve.append(equity)

        # ── Close remaining position ───────────────────────────────
        if position is not None:
            last = df.iloc[-1]
            exit_price = float(last["close"])
            pnl = self._calc_pnl(position, exit_price)
            equity += pnl
            trades.append(self._make_trade(position, last.name, exit_price, pnl, "EOD"))

        return self._compute_metrics(trades, equity_curve, self.initial_capital, params or {})

    def _calc_pnl(self, position: dict, exit_price: float) -> float:
        """Calculate P&L including commission."""
        qty = position["qty"]
        if position["side"] == "LONG":
            raw_pnl = (exit_price - position["entry_price"]) * qty * CONTRACT_SIZE
        else:
            raw_pnl = (position["entry_price"] - exit_price) * qty * CONTRACT_SIZE
        total_commission = position.get("commission", 0) + self.commission * qty  # entry + exit
        return raw_pnl - total_commission

    def _make_trade(self, position: dict, exit_time, exit_price: float, pnl: float, reason: str) -> Trade:
        pnl_pct = pnl / (self.initial_capital if self.initial_capital else 1) * 100
        return Trade(
            entry_time=position["entry_time"],
            exit_time=exit_time,
            entry_price=position["entry_price"],
            exit_price=exit_price,
            side=position["side"],
            qty=position["qty"],
            pnl=round(pnl, 2),
            pnl_pct=round(pnl_pct, 2),
            reason=reason,
        )

    @staticmethod
    def _compute_metrics(
        trades: list[Trade],
        equity_curve: list[float],
        initial_capital: float,
        params: dict,
    ) -> BacktestResult:
        result = BacktestResult(
            trades=trades,
            equity_curve=equity_curve,
            initial_capital=initial_capital,
            params=params,
            strategy_type=params.get("strategy_type", "unknown"),
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

        # Sharpe ratio (annualised)
        if len(equity_curve) > 1:
            returns = np.diff(equity_curve) / np.maximum(equity_curve[:-1], 1e-10)
            if returns.std() > 0:
                bars_per_year = 252 * 26  # ~6552 15m bars per year
                result.sharpe_ratio = round(
                    float(returns.mean() / returns.std() * math.sqrt(bars_per_year)),
                    2,
                )

        return result


# ═══════════════════════════════════════════════════════════════════════
# Walk-Forward Validation
# ═══════════════════════════════════════════════════════════════════════

def walk_forward_test(
    df: pd.DataFrame,
    params: dict,
    n_splits: int = 3,
    train_ratio: float = 0.7,
    capital: float = INITIAL_CAPITAL,
) -> list[BacktestResult]:
    """Walk-forward out-of-sample testing.

    Splits data into n_splits folds. For each fold:
      - Train on first train_ratio of the fold (not used for param selection here)
      - Test on remaining (1-train_ratio)

    Returns list of BacktestResult for each OOS period.
    """
    total_bars = len(df)
    fold_size = total_bars // n_splits
    oos_results = []

    for fold in range(n_splits):
        start = fold * fold_size
        end = min(start + fold_size, total_bars)
        fold_df = df.iloc[start:end]

        train_end = int(len(fold_df) * train_ratio)
        test_df = fold_df.iloc[train_end:]

        if len(test_df) < 50:
            continue

        bt = ProBacktester(capital=capital)
        result = bt.run(test_df, params)
        oos_results.append(result)

    return oos_results


# ═══════════════════════════════════════════════════════════════════════
# Pretty printer
# ═══════════════════════════════════════════════════════════════════════

def print_result(r: BacktestResult) -> None:
    """Print a backtest summary."""
    print("\n" + "=" * 60)
    print("  MGC PRO BACKTEST RESULTS")
    print("=" * 60)
    print(f"  Strategy Type    : {r.strategy_type.upper()}")
    print(f"  Capital          : ${r.initial_capital:,.0f}")
    print(f"  Final Equity     : ${r.final_equity:,.2f}")
    print(f"  Total Return     : {r.total_return_pct:+.2f} %")
    print(f"  Max Drawdown     : {r.max_drawdown_pct:.2f} %")
    print(f"  Sharpe Ratio     : {r.sharpe_ratio}")
    print("-" * 60)
    print(f"  Total Trades     : {r.total_trades}")
    print(f"  Winners          : {r.winners}")
    print(f"  Losers           : {r.losers}")
    print(f"  Win Rate         : {r.win_rate:.1f} %")
    print(f"  Avg Win          : ${r.avg_win:,.2f}")
    print(f"  Avg Loss         : ${r.avg_loss:,.2f}")
    print(f"  Profit Factor    : {r.profit_factor:.2f}")
    print(f"  Risk/Reward      : 1 : {r.risk_reward_ratio:.2f}")
    print("=" * 60)
