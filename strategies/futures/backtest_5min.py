"""
5-Minute Backtester — Dedicated bar-by-bar simulation for 5min strategy
========================================================================
• Uses MGCStrategy5Min for signal generation
• Out-of-sample split (70/30) to detect overfitting
• Same bar-by-bar engine as main Backtester with 5min defaults
"""
from __future__ import annotations

import logging
import math
from dataclasses import dataclass, field

import numpy as np
import pandas as pd

from .config import CONTRACT_SIZE, INITIAL_CAPITAL, RISK_PER_TRADE
from .strategy_5min import MGCStrategy5Min, DEFAULT_5MIN_PARAMS

logger = logging.getLogger(__name__)


# ═══════════════════════════════════════════════════════════════════════
# Data classes (same shape as main backtest for API compatibility)
# ═══════════════════════════════════════════════════════════════════════

@dataclass
class Trade5Min:
    entry_time: object
    exit_time: object
    entry_price: float
    exit_price: float
    qty: int
    pnl: float
    pnl_pct: float
    reason: str  # "TP", "SL", "TRAILING", "EOD"
    signal_type: str = ""  # "PULLBACK" / "BREAKOUT"
    direction: str = "CALL"  # "CALL" (long) / "PUT" (short)
    mae: float = 0.0  # Max Adverse Excursion (worst unrealized loss in $)
    mkt_structure: int = 0  # Market structure at entry: 1=BULL, -1=BEAR, 0=SIDEWAYS
    sl: float = 0.0  # Stop-loss price at exit
    tp: float = 0.0  # Take-profit price at exit


@dataclass
class BacktestResult5Min:
    trades: list[Trade5Min] = field(default_factory=list)
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
    # Out-of-sample metrics
    oos_win_rate: float = 0.0
    oos_total_trades: int = 0
    oos_return_pct: float = 0.0
    # Daily P&L breakdown
    daily_pnl: list[dict] = field(default_factory=list)
    # Daily loss limit metrics
    worst_daily_loss: float = 0.0      # most negative single-day P&L
    days_stopped: int = 0              # days where daily loss limit was hit


# ═══════════════════════════════════════════════════════════════════════
# Backtester5Min
# ═══════════════════════════════════════════════════════════════════════

class Backtester5Min:
    """5-minute bar-by-bar backtest engine with out-of-sample support."""

    # Risk management defaults (tighter for 5min)
    MAX_CONSEC_LOSSES = 4
    MAX_DAILY_TRADES = 30

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
        skip_counter_trend: bool = False,
        daily_loss_limit: float = 0.0,
        skip_hours: set[int] | None = None,
        max_loss_per_trade: float = 0.0,
    ) -> BacktestResult5Min:
        """Execute 5min backtest.

        Indicators are computed on the full *df* so they are properly warmed
        up regardless of which date range the caller later displays.
        If *oos_split* > 0 (e.g. 0.3), split data 70/30 and report
        out-of-sample metrics separately.
        *disabled_conditions*: condition keys to skip (treat as always True).
        *daily_loss_limit*: if > 0, stop new entries for the day once
        cumulative realized P&L drops to this amount (e.g. 350 = stop after -$350).
        """
        full_params = {**DEFAULT_5MIN_PARAMS, **(params or {})}
        strategy = MGCStrategy5Min(full_params)

        # Resolve filter flags: explicit args override, else read from params
        _skip_flat = skip_flat or full_params.get("skip_flat", False)
        _skip_counter = skip_counter_trend or full_params.get("skip_counter_trend", False)

        # Compute indicators on full dataset (including warmup bars)
        df_ind = strategy.compute_indicators(
            df[["open", "high", "low", "close", "volume"]].copy()
        )
        signals = strategy.generate_signals(df_ind, disabled=disabled_conditions)

        # In-sample run (full data or first portion)
        if oos_split > 0:
            split_idx = int(len(df_ind) * (1 - oos_split))
            is_trades, is_curve, is_equity = self._simulate(
                df_ind.iloc[:split_idx], signals.iloc[:split_idx], full_params,
                skip_flat=_skip_flat, skip_counter_trend=_skip_counter,
                daily_loss_limit=daily_loss_limit,
                skip_hours=skip_hours, max_loss_per_trade=max_loss_per_trade,
            )
            # Out-of-sample run — chain from IS ending equity
            saved_capital = self.initial_capital
            self.initial_capital = is_equity
            oos_trades, oos_curve, oos_equity = self._simulate(
                df_ind.iloc[split_idx:], signals.iloc[split_idx:], full_params,
                skip_flat=_skip_flat, skip_counter_trend=_skip_counter,
                daily_loss_limit=daily_loss_limit,
                skip_hours=skip_hours, max_loss_per_trade=max_loss_per_trade,
            )
            self.initial_capital = saved_capital
            # Merge curves
            all_trades = is_trades + oos_trades
            all_curve = is_curve + oos_curve
        else:
            all_trades, all_curve, _ = self._simulate(df_ind, signals, full_params, skip_flat=_skip_flat, skip_counter_trend=_skip_counter, daily_loss_limit=daily_loss_limit, skip_hours=skip_hours, max_loss_per_trade=max_loss_per_trade)
            is_trades = all_trades
            oos_trades = []

        result = self._compute_metrics(all_trades, all_curve, self.initial_capital, full_params, daily_loss_limit=daily_loss_limit)

        # OOS metrics
        if oos_trades:
            oos_wins = [t for t in oos_trades if t.pnl > 0]
            result.oos_total_trades = len(oos_trades)
            result.oos_win_rate = len(oos_wins) / len(oos_trades) * 100 if oos_trades else 0
            total_pnl = sum(t.pnl for t in oos_trades)
            result.oos_return_pct = round(total_pnl / self.initial_capital * 100, 2)

        return result

    def run_from_precomputed(
        self,
        df_ind: pd.DataFrame,
        signals: pd.Series,
        full_params: dict,
        oos_split: float = 0.0,
        skip_flat: bool = False,
        skip_counter_trend: bool = False,
        daily_loss_limit: float = 0.0,
        skip_hours: set[int] | None = None,
        max_loss_per_trade: float = 0.0,
    ) -> BacktestResult5Min:
        """Run backtest with pre-computed indicators and signals (fast path for optimizer)."""
        if oos_split > 0:
            split_idx = int(len(df_ind) * (1 - oos_split))
            is_trades, is_curve, is_equity = self._simulate(
                df_ind.iloc[:split_idx], signals.iloc[:split_idx], full_params,
                skip_flat=skip_flat, skip_counter_trend=skip_counter_trend,
                daily_loss_limit=daily_loss_limit,
                skip_hours=skip_hours, max_loss_per_trade=max_loss_per_trade,
            )
            saved_capital = self.initial_capital
            self.initial_capital = is_equity
            oos_trades, oos_curve, _ = self._simulate(
                df_ind.iloc[split_idx:], signals.iloc[split_idx:], full_params,
                skip_flat=skip_flat, skip_counter_trend=skip_counter_trend,
                daily_loss_limit=daily_loss_limit,
                skip_hours=skip_hours, max_loss_per_trade=max_loss_per_trade,
            )
            self.initial_capital = saved_capital
            all_trades = is_trades + oos_trades
            all_curve = is_curve + oos_curve
        else:
            all_trades, all_curve, _ = self._simulate(
                df_ind, signals, full_params,
                skip_flat=skip_flat, skip_counter_trend=skip_counter_trend,
                daily_loss_limit=daily_loss_limit,
                skip_hours=skip_hours, max_loss_per_trade=max_loss_per_trade,
            )
            oos_trades = []

        result = self._compute_metrics(all_trades, all_curve, self.initial_capital, full_params, daily_loss_limit=daily_loss_limit)
        if oos_trades:
            oos_wins = [t for t in oos_trades if t.pnl > 0]
            result.oos_total_trades = len(oos_trades)
            result.oos_win_rate = len(oos_wins) / len(oos_trades) * 100 if oos_trades else 0
            result.oos_return_pct = round(sum(t.pnl for t in oos_trades) / self.initial_capital * 100, 2)
        return result

    def _simulate(
        self,
        df: pd.DataFrame,
        signals: pd.Series,
        params: dict,
        skip_flat: bool = False,
        skip_counter_trend: bool = False,
        daily_loss_limit: float = 0.0,
        skip_hours: set[int] | None = None,
        max_loss_per_trade: float = 0.0,
    ) -> tuple[list[Trade5Min], list[float], float]:
        """Bar-by-bar simulation loop. Supports CALL (+1) and PUT (-1) signals.

        daily_loss_limit: if > 0, stop opening new trades for the day once
        cumulative realized P&L for that day drops to -daily_loss_limit.
        skip_hours: set of UTC hours to skip entries (e.g. {4, 16}).
        max_loss_per_trade: if > 0, force-close trade when unrealized loss
        exceeds this dollar amount (caps outlier losses).
        """
        equity = self.initial_capital
        position: dict | None = None
        trades: list[Trade5Min] = []
        equity_curve: list[float] = []
        consec_losses = 0
        daily_counts: dict[str, int] = {}
        daily_pnl_running: dict[str, float] = {}  # cumulative realized P&L per day
        extreme_since_entry = 0.0  # highest for CALL, lowest for PUT
        worst_unrealized = 0.0  # worst unrealized P&L (most negative) during trade
        prev_bar_date = ""
        prev_mkt_structure: int = 0  # track bar-by-bar structure for transition detection

        for i in range(1, len(df)):
            bar = df.iloc[i]
            prev = df.iloc[i - 1]
            bar_date = str(bar.name.date()) if hasattr(bar.name, "date") else str(bar.name)[:10]

            # ── 0. Day change → reset daily state ───────────────────
            if bar_date != prev_bar_date:
                prev_bar_date = bar_date
                consec_losses = 0
                daily_counts[bar_date] = daily_counts.get(bar_date, 0)

            # ── 0b. EOD close: force-close position when day changes ─
            if position is not None:
                prev_date = str(prev.name.date()) if hasattr(prev.name, "date") else str(prev.name)[:10]
                if bar_date != prev_date:
                    # Close at previous bar's close (end of that day)
                    d = position["direction"]
                    exit_price = float(prev["close"])
                    pnl = d * (exit_price - position["entry_price"]) * position["qty"] * CONTRACT_SIZE
                    pnl_pct = pnl / (self.initial_capital or 1) * 100
                    equity += pnl
                    daily_pnl_running[prev_date] = daily_pnl_running.get(prev_date, 0.0) + pnl
                    trades.append(Trade5Min(
                        entry_time=position["entry_time"],
                        exit_time=prev.name,
                        entry_price=position["entry_price"],
                        exit_price=round(exit_price, 2),
                        qty=position["qty"],
                        pnl=round(pnl, 2),
                        pnl_pct=round(pnl_pct, 2),
                        reason="EOD",
                        signal_type=position.get("signal_type", ""),
                        direction="CALL" if d == 1 else "PUT",
                        mae=round(worst_unrealized, 2),
                        mkt_structure=position.get("mkt_structure", 0),
                        sl=round(position["sl"], 2),
                        tp=round(position["tp"], 2),
                    ))
                    consec_losses = consec_losses + 1 if pnl < 0 else 0
                    position = None
                    worst_unrealized = 0.0
                    # Reset daily counters for new day
                    daily_counts[bar_date] = 0

            # ── 1. If in position → check exits ────────────────────
            if position is not None:
                sl = position["sl"]
                tp = position["tp"]
                direction = position["direction"]  # 1 = CALL, -1 = PUT

                # Track worst unrealized loss (MAE)
                if direction == 1:
                    adverse = (float(bar["low"]) - position["entry_price"]) * position["qty"] * CONTRACT_SIZE
                else:
                    adverse = (position["entry_price"] - float(bar["high"])) * position["qty"] * CONTRACT_SIZE
                if adverse < worst_unrealized:
                    worst_unrealized = adverse

                if position is not None and direction == 1:
                    # ── CALL exit logic (long) ──
                    # Breakeven stop
                    if params.get("use_breakeven") and not position.get("be_triggered"):
                        be_thresh = position["entry_price"] + params.get("be_atr_mult", 1.0) * position["entry_atr"]
                        if bar["high"] >= be_thresh:
                            position["be_triggered"] = True
                            new_sl = position["entry_price"] + params.get("be_offset_atr", 0.1) * position["entry_atr"]
                            if new_sl > sl:
                                sl = new_sl
                                position["sl"] = sl
                    # Trailing stop
                    if params.get("use_trailing") and bar["high"] > extreme_since_entry:
                        extreme_since_entry = bar["high"]
                        new_sl = extreme_since_entry - params["trailing_atr_mult"] * prev["atr"]
                        if new_sl > sl:
                            sl = new_sl
                            position["sl"] = sl

                    hit_sl = bar["low"] <= sl
                    hit_tp = bar["high"] >= tp
                else:
                    # ── PUT exit logic (short) ──
                    # Breakeven stop (inverted)
                    if params.get("use_breakeven") and not position.get("be_triggered"):
                        be_thresh = position["entry_price"] - params.get("be_atr_mult", 1.0) * position["entry_atr"]
                        if bar["low"] <= be_thresh:
                            position["be_triggered"] = True
                            new_sl = position["entry_price"] - params.get("be_offset_atr", 0.1) * position["entry_atr"]
                            if new_sl < sl:
                                sl = new_sl
                                position["sl"] = sl
                    # Trailing stop (inverted)
                    if params.get("use_trailing") and bar["low"] < extreme_since_entry:
                        extreme_since_entry = bar["low"]
                        new_sl = extreme_since_entry + params["trailing_atr_mult"] * prev["atr"]
                        if new_sl < sl:
                            sl = new_sl
                            position["sl"] = sl

                    hit_sl = bar["high"] >= sl
                    hit_tp = bar["low"] <= tp

                # ── Structure fade exit: detect transition on new bar ───
                # CALL: exit when structure transitions BULL→FLAT or BULL→BEAR
                # PUT:  exit when structure transitions BEAR→FLAT or BEAR→BULL
                hit_structure_exit = False
                cur_struct = int(bar["mkt_structure"]) if "mkt_structure" in bar.index and not math.isnan(float(bar["mkt_structure"])) else 0
                if params.get("use_struct_fade") and cur_struct != prev_mkt_structure:
                    if direction == 1:
                        # Long: exit when structure fades from BULL(1) → FLAT(0) or BEAR(-1)
                        if prev_mkt_structure == 1 and cur_struct <= 0:
                            hit_structure_exit = True
                    elif direction == -1:
                        # Short: exit when structure fades from BEAR(-1) → FLAT(0) or BULL(1)
                        if prev_mkt_structure == -1 and cur_struct >= 0:
                            hit_structure_exit = True

                if hit_structure_exit and not hit_sl and not hit_tp:
                    exit_price = float(bar["close"])
                    pnl = direction * (exit_price - position["entry_price"]) * position["qty"] * CONTRACT_SIZE
                    pnl_pct = pnl / (self.initial_capital or 1) * 100
                    equity += pnl
                    daily_pnl_running[bar_date] = daily_pnl_running.get(bar_date, 0.0) + pnl
                    trades.append(Trade5Min(
                        entry_time=position["entry_time"],
                        exit_time=bar.name,
                        entry_price=position["entry_price"],
                        exit_price=round(exit_price, 2),
                        qty=position["qty"],
                        pnl=round(pnl, 2),
                        pnl_pct=round(pnl_pct, 2),
                        reason="STRUCT_EXIT",
                        signal_type=position.get("signal_type", ""),
                        direction="CALL" if direction == 1 else "PUT",
                        mae=round(worst_unrealized, 2),
                        mkt_structure=position.get("mkt_structure", 0),
                        sl=round(sl, 2),
                        tp=round(position["tp"], 2),
                    ))
                    consec_losses = consec_losses + 1 if pnl < 0 else 0
                    position = None
                    worst_unrealized = 0.0

                # ── EMA cross exit: close crossing EMA = cut loss ───
                hit_ema_exit = False
                if position is not None and params.get("use_ema_exit") and "ema_exit" in bar.index:
                    ema_val = float(bar["ema_exit"])
                    bar_close = float(bar["close"])
                    if not (ema_val != ema_val):  # not NaN
                        if direction == 1 and bar_close < ema_val:
                            hit_ema_exit = True
                        elif direction == -1 and bar_close > ema_val:
                            hit_ema_exit = True

                if hit_ema_exit and not hit_sl and not hit_tp and not hit_structure_exit:
                    exit_price = float(bar["close"])
                    pnl = direction * (exit_price - position["entry_price"]) * position["qty"] * CONTRACT_SIZE
                    pnl_pct = pnl / (self.initial_capital or 1) * 100
                    equity += pnl
                    daily_pnl_running[bar_date] = daily_pnl_running.get(bar_date, 0.0) + pnl
                    trades.append(Trade5Min(
                        entry_time=position["entry_time"],
                        exit_time=bar.name,
                        entry_price=position["entry_price"],
                        exit_price=round(exit_price, 2),
                        qty=position["qty"],
                        pnl=round(pnl, 2),
                        pnl_pct=round(pnl_pct, 2),
                        reason="EMA_EXIT",
                        signal_type=position.get("signal_type", ""),
                        direction="CALL" if direction == 1 else "PUT",
                        mae=round(worst_unrealized, 2),
                        mkt_structure=position.get("mkt_structure", 0),
                        sl=round(sl, 2),
                        tp=round(position["tp"], 2),
                    ))
                    consec_losses = consec_losses + 1 if pnl < 0 else 0
                    position = None
                    worst_unrealized = 0.0

                # ── SMA28 cut-loss exit ─────────────────────────────
                # Only triggers when ALL conditions are met:
                # 1. Bar closes opposite SMA28
                # 2. Close breaks entry bar high/low
                # 3. SMA28 slope confirms adverse direction
                # 4. High volume on this bar (>= 1.2× average)
                # 5. Strong reversal signal (momentum + opposite candle body)
                hit_sma28_cut = False
                if position is not None and params.get("use_sma28_cut") and "sma_28" in bar.index:
                    sma_val = float(bar["sma_28"])
                    sma_slope = float(bar["sma_28_slope"]) if "sma_28_slope" in bar.index else 0.0
                    bar_close = float(bar["close"])
                    bar_open = float(bar["open"])
                    if not math.isnan(sma_val) and not math.isnan(sma_slope):
                        # Volume confirmation: bar volume >= 1.2× 20-bar average
                        vol_avg = float(prev.get("volume", 0)) if "volume" not in bar.index else 0.0
                        bar_vol = float(bar["volume"]) if "volume" in bar.index else 0.0
                        _vol_col = df_ind["volume"] if "volume" in df_ind.columns else None
                        if _vol_col is not None and i >= 20:
                            vol_avg = float(_vol_col.iloc[i-20:i].mean())
                        high_volume = vol_avg > 0 and bar_vol >= 1.2 * vol_avg

                        # Reversal candle: strong body in adverse direction
                        bar_range = float(bar["high"]) - float(bar["low"])
                        body = abs(bar_close - bar_open)
                        strong_body = bar_range > 0 and body >= 0.6 * bar_range  # candle body >= 60% of range

                        # Momentum reversal check
                        macd_hist = float(bar.get("macd_hist", 0)) if "macd_hist" in bar.index else 0.0
                        rsi_val = float(bar.get("rsi", 50)) if "rsi" in bar.index else 50.0

                        if direction == 1:  # LONG
                            cross_sma = bar_close < sma_val and bar_close < position.get("entry_bar_low", 0) and sma_slope < 0
                            bearish_candle = bar_close < bar_open  # red candle
                            bearish_momentum = macd_hist < 0 or rsi_val < 40
                            if cross_sma and high_volume and strong_body and bearish_candle and bearish_momentum:
                                hit_sma28_cut = True
                        elif direction == -1:  # SHORT
                            cross_sma = bar_close > sma_val and bar_close > position.get("entry_bar_high", 1e9) and sma_slope > 0
                            bullish_candle = bar_close > bar_open  # green candle
                            bullish_momentum = macd_hist > 0 or rsi_val > 60
                            if cross_sma and high_volume and strong_body and bullish_candle and bullish_momentum:
                                hit_sma28_cut = True

                if hit_sma28_cut and not hit_sl and not hit_tp and not hit_structure_exit and not hit_ema_exit:
                    exit_price = float(bar["close"])
                    pnl = direction * (exit_price - position["entry_price"]) * position["qty"] * CONTRACT_SIZE
                    pnl_pct = pnl / (self.initial_capital or 1) * 100
                    equity += pnl
                    daily_pnl_running[bar_date] = daily_pnl_running.get(bar_date, 0.0) + pnl
                    trades.append(Trade5Min(
                        entry_time=position["entry_time"],
                        exit_time=bar.name,
                        entry_price=position["entry_price"],
                        exit_price=round(exit_price, 2),
                        qty=position["qty"],
                        pnl=round(pnl, 2),
                        pnl_pct=round(pnl_pct, 2),
                        reason="SMA28_CUT",
                        signal_type=position.get("signal_type", ""),
                        direction="CALL" if direction == 1 else "PUT",
                        mae=round(worst_unrealized, 2),
                        mkt_structure=position.get("mkt_structure", 0),
                        sl=round(sl, 2),
                        tp=round(position["tp"], 2),
                    ))
                    consec_losses = consec_losses + 1 if pnl < 0 else 0
                    position = None
                    worst_unrealized = 0.0

                # ── HalfTrend flip exit ─────────────────────────────
                # Exit when HalfTrend direction flips against the position
                hit_ht_flip = False
                if position is not None and "ht_dir" in bar.index:
                    ht_dir = int(bar["ht_dir"])
                    prev_ht_dir = int(prev["ht_dir"]) if "ht_dir" in prev.index else ht_dir
                    if direction == 1 and ht_dir == 1 and prev_ht_dir == 0:   # was bullish → bearish
                        hit_ht_flip = True
                    elif direction == -1 and ht_dir == 0 and prev_ht_dir == 1:  # was bearish → bullish
                        hit_ht_flip = True

                if hit_ht_flip and not hit_sl and not hit_tp and not hit_structure_exit and not hit_ema_exit and not hit_sma28_cut:
                    exit_price = float(bar["close"])
                    pnl = direction * (exit_price - position["entry_price"]) * position["qty"] * CONTRACT_SIZE
                    pnl_pct = pnl / (self.initial_capital or 1) * 100
                    equity += pnl
                    daily_pnl_running[bar_date] = daily_pnl_running.get(bar_date, 0.0) + pnl
                    trades.append(Trade5Min(
                        entry_time=position["entry_time"],
                        exit_time=bar.name,
                        entry_price=position["entry_price"],
                        exit_price=round(exit_price, 2),
                        qty=position["qty"],
                        pnl=round(pnl, 2),
                        pnl_pct=round(pnl_pct, 2),
                        reason="HT_FLIP",
                        signal_type=position.get("signal_type", ""),
                        direction="CALL" if direction == 1 else "PUT",
                        mae=round(worst_unrealized, 2),
                        mkt_structure=position.get("mkt_structure", 0),
                        sl=round(sl, 2),
                        tp=round(position["tp"], 2),
                    ))
                    consec_losses = consec_losses + 1 if pnl < 0 else 0
                    position = None
                    worst_unrealized = 0.0

                if position is not None and hit_sl:
                    exit_price = sl
                    pnl = direction * (exit_price - position["entry_price"]) * position["qty"] * CONTRACT_SIZE
                    pnl_pct = pnl / (self.initial_capital or 1) * 100
                    equity += pnl
                    daily_pnl_running[bar_date] = daily_pnl_running.get(bar_date, 0.0) + pnl
                    reason = "SL"
                    if params.get("use_breakeven") and position.get("be_triggered"):
                        if (direction == 1 and sl >= position["entry_price"]) or \
                           (direction == -1 and sl <= position["entry_price"]):
                            reason = "BE"
                    elif params.get("use_trailing") and sl != position["orig_sl"]:
                        reason = "TRAILING"
                    trades.append(Trade5Min(
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
                        sl=round(sl, 2),
                        tp=round(position["tp"], 2),
                    ))
                    consec_losses = consec_losses + 1 if pnl < 0 else 0
                    position = None
                    worst_unrealized = 0.0

                if position is not None and hit_tp:
                    exit_price = tp
                    pnl = direction * (exit_price - position["entry_price"]) * position["qty"] * CONTRACT_SIZE
                    pnl_pct = pnl / (self.initial_capital or 1) * 100
                    equity += pnl
                    daily_pnl_running[bar_date] = daily_pnl_running.get(bar_date, 0.0) + pnl
                    trades.append(Trade5Min(
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
                        sl=round(sl, 2),
                        tp=round(tp, 2),
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

                # Skip bad hours gate
                if skip_hours and hasattr(bar.name, "hour") and bar.name.hour in skip_hours:
                    equity_curve.append(equity)
                    continue

                # Daily loss limit gate
                if daily_loss_limit > 0:
                    day_pnl = daily_pnl_running.get(bar_date, 0.0)
                    if day_pnl <= -daily_loss_limit:
                        equity_curve.append(equity)
                        continue

                entry_price = float(bar["open"])
                atr_val = float(prev["atr"]) if not math.isnan(float(prev["atr"])) else 0.0
                if atr_val <= 0:
                    equity_curve.append(equity)
                    continue

                direction = int(sig_val)  # +1 = CALL, -1 = PUT
                if direction == 1:
                    sl_price = entry_price - params["atr_sl_mult"] * atr_val
                    tp_price = entry_price + params["atr_tp_mult"] * atr_val
                else:
                    sl_price = entry_price + params["atr_sl_mult"] * atr_val
                    tp_price = entry_price - params["atr_tp_mult"] * atr_val

                # Cap SL distance so max dollar risk per trade is bounded
                if max_loss_per_trade > 0:
                    max_sl_dist = max_loss_per_trade / CONTRACT_SIZE  # $ → price distance
                    sl_dist = abs(entry_price - sl_price)
                    if sl_dist > max_sl_dist:
                        if direction == 1:
                            sl_price = entry_price - max_sl_dist
                        else:
                            sl_price = entry_price + max_sl_dist

                risk_per_contract = abs(entry_price - sl_price) * CONTRACT_SIZE
                if risk_per_contract <= 0:
                    equity_curve.append(equity)
                    continue

                risk_amount = equity * self.risk_per_trade
                qty = 1  # fixed 1 contract per trade

                # Determine signal type
                sig_type = "PULLBACK"
                if direction == 1 and int(prev.get("breakout", 0)) == 1:
                    sig_type = "BREAKOUT"
                elif direction == -1 and int(prev.get("breakout_low", 0)) == 1:
                    sig_type = "BREAKOUT"

                # Capture market structure at entry bar
                _mkt_s = int(prev.get("mkt_structure", 0)) if "mkt_structure" in prev.index else 0

                # Skip FLAT/SIDEWAYS entries when skip_flat is enabled
                if skip_flat and _mkt_s == 0:
                    equity_curve.append(equity)
                    continue

                # Skip counter-trend entries (CALL in BEAR, PUT in BULL)
                if skip_counter_trend:
                    if (direction == 1 and _mkt_s == -1) or (direction == -1 and _mkt_s == 1):
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
                    "entry_bar_low": float(bar["low"]),
                    "entry_bar_high": float(bar["high"]),
                }
                extreme_since_entry = entry_price
                worst_unrealized = 0.0
                daily_counts[bar_date] = daily_counts.get(bar_date, 0) + 1

            # ── 3. Record equity ───────────────────────────────────
            if position is not None:
                d = position["direction"]
                unrealized = d * (float(bar["close"]) - position["entry_price"]) * position["qty"] * CONTRACT_SIZE
                equity_curve.append(equity + unrealized)
            else:
                equity_curve.append(equity)

            # Update structure tracker every bar (needs to run outside position block)
            if "mkt_structure" in bar.index and not math.isnan(float(bar["mkt_structure"])):
                prev_mkt_structure = int(bar["mkt_structure"])

        # Close remaining position at last close
        if position is not None:
            last = df.iloc[-1]
            d = position["direction"]
            pnl = d * (float(last["close"]) - position["entry_price"]) * position["qty"] * CONTRACT_SIZE
            pnl_pct = pnl / (self.initial_capital or 1) * 100
            equity += pnl
            last_date = str(last.name.date()) if hasattr(last.name, "date") else str(last.name)[:10]
            daily_pnl_running[last_date] = daily_pnl_running.get(last_date, 0.0) + pnl
            trades.append(Trade5Min(
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
                sl=round(position["sl"], 2),
                tp=round(position["tp"], 2),
            ))

        return trades, equity_curve, equity

    def get_live_position(
        self,
        df: pd.DataFrame,
        params: dict | None = None,
        disabled_conditions: set[str] | None = None,
    ) -> dict | None:
        """Run the backtest simulation and return the open position at the
        last bar (if any), WITHOUT force-closing it.

        Returns dict with entry_price, sl, tp, direction, entry_time,
        signal_type, qty — or None if no open position.
        """
        full_params = {**DEFAULT_5MIN_PARAMS, **(params or {})}
        strategy = MGCStrategy5Min(full_params)
        df_ind = strategy.compute_indicators(
            df[["open", "high", "low", "close", "volume"]].copy()
        )
        signals = strategy.generate_signals(df_ind, disabled=disabled_conditions)

        # Run the same simulation loop but stop before force-close
        equity = self.initial_capital
        position: dict | None = None
        consec_losses = 0
        daily_counts: dict[str, int] = {}
        extreme_since_entry = 0.0
        prev_bar_date = ""

        for i in range(1, len(df_ind)):
            bar = df_ind.iloc[i]
            prev = df_ind.iloc[i - 1]
            bar_date = str(bar.name.date()) if hasattr(bar.name, "date") else str(bar.name)[:10]
            is_last_bar = (i == len(df_ind) - 1)

            if bar_date != prev_bar_date:
                prev_bar_date = bar_date
                consec_losses = 0
                daily_counts[bar_date] = daily_counts.get(bar_date, 0)

            # EOD close on day change (skip on last bar to preserve live position)
            if position is not None and not is_last_bar:
                prev_date = str(prev.name.date()) if hasattr(prev.name, "date") else str(prev.name)[:10]
                if bar_date != prev_date:
                    d = position["direction"]
                    pnl = d * (float(prev["close"]) - position["entry_price"]) * position["qty"] * CONTRACT_SIZE
                    equity += pnl
                    consec_losses = consec_losses + 1 if pnl < 0 else 0
                    position = None
                    daily_counts[bar_date] = 0

            # Check exits
            if position is not None:
                sl = position["sl"]
                tp = position["tp"]
                direction = position["direction"]

                if direction == 1:
                    if full_params.get("use_breakeven") and not position.get("be_triggered"):
                        be_thresh = position["entry_price"] + full_params.get("be_atr_mult", 1.0) * position["entry_atr"]
                        if bar["high"] >= be_thresh:
                            position["be_triggered"] = True
                            new_sl = position["entry_price"] + full_params.get("be_offset_atr", 0.1) * position["entry_atr"]
                            if new_sl > sl:
                                sl = new_sl
                                position["sl"] = sl
                    if full_params.get("use_trailing") and bar["high"] > extreme_since_entry:
                        extreme_since_entry = bar["high"]
                        new_sl = extreme_since_entry - full_params["trailing_atr_mult"] * prev["atr"]
                        if new_sl > sl:
                            sl = new_sl
                            position["sl"] = sl
                    hit_sl = bar["low"] <= sl
                    hit_tp = bar["high"] >= tp
                else:
                    if full_params.get("use_breakeven") and not position.get("be_triggered"):
                        be_thresh = position["entry_price"] - full_params.get("be_atr_mult", 1.0) * position["entry_atr"]
                        if bar["low"] <= be_thresh:
                            position["be_triggered"] = True
                            new_sl = position["entry_price"] - full_params.get("be_offset_atr", 0.1) * position["entry_atr"]
                            if new_sl < sl:
                                sl = new_sl
                                position["sl"] = sl
                    if full_params.get("use_trailing") and bar["low"] < extreme_since_entry:
                        extreme_since_entry = bar["low"]
                        new_sl = extreme_since_entry + full_params["trailing_atr_mult"] * prev["atr"]
                        if new_sl < sl:
                            sl = new_sl
                            position["sl"] = sl
                    hit_sl = bar["high"] >= sl
                    hit_tp = bar["low"] <= tp

                if hit_sl or hit_tp:
                    pnl = direction * ((sl if hit_sl else tp) - position["entry_price"]) * position["qty"] * CONTRACT_SIZE
                    equity += pnl
                    consec_losses = consec_losses + 1 if pnl < 0 else 0
                    position = None

            # Consider entry
            sig_val = signals.iloc[i - 1] if i > 0 else 0
            if position is None and sig_val != 0:
                if consec_losses >= self.MAX_CONSEC_LOSSES:
                    continue
                if daily_counts.get(bar_date, 0) >= self.MAX_DAILY_TRADES:
                    continue
                entry_price = float(bar["open"])
                atr_val = float(prev["atr"]) if not math.isnan(float(prev["atr"])) else 0.0
                if atr_val <= 0:
                    continue

                direction = int(sig_val)
                if direction == 1:
                    sl_price = entry_price - full_params["atr_sl_mult"] * atr_val
                    tp_price = entry_price + full_params["atr_tp_mult"] * atr_val
                else:
                    sl_price = entry_price + full_params["atr_sl_mult"] * atr_val
                    tp_price = entry_price - full_params["atr_tp_mult"] * atr_val

                sig_type = "PULLBACK"
                if direction == 1 and int(prev.get("breakout", 0)) == 1:
                    sig_type = "BREAKOUT"
                elif direction == -1 and int(prev.get("breakout_low", 0)) == 1:
                    sig_type = "BREAKOUT"

                position = {
                    "entry_price": entry_price,
                    "sl": sl_price,
                    "orig_sl": sl_price,
                    "tp": tp_price,
                    "qty": 1,
                    "entry_time": bar.name,
                    "signal_type": sig_type,
                    "entry_atr": atr_val,
                    "be_triggered": False,
                    "direction": direction,
                    "signal_close": float(prev["close"]),  # scanner uses this as entry
                }
                extreme_since_entry = entry_price
                daily_counts[bar_date] = daily_counts.get(bar_date, 0) + 1

        # Return open position (do NOT force-close)
        if position is None:
            return None

        # Compute scanner-consistent SL/TP using signal bar's close (not next bar's open)
        sig_close = position.get("signal_close", position["entry_price"])
        atr = position["entry_atr"]
        d = position["direction"]
        if d == 1:
            scanner_sl = sig_close - full_params["atr_sl_mult"] * atr
            scanner_tp = sig_close + full_params["atr_tp_mult"] * atr
        else:
            scanner_sl = sig_close + full_params["atr_sl_mult"] * atr
            scanner_tp = sig_close - full_params["atr_tp_mult"] * atr

        return {
            "direction": "CALL" if d == 1 else "PUT",
            "entry_price": round(sig_close, 2),
            "sl": round(scanner_sl, 2),
            "tp": round(scanner_tp, 2),
            "qty": position["qty"],
            "entry_time": str(position["entry_time"]),
            "signal_type": position.get("signal_type", ""),
            "bar_time": str(df_ind.index[-1]),
        }

    @staticmethod
    def _compute_metrics(
        trades: list[Trade5Min],
        equity_curve: list[float],
        initial_capital: float,
        params: dict,
        daily_loss_limit: float = 0.0,
    ) -> BacktestResult5Min:
        result = BacktestResult5Min(
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

        # Sharpe ratio (annualised for 5min bars: 78 bars/day × 252 days)
        if len(equity_curve) > 1:
            returns = np.diff(equity_curve) / np.maximum(equity_curve[:-1], 1e-10)
            if returns.std() > 0:
                bars_per_year = 252 * 78  # 5min: 78 bars/day
                result.sharpe_ratio = round(
                    float(returns.mean() / returns.std() * math.sqrt(bars_per_year)), 2
                )

        # Daily P&L breakdown — group trades by exit date
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
        result.daily_pnl = sorted(day_map.values(), key=lambda x: x["date"])

        # Worst daily loss & days stopped
        if day_map:
            result.worst_daily_loss = round(min(d["pnl"] for d in day_map.values()), 2)
            if daily_loss_limit > 0:
                result.days_stopped = sum(
                    1 for d in day_map.values() if d["pnl"] <= -daily_loss_limit
                )

        return result
