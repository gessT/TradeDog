"""
GMC 2-Minute Backtester
=======================
Bar-by-bar simulation engine for GMCPullbackStrategy.

Features:
  - LONG-only simulation
  - ATR-based SL/TP
  - Per-trade logging (entry/exit price, time, reason, PnL)
  - Full metrics: win rate, ROI, max drawdown, Sharpe, profit factor
  - Equity curve
"""
from __future__ import annotations

import logging
import math
from dataclasses import dataclass, field
from typing import Optional

import numpy as np
import pandas as pd

from .strategy_2min import GMCPullbackStrategy, DEFAULT_PARAMS

logger = logging.getLogger(__name__)

# ── Contract spec ──────────────────────────────────────────────────────
CONTRACT_SIZE   = 10     # oz per MGC contract
COMMISSION_USD  = 0.62   # round-trip commission per contract (NinjaTrader/Tradovate typical)


# ═══════════════════════════════════════════════════════════════════════
# Trade & Result data classes
# ═══════════════════════════════════════════════════════════════════════

@dataclass
class Trade2Min:
    entry_time:  object
    exit_time:   object
    entry_price: float
    exit_price:  float
    sl_price:    float
    tp_price:    float
    qty:         int          # number of contracts
    pnl:         float        # net P&L in USD after commission
    pnl_pct:     float        # P&L as % of entry notional
    reason:      str          # "TP" | "SL" | "EOD"
    rsi_at_entry:   float = 0.0
    atr_at_entry:   float = 0.0
    vol_spike:      bool  = False
    macd_hist:      float = 0.0

    @property
    def win(self) -> bool:
        return self.pnl > 0


@dataclass
class BacktestResult2Min:
    trades:           list[Trade2Min] = field(default_factory=list)
    equity_curve:     list[float]     = field(default_factory=list)
    initial_capital:  float = 10_000.0
    final_equity:     float = 0.0
    # Core metrics
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

class Backtester2Min:
    """
    Bar-by-bar 2-minute backtest engine for GMC pullback strategy.

    Usage::

        bt = Backtester2Min(capital=10_000, risk_per_trade=0.01)
        result = bt.run(df, params=my_params)
    """

    def __init__(
        self,
        capital: float = 10_000.0,
        risk_per_trade: float = 0.01,   # 1% of equity per trade
        contracts: int = 1,              # fixed contracts if risk_mode="fixed"
        risk_mode: str = "risk_pct",     # "risk_pct" | "fixed"
    ) -> None:
        self.initial_capital = capital
        self.risk_per_trade  = risk_per_trade
        self.contracts       = contracts
        self.risk_mode       = risk_mode

    # -----------------------------------------------------------------
    def run(
        self,
        df: pd.DataFrame,
        params: dict | None = None,
    ) -> BacktestResult2Min:
        """
        Run full backtest on *df* (OHLCV, lowercase columns, DatetimeIndex).

        Parameters
        ----------
        df     : OHLCV DataFrame (open/high/low/close/volume)
        params : override DEFAULT_PARAMS keys

        Returns
        -------
        BacktestResult2Min
        """
        full_params = {**DEFAULT_PARAMS, **(params or {})}
        strategy    = GMCPullbackStrategy(full_params)

        # Compute indicators + signals on full history (proper warm-up)
        df_ind  = strategy.compute_indicators(df)
        signals = strategy.generate_signals(df_ind)

        trades, equity_curve = self._simulate(df_ind, signals, strategy, full_params)
        return self._compute_metrics(trades, equity_curve, full_params)

    # -----------------------------------------------------------------
    def _position_size(self, equity: float, entry: float, sl: float) -> int:
        """Calculate number of contracts to trade."""
        if self.risk_mode == "fixed":
            return max(1, self.contracts)
        # Risk-pct: risk N% of equity on SL distance
        risk_usd  = equity * self.risk_per_trade
        sl_dist   = abs(entry - sl) * CONTRACT_SIZE  # per contract dollar risk
        if sl_dist <= 0:
            return 1
        qty = max(1, int(risk_usd / sl_dist))
        return min(qty, 10)   # cap at 10 contracts for safety

    # -----------------------------------------------------------------
    def _simulate(
        self,
        df: pd.DataFrame,
        signals: pd.Series,
        strategy: "GMCPullbackStrategy",
        params: dict,
    ) -> tuple[list[Trade2Min], list[float]]:
        """Bar-by-bar simulation loop — uses numpy arrays for speed."""
        # ── Convert to numpy once (avoids slow pandas iloc in hot loop) ──
        opens   = df["open"].to_numpy(dtype=np.float64)
        highs   = df["high"].to_numpy(dtype=np.float64)
        lows    = df["low"].to_numpy(dtype=np.float64)
        closes  = df["close"].to_numpy(dtype=np.float64)
        atrs    = df["atr"].to_numpy(dtype=np.float64)
        rsis    = df["rsi"].to_numpy(dtype=np.float64)
        vol_sp  = df["vol_spike"].to_numpy(dtype=np.int8)
        mhist   = df["macd_hist"].to_numpy(dtype=np.float64)
        sig_arr = signals.to_numpy(dtype=np.int8)
        times   = df.index.tolist()

        equity: float = self.initial_capital
        position: Optional[dict] = None
        trades:       list[Trade2Min] = []
        equity_curve: list[float]     = [equity]
        is_short = str(params.get("direction", "LONG")).upper() == "SHORT"

        for i in range(1, len(df)):
            atr_val = float(atrs[i - 1])

            # ── Manage open position ──────────────────────────────────
            if position is not None:
                sl = position["sl"]
                tp = position["tp"]
                exit_price: Optional[float] = None
                reason = ""

                if is_short:
                    # SHORT: TP = lows hit below tp, SL = highs hit above sl
                    if lows[i] <= tp:
                        exit_price = tp;    reason = "TP"
                    elif highs[i] >= sl:
                        exit_price = sl;    reason = "SL"
                else:
                    if highs[i] >= tp:
                        exit_price = tp;    reason = "TP"
                    elif lows[i] <= sl:
                        exit_price = sl;    reason = "SL"

                if exit_price is not None:
                    qty     = position["qty"]
                    if is_short:
                        raw_pnl = (position["entry"] - exit_price) * qty * CONTRACT_SIZE
                    else:
                        raw_pnl = (exit_price - position["entry"]) * qty * CONTRACT_SIZE
                    net_pnl = raw_pnl - COMMISSION_USD * qty
                    equity += net_pnl
                    trades.append(Trade2Min(
                        entry_time   = position["entry_time"],
                        exit_time    = times[i],
                        entry_price  = position["entry"],
                        exit_price   = exit_price,
                        sl_price     = sl,
                        tp_price     = tp,
                        qty          = qty,
                        pnl          = round(net_pnl, 2),
                        pnl_pct      = round(net_pnl / self.initial_capital * 100, 4),
                        reason       = reason,
                        rsi_at_entry = position["rsi"],
                        atr_at_entry = position["atr"],
                        vol_spike    = position["vol_spike"],
                        macd_hist    = position["macd_hist"],
                    ))
                    logger.debug("EXIT  %s @ %.2f  %s  PnL=%.2f", times[i], exit_price, reason, net_pnl)
                    position = None

                equity_curve.append(equity)
                continue

            # ── Check entry signal ────────────────────────────────────
            if sig_arr[i] == 1:
                entry_price = float(opens[i])
                sl, tp      = strategy.get_sl_tp(entry_price, atr_val)
                qty         = self._position_size(equity, entry_price, sl)
                equity     -= COMMISSION_USD * qty
                position = {
                    "entry":      entry_price,
                    "entry_time": times[i],
                    "sl":  sl,  "tp": tp,  "qty": qty,
                    "rsi":      float(rsis[i - 1]),
                    "atr":      atr_val,
                    "vol_spike": bool(vol_sp[i - 1]),
                    "macd_hist":float(mhist[i - 1]),
                }
                logger.debug("ENTRY %s @ %.2f  SL=%.2f  TP=%.2f  qty=%d", times[i], entry_price, sl, tp, qty)

            equity_curve.append(equity)

        # Force-close any open position at last bar's close
        if position is not None:
            exit_price = float(closes[-1])
            qty        = position["qty"]
            if is_short:
                raw_pnl = (position["entry"] - exit_price) * qty * CONTRACT_SIZE
            else:
                raw_pnl = (exit_price - position["entry"]) * qty * CONTRACT_SIZE
            net_pnl    = raw_pnl
            equity    += net_pnl
            trades.append(Trade2Min(
                entry_time   = position["entry_time"],
                exit_time    = times[-1],
                entry_price  = position["entry"],
                exit_price   = exit_price,
                sl_price     = position["sl"],
                tp_price     = position["tp"],
                qty          = qty,
                pnl          = round(net_pnl, 2),
                pnl_pct      = round(net_pnl / self.initial_capital * 100, 4),
                reason       = "EOD",
                rsi_at_entry = position["rsi"],
                atr_at_entry = position["atr"],
                vol_spike    = position["vol_spike"],
                macd_hist    = position["macd_hist"],
            ))
            equity_curve.append(equity)

        return trades, equity_curve

    # -----------------------------------------------------------------
    def _compute_metrics(
        self,
        trades: list[Trade2Min],
        equity_curve: list[float],
        params: dict,
    ) -> BacktestResult2Min:
        """Compute all summary statistics from a trade list."""
        n = len(trades)
        if n == 0:
            return BacktestResult2Min(
                trades=[], equity_curve=equity_curve,
                initial_capital=self.initial_capital,
                final_equity=equity_curve[-1] if equity_curve else self.initial_capital,
                params=params,
            )

        winners   = [t for t in trades if t.win]
        losers    = [t for t in trades if not t.win]
        win_rate  = len(winners) / n * 100
        avg_win   = np.mean([t.pnl for t in winners]) if winners else 0.0
        avg_loss  = np.mean([t.pnl for t in losers])  if losers  else 0.0

        gross_win  = sum(t.pnl for t in winners)
        gross_loss = abs(sum(t.pnl for t in losers))
        pf = gross_win / gross_loss if gross_loss > 0 else math.inf
        rr = abs(avg_win / avg_loss) if avg_loss != 0 else math.inf

        final_equity  = equity_curve[-1]
        total_return  = (final_equity - self.initial_capital) / self.initial_capital * 100

        # Max drawdown
        curve = np.array(equity_curve)
        peaks = np.maximum.accumulate(curve)
        dd    = (peaks - curve) / peaks * 100
        max_dd = float(dd.max())

        # Sharpe (annualised from trade PnLs, assuming ~180 trades/year at 2m)
        pnls     = np.array([t.pnl for t in trades])
        mean_pnl = pnls.mean()
        std_pnl  = pnls.std(ddof=1) if len(pnls) > 1 else 1.0
        # Approximate annualisation: 252 trading days × (6.5h×30 bars/h) / cooldown
        bars_per_year = 252 * 6.5 * 30   # ~49k 2-min bars per year
        approx_trades_per_year = bars_per_year / max(
            params.get("cooldown_bars", 3) + 1, 1
        )
        trade_freq = math.sqrt(approx_trades_per_year)
        sharpe = float(mean_pnl / std_pnl * trade_freq) if std_pnl > 0 else 0.0

        return BacktestResult2Min(
            trades           = trades,
            equity_curve     = equity_curve,
            initial_capital  = self.initial_capital,
            final_equity     = round(final_equity, 2),
            total_return_pct = round(total_return, 2),
            total_trades     = n,
            winners          = len(winners),
            losers           = len(losers),
            win_rate         = round(win_rate, 2),
            avg_win_usd      = round(float(avg_win), 2),
            avg_loss_usd     = round(float(avg_loss), 2),
            profit_factor    = round(pf, 2) if not math.isinf(pf) else 999.0,
            risk_reward      = round(rr, 2) if not math.isinf(rr) else 999.0,
            max_drawdown_pct = round(max_dd, 2),
            sharpe_ratio     = round(sharpe, 2),
            params           = params,
        )
