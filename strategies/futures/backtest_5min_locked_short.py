"""
GMC 5-Minute Locked Strategy (SHORT) — Backtest Engine
========================================================
Bar-by-bar simulation, SHORT-only mirror of backtest_5min_locked.py.

  - 1-contract SHORT trading
  - ATR-based SL (above entry) / TP (below entry)
  - Optional trailing stop (ratchet per bar from trough)
  - Full metrics: win rate, ROI, Sharpe, max drawdown, profit factor
"""
from __future__ import annotations

import logging
import math
from dataclasses import dataclass, field
from typing import Optional

import numpy as np
import pandas as pd

from .strategy_5min_locked_short import LockedStrategy5MinShort, DEFAULT_LOCKED_SHORT_PARAMS

logger = logging.getLogger(__name__)

CONTRACT_SIZE  = 10      # oz per MGC contract
COMMISSION_USD = 0.62    # round-trip per contract


# ═══════════════════════════════════════════════════════════════════════
# Data classes  (reuse same shape as long version)
# ═══════════════════════════════════════════════════════════════════════

@dataclass
class LockedShortTrade:
    entry_time:  object
    exit_time:   object
    entry_price: float
    exit_price:  float
    sl_price:    float
    tp_price:    float
    qty:         int
    pnl:         float
    pnl_pct:     float
    reason:      str      # "TP" | "SL" | "TRAIL" | "EOD"
    rsi_at_entry:  float = 0.0
    atr_at_entry:  float = 0.0
    st_dir_entry:  int   = -1

    @property
    def win(self) -> bool:
        return self.pnl > 0


@dataclass
class LockedShortBacktestResult:
    trades:           list[LockedShortTrade] = field(default_factory=list)
    equity_curve:     list[float]            = field(default_factory=list)
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

class BacktesterLockedShort5Min:

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
        df_1h: pd.DataFrame | None = None,
        params: dict | None = None,
    ) -> LockedShortBacktestResult:
        full_params = {**DEFAULT_LOCKED_SHORT_PARAMS, **(params or {})}
        strategy    = LockedStrategy5MinShort(full_params)

        df_ind  = strategy.compute_indicators(df_5m, df_1h)
        signals = strategy.generate_signals(df_ind)

        trades, equity_curve = self._simulate(df_ind, signals, strategy, full_params)
        return self._compute_metrics(trades, equity_curve, full_params)

    # ------------------------------------------------------------------
    def _simulate(
        self,
        df: pd.DataFrame,
        signals: pd.Series,
        strategy: LockedStrategy5MinShort,
        params: dict,
    ) -> tuple[list[LockedShortTrade], list[float]]:
        """Bar-by-bar simulation — SHORT side."""
        opens   = df["open"].to_numpy(dtype=np.float64)
        highs   = df["high"].to_numpy(dtype=np.float64)
        lows    = df["low"].to_numpy(dtype=np.float64)
        closes  = df["close"].to_numpy(dtype=np.float64)
        atrs    = df["atr"].to_numpy(dtype=np.float64)
        rsis    = df["rsi"].to_numpy(dtype=np.float64)
        st_dirs = df["st_dir"].to_numpy(dtype=np.int8)
        sig_arr = signals.to_numpy(dtype=np.int8)
        times   = df.index.tolist()

        use_trailing   = bool(params.get("use_trailing", False))
        trail_atr_mult = float(params.get("trail_atr_mult", 1.0))

        equity: float = self.initial_capital
        position: Optional[dict] = None
        trades:       list[LockedShortTrade] = []
        equity_curve: list[float]            = [equity]

        for i in range(1, len(df)):
            atr_val = float(atrs[i - 1])

            # ── Manage open SHORT position ────────────────────────────
            if position is not None:
                sl = position["sl"]
                tp = position["tp"]

                # Optional trailing stop ratchet (short: trail from below)
                if use_trailing and atr_val > 0:
                    trail_level = closes[i] + trail_atr_mult * atr_val
                    if trail_level < sl:
                        position["sl"] = trail_level
                        sl = trail_level

                exit_price: Optional[float] = None
                reason = ""

                # For SHORT: SL triggers when high >= sl, TP when low <= tp
                if lows[i] <= tp:
                    exit_price = tp;  reason = "TP"
                elif highs[i] >= sl:
                    exit_price = sl;  reason = "SL"
                elif use_trailing and highs[i] >= position["sl"]:
                    exit_price = position["sl"];  reason = "TRAIL"

                if exit_price is not None:
                    qty     = position["qty"]
                    # SHORT PnL = (entry - exit) * qty * CONTRACT_SIZE
                    raw_pnl = (position["entry"] - exit_price) * qty * CONTRACT_SIZE
                    net_pnl = raw_pnl - COMMISSION_USD * qty
                    equity += net_pnl
                    trades.append(LockedShortTrade(
                        entry_time   = position["entry_time"],
                        exit_time    = times[i],
                        entry_price  = position["entry"],
                        exit_price   = exit_price,
                        sl_price     = position["sl_orig"],
                        tp_price     = tp,
                        qty          = qty,
                        pnl          = round(net_pnl, 2),
                        pnl_pct      = round(net_pnl / self.initial_capital * 100, 4),
                        reason       = reason,
                        rsi_at_entry = position["rsi"],
                        atr_at_entry = position["atr"],
                        st_dir_entry = position["st_dir"],
                    ))
                    position = None

                equity_curve.append(equity)
                continue

            # ── Check entry signal ────────────────────────────────────
            if sig_arr[i] == 1:
                entry_price = float(opens[i])
                sl, tp      = strategy.get_sl_tp(entry_price, atr_val)
                qty         = self.contracts
                equity     -= COMMISSION_USD * qty
                position = {
                    "entry":      entry_price,
                    "entry_time": times[i],
                    "sl":         sl,
                    "sl_orig":    sl,
                    "tp":         tp,
                    "qty":        qty,
                    "rsi":        float(rsis[i - 1]),
                    "atr":        atr_val,
                    "st_dir":     int(st_dirs[i - 1]),
                }
                logger.debug("SHORT ENTRY %s @ %.2f  SL=%.2f  TP=%.2f", times[i], entry_price, sl, tp)

            equity_curve.append(equity)

        # Force-close open position at last bar
        if position is not None:
            exit_price = float(closes[-1])
            qty        = position["qty"]
            raw_pnl    = (position["entry"] - exit_price) * qty * CONTRACT_SIZE
            net_pnl    = raw_pnl
            equity    += net_pnl
            trades.append(LockedShortTrade(
                entry_time   = position["entry_time"],
                exit_time    = times[-1],
                entry_price  = position["entry"],
                exit_price   = exit_price,
                sl_price     = position["sl_orig"],
                tp_price     = position["tp"],
                qty          = qty,
                pnl          = round(net_pnl, 2),
                pnl_pct      = round(net_pnl / self.initial_capital * 100, 4),
                reason       = "EOD",
                rsi_at_entry = position["rsi"],
                atr_at_entry = position["atr"],
                st_dir_entry = position["st_dir"],
            ))
            equity_curve.append(equity)

        return trades, equity_curve

    # ------------------------------------------------------------------
    def _compute_metrics(
        self,
        trades: list[LockedShortTrade],
        equity_curve: list[float],
        params: dict,
    ) -> LockedShortBacktestResult:
        result               = LockedShortBacktestResult()
        result.params        = params
        result.initial_capital = self.initial_capital
        result.trades        = trades
        result.equity_curve  = equity_curve
        result.total_trades  = len(trades)

        if not trades:
            result.final_equity = self.initial_capital
            return result

        wins   = [t for t in trades if t.win]
        losses = [t for t in trades if not t.win]

        result.winners      = len(wins)
        result.losers       = len(losses)
        result.win_rate     = len(wins) / len(trades) * 100 if trades else 0.0
        result.avg_win_usd  = float(np.mean([t.pnl for t in wins]))   if wins   else 0.0
        result.avg_loss_usd = float(np.mean([t.pnl for t in losses])) if losses else 0.0
        result.risk_reward  = abs(result.avg_win_usd / result.avg_loss_usd) if result.avg_loss_usd != 0 else 0.0

        gross_profit = sum(t.pnl for t in wins)
        gross_loss   = abs(sum(t.pnl for t in losses))
        result.profit_factor = gross_profit / gross_loss if gross_loss > 0 else float("inf")

        result.final_equity     = equity_curve[-1] if equity_curve else self.initial_capital
        result.total_return_pct = (result.final_equity - self.initial_capital) / self.initial_capital * 100

        eq   = np.array(equity_curve)
        peak = np.maximum.accumulate(eq)
        dd   = (peak - eq) / peak.clip(min=1e-9) * 100
        result.max_drawdown_pct = float(dd.max())

        pnls = np.array([t.pnl for t in trades])
        if len(pnls) > 1 and pnls.std() > 0:
            result.sharpe_ratio = float(pnls.mean() / pnls.std() * math.sqrt(len(pnls)))
        else:
            result.sharpe_ratio = 0.0

        return result
