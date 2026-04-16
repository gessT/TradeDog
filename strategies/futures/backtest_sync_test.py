"""
SYNC TEST Strategy — Backtest Engine
======================================
Bar-by-bar simulation for the SyncTestStrategy.

  - Enters on signal bars (LONG = +1, SHORT = -1)
  - Exits exactly `hold_bars` bars after entry (no SL/TP)
  - Metrics are used to verify timing consistency, not profitability
"""
from __future__ import annotations

import logging
import math
from dataclasses import dataclass, field

import numpy as np
import pandas as pd

from .strategy_sync_test import SyncTestStrategy, DEFAULT_SYNC_PARAMS

logger = logging.getLogger(__name__)

CONTRACT_SIZE  = 10      # oz per MGC contract
COMMISSION_USD = 0.62    # round-trip per contract


# ═══════════════════════════════════════════════════════════════════════
# Data classes
# ═══════════════════════════════════════════════════════════════════════

@dataclass
class SyncTestTrade:
    entry_time:  object
    exit_time:   object
    entry_price: float
    exit_price:  float
    qty:         int
    pnl:         float
    pnl_pct:     float
    direction:   str       # "LONG" | "SHORT"
    held_bars:   int       # always == hold_bars (validation field)
    reason:      str = "HOLD_EXIT"

    @property
    def win(self) -> bool:
        return self.pnl > 0


@dataclass
class SyncTestBacktestResult:
    trades:           list[SyncTestTrade] = field(default_factory=list)
    equity_curve:     list[float]         = field(default_factory=list)
    initial_capital:  float = 10_000.0
    final_equity:     float = 0.0
    total_return_pct: float = 0.0
    total_trades:     int   = 0
    winners:          int   = 0
    losers:           int   = 0
    win_rate:         float = 0.0
    avg_win_usd:      float = 0.0
    avg_loss_usd:     float = 0.0
    profit_factor:    float = 0.0
    risk_reward:      float = 0.0
    max_drawdown_pct: float = 0.0
    sharpe_ratio:     float = 0.0
    params:           dict  = field(default_factory=dict)


# ═══════════════════════════════════════════════════════════════════════
# Backtester
# ═══════════════════════════════════════════════════════════════════════

class BacktesterSyncTest:

    def __init__(
        self,
        capital: float = 10_000.0,
        contracts: int = 1,
    ) -> None:
        self.initial_capital = capital
        self.contracts       = contracts

    # ------------------------------------------------------------------
    def run(
        self,
        df_5m: pd.DataFrame,
        params: dict | None = None,
    ) -> SyncTestBacktestResult:
        full_params = {**DEFAULT_SYNC_PARAMS, **(params or {})}
        strategy    = SyncTestStrategy(full_params)
        df_ind      = strategy.compute_indicators(df_5m)
        signals     = strategy.generate_signals(df_ind)
        trades, equity_curve = self._simulate(df_ind, signals, full_params)
        return self._compute_metrics(trades, equity_curve, full_params)

    # ------------------------------------------------------------------
    def _simulate(
        self,
        df: pd.DataFrame,
        signals: pd.Series,
        params: dict,
    ) -> tuple[list[SyncTestTrade], list[float]]:
        opens   = df["open"].to_numpy(dtype=np.float64)
        closes  = df["close"].to_numpy(dtype=np.float64)
        sig_arr = signals.to_numpy(dtype=np.int8)
        times   = df.index.tolist()
        hold    = int(params["hold_bars"])

        equity: float = self.initial_capital
        equity_curve: list[float] = [equity]
        trades: list[SyncTestTrade] = []

        # pending: {entry_bar, entry_price, direction, qty}
        pending: dict | None = None

        for i in range(1, len(df)):
            # ── Check if pending position should close ─────────────────
            if pending is not None:
                bars_held = i - pending["entry_bar"]
                if bars_held >= hold:
                    exit_price = float(closes[i])
                    qty        = pending["qty"]
                    if pending["direction"] == "LONG":
                        raw_pnl = (exit_price - pending["entry_price"]) * qty * CONTRACT_SIZE
                    else:
                        raw_pnl = (pending["entry_price"] - exit_price) * qty * CONTRACT_SIZE
                    net_pnl = raw_pnl - COMMISSION_USD * qty
                    equity += net_pnl
                    trades.append(SyncTestTrade(
                        entry_time  = pending["entry_time"],
                        exit_time   = times[i],
                        entry_price = pending["entry_price"],
                        exit_price  = exit_price,
                        qty         = qty,
                        pnl         = round(net_pnl, 2),
                        pnl_pct     = round(net_pnl / self.initial_capital * 100, 4),
                        direction   = pending["direction"],
                        held_bars   = bars_held,
                        reason      = "HOLD_EXIT",
                    ))
                    logger.debug(
                        "SYNC EXIT %s @ %.2f  held=%d bars  pnl=%.2f",
                        times[i], exit_price, bars_held, net_pnl,
                    )
                    pending = None

            # ── Check entry signal (only if flat) ──────────────────────
            if pending is None and sig_arr[i] != 0:
                direction   = "LONG" if sig_arr[i] == 1 else "SHORT"
                entry_price = float(opens[i])
                qty         = self.contracts
                equity     -= COMMISSION_USD * qty
                pending = {
                    "entry_bar":   i,
                    "entry_time":  times[i],
                    "entry_price": entry_price,
                    "direction":   direction,
                    "qty":         qty,
                }
                logger.debug("SYNC ENTRY %s %s @ %.2f", times[i], direction, entry_price)

            equity_curve.append(equity)

        # Force-close any open position at last bar
        if pending is not None:
            exit_price = float(closes[-1])
            qty        = pending["qty"]
            if pending["direction"] == "LONG":
                raw_pnl = (exit_price - pending["entry_price"]) * qty * CONTRACT_SIZE
            else:
                raw_pnl = (pending["entry_price"] - exit_price) * qty * CONTRACT_SIZE
            net_pnl = raw_pnl
            equity += net_pnl
            trades.append(SyncTestTrade(
                entry_time  = pending["entry_time"],
                exit_time   = times[-1],
                entry_price = pending["entry_price"],
                exit_price  = exit_price,
                qty         = qty,
                pnl         = round(net_pnl, 2),
                pnl_pct     = round(net_pnl / self.initial_capital * 100, 4),
                direction   = pending["direction"],
                held_bars   = len(df) - 1 - pending["entry_bar"],
                reason      = "EOD",
            ))
            equity_curve.append(equity)

        return trades, equity_curve

    # ------------------------------------------------------------------
    def _compute_metrics(
        self,
        trades: list[SyncTestTrade],
        equity_curve: list[float],
        params: dict,
    ) -> SyncTestBacktestResult:
        r = SyncTestBacktestResult()
        r.params           = params
        r.initial_capital  = self.initial_capital
        r.trades           = trades
        r.equity_curve     = equity_curve
        r.total_trades     = len(trades)

        if not trades:
            r.final_equity = self.initial_capital
            return r

        wins   = [t for t in trades if t.win]
        losses = [t for t in trades if not t.win]

        r.winners       = len(wins)
        r.losers        = len(losses)
        r.win_rate      = len(wins) / len(trades) * 100
        r.avg_win_usd   = float(np.mean([t.pnl for t in wins]))   if wins   else 0.0
        r.avg_loss_usd  = float(np.mean([t.pnl for t in losses])) if losses else 0.0
        r.risk_reward   = abs(r.avg_win_usd / r.avg_loss_usd) if r.avg_loss_usd != 0 else 0.0

        gross_profit     = sum(t.pnl for t in wins)
        gross_loss       = abs(sum(t.pnl for t in losses))
        r.profit_factor  = gross_profit / gross_loss if gross_loss > 0 else float("inf")

        r.final_equity     = equity_curve[-1] if equity_curve else self.initial_capital
        r.total_return_pct = (r.final_equity - self.initial_capital) / self.initial_capital * 100

        eq   = np.array(equity_curve)
        peak = np.maximum.accumulate(eq)
        dd   = (peak - eq) / peak.clip(min=1e-9) * 100
        r.max_drawdown_pct = float(dd.max())

        pnls = np.array([t.pnl for t in trades])
        if len(pnls) > 1 and pnls.std() > 0:
            r.sharpe_ratio = float(pnls.mean() / pnls.std() * math.sqrt(len(pnls)))
        else:
            r.sharpe_ratio = 0.0

        return r
