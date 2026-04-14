"""
TPC Backtester — Weekly SuperTrend on 1H bars
================================================
Simple: buy on Weekly ST bullish flip, sell on ST bearish flip.

Features:
  - Weekly + 1H data (no daily needed)
  - ATR-based stop loss
  - Dual take-profit: TP1 partial, TP2 full
  - ATR trailing stop after TP1
  - Exit on weekly SuperTrend flip to bearish
  - Position sizing: risk% of equity
"""
from __future__ import annotations

import logging
import math
from dataclasses import dataclass, field

import numpy as np
import pandas as pd

from .config import DEFAULT_TPC_PARAMS, INITIAL_CAPITAL, RISK_PER_TRADE
from .strategy import TPCStrategy

logger = logging.getLogger(__name__)


# ═══════════════════════════════════════════════════════════════════════
# Data classes
# ═══════════════════════════════════════════════════════════════════════

@dataclass
class TPCTrade:
    entry_time: object
    exit_time: object
    entry_price: float
    exit_price: float
    qty: int
    pnl: float
    pnl_pct: float
    reason: str            # "TP1", "TP2", "SL", "TRAIL", "W_ST_FLIP", "HT_FLIP", "EMA200", "MAX_HOLD"
    r_multiple: float = 0.0
    sl_price: float = 0.0
    tp1_price: float = 0.0
    tp2_price: float = 0.0
    bars_held: int = 0
    direction: str = "LONG"
    mae: float = 0.0


@dataclass
class TPCResult:
    trades: list[TPCTrade] = field(default_factory=list)
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
    expectancy: float = 0.0
    params: dict = field(default_factory=dict)
    daily_pnl: list[dict] = field(default_factory=list)


# ═══════════════════════════════════════════════════════════════════════
# Backtester
# ═══════════════════════════════════════════════════════════════════════

class TPCBacktester:
    """Bar-by-bar backtest engine for TPC strategy."""

    MAX_CONSEC_LOSSES = 3

    def __init__(
        self,
        capital: float = INITIAL_CAPITAL,
        risk_per_trade: float = RISK_PER_TRADE,
    ) -> None:
        self.initial_capital = capital
        self.risk_per_trade = risk_per_trade

    def run(
        self,
        symbol: str = "AAPL",
        period: str = "2y",
        params: dict | None = None,
        disabled_conditions: set[str] | None = None,
        df_weekly: pd.DataFrame | None = None,
        df_daily: pd.DataFrame | None = None,
        df_1h: pd.DataFrame | None = None,
    ) -> TPCResult:
        """Run full backtest: load data → compute indicators → simulate."""
        from strategies.futures.data_loader import load_yfinance

        full_params = {**DEFAULT_TPC_PARAMS, **(params or {})}
        strategy = TPCStrategy(full_params)

        # ── Load data (weekly + daily + 1H needed) ──
        if df_weekly is None:
            df_weekly = load_yfinance(symbol, interval="1wk", period="5y")
        if df_daily is None:
            df_daily = load_yfinance(symbol, interval="1d", period="2y")
        if df_1h is None:
            df_1h = load_yfinance(symbol, interval="1h", period="730d")

        logger.info(
            "Weekly: %d bars, Daily: %d bars, 1H: %d bars",
            len(df_weekly), len(df_daily), len(df_1h),
        )

        # ── Compute indicators ──
        df_weekly = strategy.compute_weekly(df_weekly.copy())
        df_daily = strategy.compute_daily(df_daily[["open", "high", "low", "close", "volume"]].copy())
        df_1h = strategy.compute_1h(df_1h.copy())

        # Merge weekly + daily → 1H
        df_1h = strategy.merge_weekly_into_1h(df_1h, df_weekly)
        df_1h = strategy.merge_daily_into_1h(df_1h, df_daily)

        # ── Generate signals ──
        signals = strategy.generate_signals(df_1h, disabled=disabled_conditions)

        # ── Simulate ──
        trades, curve, _ = self._simulate(df_1h, signals, full_params)
        return self._compute_metrics(trades, curve, self.initial_capital, full_params)

    def _simulate(
        self,
        df: pd.DataFrame,
        signals: pd.Series,
        params: dict,
    ) -> tuple[list[TPCTrade], list[float], float]:
        equity = self.initial_capital
        peak_equity = equity
        max_dd = 0.0
        position: dict | None = None
        trades: list[TPCTrade] = []
        equity_curve: list[float] = [equity]
        consec_losses = 0
        worst_unrealized = 0.0
        extreme_since_entry = 0.0
        daily_pnl_map: dict[str, float] = {}

        for i in range(1, len(df)):
            bar = df.iloc[i]
            prev = df.iloc[i - 1]
            bar_date = str(bar.name.date()) if hasattr(bar.name, "date") else str(bar.name)[:10]

            # ── 1. In position → check exits ──
            if position is not None:
                bars_held = i - position["entry_bar_idx"]
                low_price = float(bar["low"])
                high_price = float(bar["high"])
                close_price = float(bar["close"])

                # MAE tracking
                adverse = (low_price - position["entry_price"]) * position["qty_remaining"]
                if adverse < worst_unrealized:
                    worst_unrealized = adverse

                sl = position["sl"]
                tp1 = position["tp1"]
                tp2 = position["tp2"]
                exit_price = None
                reason = ""

                # ── ATR Trailing stop ──
                if params.get("use_trailing") and position.get("tp1_hit"):
                    if high_price > extreme_since_entry:
                        extreme_since_entry = high_price
                        trail_atr = float(prev["h_atr"]) if "h_atr" in prev.index and not np.isnan(float(prev["h_atr"])) else position["entry_atr"]
                        new_sl = extreme_since_entry - params["trailing_atr_mult"] * trail_atr
                        if new_sl > sl:
                            sl = new_sl
                            position["sl"] = sl

                # ── Check SL ──
                if low_price <= sl:
                    exit_price = sl
                    reason = "TRAIL" if sl != position["orig_sl"] else "SL"

                # ── Check TP1 (partial close) ──
                if exit_price is None and not position.get("tp1_hit") and high_price >= tp1:
                    tp1_qty = max(1, int(position["qty_total"] * params["tp1_exit_pct"]))
                    tp1_pnl = (tp1 - position["entry_price"]) * tp1_qty
                    equity += tp1_pnl
                    position["qty_remaining"] -= tp1_qty
                    position["tp1_hit"] = True
                    position["tp1_pnl"] = tp1_pnl
                    daily_pnl_map[bar_date] = daily_pnl_map.get(bar_date, 0) + tp1_pnl

                    # Move SL to breakeven after TP1
                    if params.get("trail_after_tp1", True):
                        if position["entry_price"] > sl:
                            sl = position["entry_price"]
                            position["sl"] = sl

                    if position["qty_remaining"] <= 0:
                        trades.append(TPCTrade(
                            entry_time=position["entry_time"], exit_time=bar.name,
                            entry_price=position["entry_price"], exit_price=round(tp1, 2),
                            qty=position["qty_total"], pnl=round(tp1_pnl, 2),
                            pnl_pct=round(tp1_pnl / (self.initial_capital or 1) * 100, 2),
                            reason="TP1", bars_held=bars_held,
                            r_multiple=round(params["tp1_r_mult"], 2),
                            sl_price=round(position["orig_sl"], 2),
                            tp1_price=round(tp1, 2), tp2_price=round(tp2, 2),
                            mae=round(worst_unrealized, 2),
                        ))
                        consec_losses = 0
                        position = None
                        worst_unrealized = 0.0
                        equity_curve.append(equity)
                        peak_equity = max(peak_equity, equity)
                        continue

                # ── Check TP2 (full exit) ──
                if exit_price is None and position.get("tp1_hit") and high_price >= tp2:
                    exit_price = tp2
                    reason = "TP2"

                # ── Check daily/weekly exit signals ──
                if exit_price is None:
                    # Weekly SuperTrend flip to bearish → hard exit
                    w_st = bar.get("w_st_dir") if "w_st_dir" in bar.index else np.nan
                    if not np.isnan(w_st) and int(w_st) == -1:
                        exit_price = close_price
                        reason = "W_ST_FLIP"

                # ── Max hold period ──
                if exit_price is None and bars_held >= params.get("max_hold_bars", 999):
                    exit_price = close_price
                    reason = "MAX_HOLD"

                # ── Execute exit ──
                if exit_price is not None:
                    pnl = (exit_price - position["entry_price"]) * position["qty_remaining"]
                    tp1_pnl = position.get("tp1_pnl", 0)
                    total_pnl = tp1_pnl + pnl

                    equity += pnl
                    daily_pnl_map[bar_date] = daily_pnl_map.get(bar_date, 0) + pnl

                    risk_dist = abs(position["entry_price"] - position["orig_sl"])
                    r_mult = total_pnl / (risk_dist * position["qty_total"]) if risk_dist > 0 and position["qty_total"] > 0 else 0

                    trades.append(TPCTrade(
                        entry_time=position["entry_time"], exit_time=bar.name,
                        entry_price=position["entry_price"],
                        exit_price=round(exit_price, 2),
                        qty=position["qty_total"],
                        pnl=round(total_pnl, 2),
                        pnl_pct=round(total_pnl / (self.initial_capital or 1) * 100, 2),
                        reason=reason, bars_held=bars_held,
                        r_multiple=round(r_mult, 2),
                        sl_price=round(position["orig_sl"], 2),
                        tp1_price=round(tp1, 2), tp2_price=round(tp2, 2),
                        mae=round(worst_unrealized, 2),
                    ))
                    consec_losses = consec_losses + 1 if total_pnl < 0 else 0
                    position = None
                    worst_unrealized = 0.0

            # ── 2. No position → consider entry ──
            sig_val = signals.iloc[i - 1] if i > 0 else 0
            if position is None and sig_val == 1:
                if consec_losses >= self.MAX_CONSEC_LOSSES:
                    equity_curve.append(equity)
                    continue

                entry_price = float(bar["open"])
                atr_val = float(prev["h_atr"]) if "h_atr" in prev.index and not math.isnan(float(prev["h_atr"])) else 0.0
                if atr_val <= 0 or entry_price <= 0:
                    equity_curve.append(equity)
                    continue

                # SL: ATR-based
                sl_price = entry_price - params["atr_sl_mult"] * atr_val

                if sl_price >= entry_price:
                    sl_price = entry_price - 0.5 * atr_val
                if sl_price >= entry_price:
                    equity_curve.append(equity)
                    continue

                risk_distance = entry_price - sl_price
                risk_per_share = risk_distance
                if risk_per_share <= 0:
                    equity_curve.append(equity)
                    continue

                # Dual TP
                tp1_price = entry_price + risk_distance * params["tp1_r_mult"]
                tp2_price = entry_price + risk_distance * params["tp2_r_mult"]

                # Position sizing
                risk_amount = equity * self.risk_per_trade
                qty = max(1, int(risk_amount / risk_per_share))

                position = {
                    "entry_price": entry_price,
                    "sl": sl_price,
                    "orig_sl": sl_price,
                    "tp1": tp1_price,
                    "tp2": tp2_price,
                    "qty_total": qty,
                    "qty_remaining": qty,
                    "entry_time": bar.name,
                    "entry_atr": atr_val,
                    "tp1_hit": False,
                    "tp1_pnl": 0.0,
                    "entry_bar_idx": i,
                }
                extreme_since_entry = entry_price
                worst_unrealized = 0.0

            # ── 3. Record equity ──
            if position is not None:
                unrealized = (float(bar["close"]) - position["entry_price"]) * position["qty_remaining"]
                tp1_pnl = position.get("tp1_pnl", 0)
                equity_curve.append(equity + unrealized)
            else:
                equity_curve.append(equity)

            peak_equity = max(peak_equity, equity_curve[-1])
            dd = (peak_equity - equity_curve[-1]) / peak_equity * 100 if peak_equity > 0 else 0
            max_dd = max(max_dd, dd)

        # Close remaining position at last bar
        if position is not None:
            last = df.iloc[-1]
            pnl = (float(last["close"]) - position["entry_price"]) * position["qty_remaining"]
            tp1_pnl = position.get("tp1_pnl", 0)
            total_pnl = tp1_pnl + pnl
            equity += pnl
            trades.append(TPCTrade(
                entry_time=position["entry_time"],
                exit_time=last.name,
                entry_price=position["entry_price"],
                exit_price=round(float(last["close"]), 2),
                qty=position["qty_total"],
                pnl=round(total_pnl, 2),
                pnl_pct=round(total_pnl / (self.initial_capital or 1) * 100, 2),
                reason="EOD",
                bars_held=len(df) - 1 - position["entry_bar_idx"],
                mae=round(worst_unrealized, 2),
            ))

        return trades, equity_curve, equity

    # ═══════════════════════════════════════════════════════
    # Metrics
    # ═══════════════════════════════════════════════════════

    @staticmethod
    def _compute_metrics(
        trades: list[TPCTrade],
        equity_curve: list[float],
        initial_capital: float,
        params: dict,
    ) -> TPCResult:
        result = TPCResult(
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
        total_win_pnl = sum(t.pnl for t in wins)
        total_loss_pnl = sum(t.pnl for t in losses)

        n = len(trades)
        result.total_trades = n
        result.winners = len(wins)
        result.losers = len(losses)
        result.win_rate = round(len(wins) / n * 100, 1) if n else 0
        result.avg_win = round(total_win_pnl / len(wins), 2) if wins else 0
        result.avg_loss = round(total_loss_pnl / len(losses), 2) if losses else 0
        result.profit_factor = round(
            abs(total_win_pnl / total_loss_pnl), 2
        ) if total_loss_pnl != 0 else 999.0
        result.risk_reward_ratio = round(
            abs(result.avg_win / result.avg_loss), 2
        ) if result.avg_loss != 0 else 999.0
        result.expectancy = round(
            (result.avg_win * len(wins) + result.avg_loss * len(losses)) / n, 2
        ) if n else 0

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

        # Sharpe ratio (1H bars: ~7 bars/day × 252 days)
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

        return result
