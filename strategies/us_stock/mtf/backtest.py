"""
MTF Backtester — Bar-by-bar on 4H with daily trend exits
==========================================================
Features:
  - ATR-based stop loss (2 × ATR on 4H)
  - Dual take-profit: 50% at 1.5R, rest at 3R
  - Trail SL to breakeven after TP1
  - Exit on daily SuperTrend flip / HalfTrend flip / SMA cross
  - Max hold period (60 × 4H bars ≈ 15 trading days)
  - Position sizing: risk% of equity
"""
from __future__ import annotations

import logging
import math
from dataclasses import dataclass, field

import numpy as np
import pandas as pd

from .config import DEFAULT_MTF_PARAMS, INITIAL_CAPITAL, RISK_PER_TRADE
from .strategy import MTFStrategy

logger = logging.getLogger(__name__)


# ═══════════════════════════════════════════════════════════════════════
# Data classes
# ═══════════════════════════════════════════════════════════════════════

@dataclass
class MTFTrade:
    entry_time: object
    exit_time: object
    entry_price: float
    exit_price: float
    qty: int
    pnl: float
    pnl_pct: float
    reason: str               # "TP1", "TP2", "SL", "ST_FLIP", "HT_FLIP", "SMA_CROSS", "MAX_HOLD"
    r_multiple: float = 0.0
    sl_price: float = 0.0
    tp1_price: float = 0.0
    tp2_price: float = 0.0
    bars_held: int = 0
    direction: str = "LONG"


@dataclass
class MTFResult:
    trades: list[MTFTrade] = field(default_factory=list)
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

class MTFBacktester:
    """Bar-by-bar backtest on 4H bars with daily trend context."""

    def __init__(
        self,
        capital: float = INITIAL_CAPITAL,
        risk_per_trade: float = RISK_PER_TRADE,
    ) -> None:
        self.initial_capital = capital
        self.risk_per_trade = risk_per_trade

    def run(
        self,
        df_4h_raw: pd.DataFrame,
        df_daily_raw: pd.DataFrame,
        params: dict | None = None,
        date_from: str | None = None,
        date_to: str | None = None,
        disabled_conditions: set[str] | None = None,
    ) -> MTFResult:
        """Run backtest.

        Parameters
        ----------
        df_4h_raw : 4H OHLCV
        df_daily_raw : Daily OHLCV
        params : override DEFAULT_MTF_PARAMS
        """
        p = {**DEFAULT_MTF_PARAMS, **(params or {})}
        strategy = MTFStrategy(p)

        # ── Compute indicators ──
        df_d = strategy.compute_daily(
            df_daily_raw[["open", "high", "low", "close", "volume"]].copy()
        )
        df_4h = strategy.compute_4h(
            df_4h_raw[["open", "high", "low", "close", "volume"]].copy()
        )
        df_4h = strategy.merge_daily_into_4h(df_4h, df_d)

        # ── Date filters ──
        if date_from:
            ts = pd.Timestamp(date_from, tz=df_4h.index.tz)
            df_4h = df_4h[df_4h.index >= ts]
        if date_to:
            ts = pd.Timestamp(date_to, tz=df_4h.index.tz) + pd.Timedelta(days=1)
            df_4h = df_4h[df_4h.index < ts]

        if len(df_4h) < 30:
            logger.warning("Not enough 4H bars (%d) for backtest", len(df_4h))
            return self._empty_result(p)

        # ── Signals ──
        signals = strategy.generate_signals(df_4h, disabled=disabled_conditions)
        df_4h["signal"] = signals

        # ── Simulation ──
        equity = self.initial_capital
        peak_equity = equity
        max_dd = 0.0
        trades: list[MTFTrade] = []
        eq_curve: list[float] = [equity]

        # Daily P&L tracking
        daily_pnl_map: dict[str, float] = {}

        # Position state
        in_trade = False
        entry_price = 0.0
        sl_price = 0.0
        tp1_price = 0.0
        tp2_price = 0.0
        qty_total = 0
        qty_remaining = 0
        entry_time = None
        entry_bar = 0
        tp1_hit = False

        for i in range(len(df_4h)):
            bar = df_4h.iloc[i]
            ts = df_4h.index[i]
            bar_date = str(ts)[:10]

            if in_trade:
                bars_held = i - entry_bar
                low_price = float(bar["low"])
                high_price = float(bar["high"])
                close_price = float(bar["close"])

                exit_price = None
                reason = ""

                # ── Check stop loss ──
                if low_price <= sl_price:
                    exit_price = sl_price
                    reason = "SL"

                # ── Check TP1 (partial) ──
                if exit_price is None and not tp1_hit and high_price >= tp1_price:
                    # Close half at TP1
                    tp1_qty = max(1, int(qty_total * p["tp1_exit_pct"]))
                    tp1_pnl = (tp1_price - entry_price) * tp1_qty
                    equity += tp1_pnl
                    qty_remaining -= tp1_qty
                    tp1_hit = True

                    daily_pnl_map[bar_date] = daily_pnl_map.get(bar_date, 0) + tp1_pnl

                    # Move SL to breakeven
                    if p.get("trail_after_tp1", True):
                        sl_price = entry_price

                    if qty_remaining <= 0:
                        # All closed at TP1
                        pnl = tp1_pnl
                        trades.append(MTFTrade(
                            entry_time=entry_time, exit_time=ts,
                            entry_price=entry_price, exit_price=tp1_price,
                            qty=qty_total, pnl=round(pnl, 2),
                            pnl_pct=round(pnl / (entry_price * qty_total) * 100, 2),
                            reason="TP1", bars_held=bars_held,
                            r_multiple=round(p["tp1_r_mult"], 2),
                            sl_price=sl_price, tp1_price=tp1_price, tp2_price=tp2_price,
                        ))
                        in_trade = False
                        eq_curve.append(equity)
                        peak_equity = max(peak_equity, equity)
                        dd = (peak_equity - equity) / peak_equity * 100 if peak_equity > 0 else 0
                        max_dd = max(max_dd, dd)
                        continue

                # ── Check TP2 ──
                if exit_price is None and tp1_hit and high_price >= tp2_price:
                    exit_price = tp2_price
                    reason = "TP2"

                # ── Check daily exit signals ──
                if exit_price is None:
                    # SuperTrend flip
                    if p.get("exit_on_st_flip", True):
                        d_st = bar.get("d_st_dir")
                        if not pd.isna(d_st) and int(d_st) == -1:
                            exit_price = close_price
                            reason = "ST_FLIP"

                    # HalfTrend flip
                    if exit_price is None and p.get("exit_on_ht_flip", True):
                        d_ht = bar.get("d_ht_dir")
                        if not pd.isna(d_ht) and int(d_ht) == 1:
                            exit_price = close_price
                            reason = "HT_FLIP"

                    # SMA cross
                    if exit_price is None and p.get("exit_on_sma_cross", True):
                        d_close = bar.get("d_close")
                        d_sma = bar.get("d_sma_slow")
                        if not pd.isna(d_close) and not pd.isna(d_sma) and d_close < d_sma:
                            exit_price = close_price
                            reason = "SMA_CROSS"

                # ── Max hold ──
                if exit_price is None and bars_held >= p.get("max_hold_bars", 60):
                    exit_price = close_price
                    reason = "MAX_HOLD"

                # ── Execute exit ──
                if exit_price is not None:
                    pnl = (exit_price - entry_price) * qty_remaining
                    if tp1_hit:
                        # TP1 PnL already booked
                        tp1_qty = qty_total - qty_remaining
                        tp1_pnl = (tp1_price - entry_price) * tp1_qty
                        total_pnl = tp1_pnl + pnl
                    else:
                        total_pnl = pnl

                    equity += pnl
                    daily_pnl_map[bar_date] = daily_pnl_map.get(bar_date, 0) + pnl

                    risk_per_share = entry_price - (entry_price - float(df_4h.iloc[entry_bar].get("atr", 1)) * p["atr_sl_mult"])
                    r_mult = total_pnl / (risk_per_share * qty_total) if risk_per_share > 0 and qty_total > 0 else 0

                    trades.append(MTFTrade(
                        entry_time=entry_time, exit_time=ts,
                        entry_price=entry_price, exit_price=round(exit_price, 2),
                        qty=qty_total, pnl=round(total_pnl, 2),
                        pnl_pct=round(total_pnl / (entry_price * qty_total) * 100, 2),
                        reason=reason, bars_held=bars_held,
                        r_multiple=round(r_mult, 2),
                        sl_price=sl_price, tp1_price=tp1_price, tp2_price=tp2_price,
                    ))
                    in_trade = False

            # ── Entry ──
            if not in_trade and int(bar.get("signal", 0)) == 1:
                entry_price = float(bar["close"])
                bar_atr = float(bar.get("atr", entry_price * 0.02))
                if pd.isna(bar_atr) or bar_atr <= 0:
                    bar_atr = entry_price * 0.02

                sl_dist = bar_atr * p["atr_sl_mult"]
                sl_price = entry_price - sl_dist
                tp1_price = entry_price + sl_dist * p["tp1_r_mult"]
                tp2_price = entry_price + sl_dist * p["tp2_r_mult"]

                risk_dollars = equity * self.risk_per_trade
                qty_total = max(1, int(risk_dollars / sl_dist))
                qty_remaining = qty_total
                entry_time = ts
                entry_bar = i
                tp1_hit = False
                in_trade = True

            eq_curve.append(equity)
            peak_equity = max(peak_equity, equity)
            dd = (peak_equity - equity) / peak_equity * 100 if peak_equity > 0 else 0
            max_dd = max(max_dd, dd)

        # ── Build daily P&L list ──
        daily_pnl = [{"date": d, "pnl": round(v, 2)} for d, v in sorted(daily_pnl_map.items())]

        return self._build_result(trades, eq_curve, max_dd, p, daily_pnl)

    # ── Helpers ───────────────────────────────────────────────────

    def _build_result(
        self,
        trades: list[MTFTrade],
        eq_curve: list[float],
        max_dd: float,
        params: dict,
        daily_pnl: list[dict],
    ) -> MTFResult:
        n = len(trades)
        wins = [t for t in trades if t.pnl > 0]
        losses = [t for t in trades if t.pnl <= 0]
        total_win = sum(t.pnl for t in wins)
        total_loss = sum(t.pnl for t in losses)
        final_eq = eq_curve[-1] if eq_curve else self.initial_capital

        # Sharpe
        if len(daily_pnl) > 1:
            pnls = [d["pnl"] for d in daily_pnl]
            mean_pnl = np.mean(pnls)
            std_pnl = np.std(pnls, ddof=1)
            sharpe = (mean_pnl / std_pnl * math.sqrt(252)) if std_pnl > 0 else 0
        else:
            sharpe = 0.0

        avg_w = total_win / len(wins) if wins else 0
        avg_l = total_loss / len(losses) if losses else 0

        return MTFResult(
            trades=trades,
            equity_curve=eq_curve,
            initial_capital=self.initial_capital,
            final_equity=round(final_eq, 2),
            total_return_pct=round((final_eq - self.initial_capital) / self.initial_capital * 100, 2),
            total_trades=n,
            winners=len(wins),
            losers=len(losses),
            win_rate=round(len(wins) / n * 100, 1) if n else 0,
            avg_win=round(avg_w, 2),
            avg_loss=round(avg_l, 2),
            profit_factor=round(abs(total_win / total_loss), 2) if total_loss != 0 else 999.0,
            max_drawdown_pct=round(max_dd, 2),
            sharpe_ratio=round(sharpe, 2),
            expectancy=round((avg_w * len(wins) + avg_l * len(losses)) / n, 2) if n else 0,
            params=params,
            daily_pnl=daily_pnl,
        )

    def _empty_result(self, params: dict) -> MTFResult:
        return MTFResult(
            initial_capital=self.initial_capital,
            final_equity=self.initial_capital,
            params=params,
        )
