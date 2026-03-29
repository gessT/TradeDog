"""
MGC Trading API — REST endpoints for the frontend dashboard.
=============================================================
Provides /mgc/backtest and /mgc/live endpoints that the frontend
can call to get chart data, trade markers, and performance metrics.
"""
from __future__ import annotations

import logging
import math
from datetime import datetime, timezone
from typing import Annotated, Optional

from fastapi import APIRouter, Query
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel

from mgc_trading.backtest import Backtester
from mgc_trading.config import DEFAULT_PARAMS, INITIAL_CAPITAL, TIGER_ACCOUNT, TIGER_ID, TIGER_PRIVATE_KEY
from mgc_trading.data_loader import load_yfinance
from mgc_trading.strategy import MGCStrategy

logger = logging.getLogger(__name__)
router = APIRouter(tags=["mgc"])


# ═══════════════════════════════════════════════════════════════════════
# Response models
# ═══════════════════════════════════════════════════════════════════════

class MGCCandle(BaseModel):
    time: str
    open: float
    high: float
    low: float
    close: float
    volume: float
    ema_fast: Optional[float] = None
    ema_slow: Optional[float] = None
    rsi: Optional[float] = None
    signal: int = 0  # 1 = entry signal on this bar


class MGCTrade(BaseModel):
    entry_time: str
    exit_time: str
    entry_price: float
    exit_price: float
    qty: int
    pnl: float
    pnl_pct: float
    reason: str  # TP, SL, TRAILING, EOD


class MGCMetrics(BaseModel):
    initial_capital: float
    final_equity: float
    total_return_pct: float
    max_drawdown_pct: float
    sharpe_ratio: float
    total_trades: int
    winners: int
    losers: int
    win_rate: float
    avg_win: float
    avg_loss: float
    profit_factor: float
    risk_reward_ratio: float


class MGCBacktestResponse(BaseModel):
    symbol: str
    interval: str
    period: str
    candles: list[MGCCandle]
    trades: list[MGCTrade]
    equity_curve: list[float]
    metrics: MGCMetrics
    params: dict
    timestamp: str


# ═══════════════════════════════════════════════════════════════════════
# Backtest endpoint
# ═══════════════════════════════════════════════════════════════════════

@router.get("/backtest")
async def mgc_backtest(
    symbol: Annotated[str, Query()] = "MGC=F",
    interval: Annotated[str, Query()] = "15m",
    period: Annotated[str, Query()] = "60d",
    capital: Annotated[float, Query()] = INITIAL_CAPITAL,
    # Optional param overrides
    ema_fast: Optional[int] = None,
    ema_slow: Optional[int] = None,
    atr_sl_mult: Optional[float] = None,
    atr_tp_mult: Optional[float] = None,
) -> MGCBacktestResponse:
    """Run MGC backtest and return chart candles + trades + metrics."""

    def _run():
        # yfinance caps: 1m → max 7d, 5m → max 60d
        effective_period = period
        if interval == "1m" and period not in ("1d", "2d", "5d", "7d"):
            effective_period = "7d"
        elif interval == "5m" and period not in ("1d", "2d", "5d", "7d", "30d", "60d"):
            effective_period = "60d"

        # Load data
        df = load_yfinance(symbol=symbol, interval=interval, period=effective_period)

        # Build params (merge overrides)
        params = {**DEFAULT_PARAMS}
        if ema_fast is not None:
            params["ema_fast"] = ema_fast
        if ema_slow is not None:
            params["ema_slow"] = ema_slow
        if atr_sl_mult is not None:
            params["atr_sl_mult"] = atr_sl_mult
        if atr_tp_mult is not None:
            params["atr_tp_mult"] = atr_tp_mult

        # Compute indicators + signals
        strategy = MGCStrategy(params)
        df_ind = strategy.compute_indicators(df)
        signals = strategy.generate_signals(df_ind)
        df_ind["signal"] = signals

        # Run backtest
        bt = Backtester(capital=capital)
        result = bt.run(df, params, interval=interval)

        # Build candle list
        candles = []
        for i, (ts, row) in enumerate(df_ind.iterrows()):
            candles.append(MGCCandle(
                time=str(ts),
                open=round(float(row["open"]), 2),
                high=round(float(row["high"]), 2),
                low=round(float(row["low"]), 2),
                close=round(float(row["close"]), 2),
                volume=float(row.get("volume", 0)),
                ema_fast=round(float(row["ema_fast"]), 2) if "ema_fast" in row and not _isnan(row["ema_fast"]) else None,
                ema_slow=round(float(row["ema_slow"]), 2) if "ema_slow" in row and not _isnan(row["ema_slow"]) else None,
                rsi=round(float(row["rsi"]), 1) if "rsi" in row and not _isnan(row["rsi"]) else None,
                signal=int(row.get("signal", 0)),
            ))

        # Build trade list
        trades = [
            MGCTrade(
                entry_time=str(t.entry_time),
                exit_time=str(t.exit_time),
                entry_price=round(t.entry_price, 2),
                exit_price=round(t.exit_price, 2),
                qty=t.qty,
                pnl=round(t.pnl, 2),
                pnl_pct=round(t.pnl_pct, 2),
                reason=t.reason,
            )
            for t in result.trades
        ]

        metrics = MGCMetrics(
            initial_capital=result.initial_capital,
            final_equity=result.final_equity,
            total_return_pct=result.total_return_pct,
            max_drawdown_pct=result.max_drawdown_pct,
            sharpe_ratio=result.sharpe_ratio,
            total_trades=result.total_trades,
            winners=result.winners,
            losers=result.losers,
            win_rate=round(result.win_rate, 1),
            avg_win=round(result.avg_win, 2),
            avg_loss=round(result.avg_loss, 2),
            profit_factor=round(result.profit_factor, 2),
            risk_reward_ratio=round(result.risk_reward_ratio, 2),
        )

        return candles, trades, result.equity_curve, metrics, params

    candles, trades, eq_curve, metrics, params = await run_in_threadpool(_run)

    return MGCBacktestResponse(
        symbol=symbol,
        interval=interval,
        period=period,
        candles=candles,
        trades=trades,
        equity_curve=eq_curve,
        metrics=metrics,
        params=params,
        timestamp=datetime.now(timezone.utc).strftime("%d/%m/%Y %H:%M UTC"),
    )


def _isnan(v) -> bool:
    try:
        return math.isnan(float(v))
    except (TypeError, ValueError):
        return True


# ═══════════════════════════════════════════════════════════════════════
# Live data endpoint  (Tiger API — real-time)
# ═══════════════════════════════════════════════════════════════════════

class MGCLiveCandle(BaseModel):
    time: int          # epoch ms
    open: float
    high: float
    low: float
    close: float
    volume: float


class MGCLiveResponse(BaseModel):
    symbol: str
    identifier: str    # e.g. "MGC2606"
    interval: str
    candles: list[MGCLiveCandle]
    ema_fast: list[Optional[float]]
    ema_slow: list[Optional[float]]
    rsi: list[Optional[float]]
    signals: list[int]
    current_price: float
    timestamp: str


# Tiger BarPeriod mapping
_BAR_PERIOD_MAP: dict = {}
_tiger_quote_ok = False
try:
    from tigeropen.common.consts import BarPeriod as _BarPeriod, Language as _Language
    from tigeropen.common.util.signature_utils import read_private_key as _read_pk
    from tigeropen.tiger_open_config import TigerOpenClientConfig as _TConfig
    from tigeropen.quote.quote_client import QuoteClient as _QuoteClient
    from tigeropen.trade.trade_client import TradeClient as _TradeClient

    _BAR_PERIOD_MAP = {
        "1m": _BarPeriod.ONE_MINUTE,
        "5m": _BarPeriod.FIVE_MINUTES,
        "15m": _BarPeriod.FIFTEEN_MINUTES,
        "30m": _BarPeriod.HALF_HOUR,
        "1h": _BarPeriod.ONE_HOUR,
    }
    _tiger_quote_ok = True
except ImportError:
    pass


def _get_tiger_clients():
    """Create Tiger quote + trade clients."""
    config = _TConfig()
    config.tiger_id = TIGER_ID
    config.language = _Language.en_US
    config.private_key = _read_pk(TIGER_PRIVATE_KEY)
    config.account = TIGER_ACCOUNT
    return _QuoteClient(config), _TradeClient(config)


@router.get("/live")
async def mgc_live(
    interval: Annotated[str, Query()] = "15m",
    limit: Annotated[int, Query(ge=50, le=2000)] = 500,
) -> MGCLiveResponse:
    """Fetch real-time MGC bars from Tiger API with indicators."""

    def _run():
        import pandas as pd
        from mgc_trading import indicators as ind

        if not _tiger_quote_ok:
            raise ValueError("Tiger SDK not available")

        quote_client, trade_client = _get_tiger_clients()

        # Resolve contract
        contracts = trade_client.get_contracts("MGC", sec_type="FUT")
        identifier = contracts[0].identifier if contracts else "MGC"

        period = _BAR_PERIOD_MAP.get(interval)
        if period is None:
            raise ValueError(f"Unsupported interval: {interval}")

        df = quote_client.get_future_bars(identifier, period=period, limit=limit)
        if df is None or df.empty:
            raise ValueError("No data returned from Tiger")

        # Build DataFrame
        times = df["time"].tolist()
        df.index = pd.to_datetime(df["time"], unit="ms")
        df = df[["open", "high", "low", "close", "volume"]].copy()
        df["_time_ms"] = times
        df = df.sort_index()

        # Compute indicators
        p = DEFAULT_PARAMS
        ema_f = ind.ema(df["close"], p["ema_fast"])
        ema_s = ind.ema(df["close"], p["ema_slow"])
        rsi_vals = ind.rsi(df["close"], p["rsi_period"])
        ind.atr(df["high"], df["low"], df["close"], p["atr_period"])

        # Compute signals
        strategy = MGCStrategy(p)
        df_ind = strategy.compute_indicators(
            df[["open", "high", "low", "close", "volume"]].copy()
        )
        sigs = strategy.generate_signals(df_ind)

        # Build response
        candles = []
        ema_fast_list = []
        ema_slow_list = []
        rsi_list = []
        signal_list = []

        for i in range(len(df)):
            row = df.iloc[i]
            candles.append(MGCLiveCandle(
                time=int(row["_time_ms"]),
                open=round(float(row["open"]), 2),
                high=round(float(row["high"]), 2),
                low=round(float(row["low"]), 2),
                close=round(float(row["close"]), 2),
                volume=float(row["volume"]),
            ))
            ema_fast_list.append(round(float(ema_f.iloc[i]), 2) if not _isnan(ema_f.iloc[i]) else None)
            ema_slow_list.append(round(float(ema_s.iloc[i]), 2) if not _isnan(ema_s.iloc[i]) else None)
            rsi_list.append(round(float(rsi_vals.iloc[i]), 1) if not _isnan(rsi_vals.iloc[i]) else None)
            signal_list.append(int(sigs.iloc[i]) if i < len(sigs) else 0)

        current_price = float(df["close"].iloc[-1])

        return identifier, candles, ema_fast_list, ema_slow_list, rsi_list, signal_list, current_price

    identifier, candles, ema_fast, ema_slow, rsi_vals, signals, price = await run_in_threadpool(_run)

    return MGCLiveResponse(
        symbol="MGC",
        identifier=identifier,
        interval=interval,
        candles=candles,
        ema_fast=ema_fast,
        ema_slow=ema_slow,
        rsi=rsi_vals,
        signals=signals,
        current_price=round(price, 2),
        timestamp=datetime.now(timezone.utc).strftime("%d/%m/%Y %H:%M:%S UTC"),
    )


# ═══════════════════════════════════════════════════════════════════════
# Scan Trade — One-Click Scan + Auto-Execute
# ═══════════════════════════════════════════════════════════════════════

class ScanSignal(BaseModel):
    """A detected trading opportunity."""
    found: bool
    symbol: str
    identifier: str
    entry_price: float
    stop_loss: float
    take_profit: float
    risk_reward: float
    qty: int
    signal_type: str        # "PULLBACK" / "BREAKOUT"
    strength: int           # 1-10
    strength_detail: dict   # breakdown of scoring
    rsi: float
    atr: float
    ema_fast: float
    ema_slow: float
    volume_ratio: float
    bar_time: str


class BacktestCheck(BaseModel):
    """Quick backtest validation result."""
    passed: bool
    win_rate: float
    risk_reward: float
    total_trades: int
    profit_factor: float
    total_return_pct: float
    reason: str  # why passed/failed


class ExecutionResult(BaseModel):
    """Order execution result."""
    executed: bool
    order_id: str
    side: str
    qty: int
    status: str
    reason: str


class ScanTradeResponse(BaseModel):
    """Full response from /scan_trade endpoint."""
    opportunity: bool
    signal: Optional[ScanSignal] = None
    backtest: Optional[BacktestCheck] = None
    execution: Optional[ExecutionResult] = None
    risk_check: dict
    position: dict  # current_qty, max_qty, blocked
    timestamp: str


class ScanTradeRequest(BaseModel):
    """Request body for /scan_trade endpoint."""
    auto_execute: bool = False
    interval: str = "5m"
    symbols: list[str] = ["MGC"]
    qty: int = 1        # contracts per trade
    max_qty: int = 5    # max total holding


# Fetch real position from Tiger Demo account
def _get_tiger_position(symbol: str = "MGC") -> int:
    """Get current holding qty for a symbol from Tiger account."""
    try:
        _, trade_client = _get_tiger_clients()
        if trade_client is None:
            return 0
        positions = trade_client.get_positions(
            account=TIGER_ACCOUNT, sec_type="FUT"
        )
        if not positions:
            return 0
        total = 0
        for p in positions:
            if p.contract and p.contract.symbol and p.contract.symbol.startswith(symbol):
                total += int(p.quantity)
        return total
    except Exception:
        return 0


@router.get("/position")
async def get_position(symbol: str = "MGC"):
    """Return current Tiger position for a symbol."""
    qty = _get_tiger_position(symbol)
    return {"current_qty": qty, "symbol": symbol}


@router.post("/scan_trade")
async def scan_trade(req: ScanTradeRequest) -> ScanTradeResponse:
    """One-click: Scan market → Find opportunity → Validate → Execute.

    1. Fetch real-time 5m bars from Tiger API
    2. Compute indicators + detect entry signals
    3. Score signal strength (1-10)
    4. Quick backtest validation (last 5 days)
    5. If valid + auto_execute → place order on Tiger demo
    """

    def _run():
        import math
        import numpy as np
        import pandas as pd
        from mgc_trading import indicators as ind
        from mgc_trading.backtest import Backtester
        from mgc_trading.config import CONTRACT_SIZE, RISK_PER_TRADE
        from mgc_trading.tiger_execution import TigerTrader

        if not _tiger_quote_ok:
            raise ValueError("Tiger SDK not available")

        quote_client, trade_client = _get_tiger_clients()

        # Resolve contract
        symbol = req.symbols[0] if req.symbols else "MGC"
        contracts = trade_client.get_contracts(symbol, sec_type="FUT")
        if not contracts:
            raise ValueError(f"No contract found for {symbol}")
        identifier = contracts[0].identifier

        period = _BAR_PERIOD_MAP.get(req.interval, _BAR_PERIOD_MAP.get("5m"))

        # ── 1. Fetch real-time data ──────────────────────────────
        df_raw = quote_client.get_future_bars(identifier, period=period, limit=500)
        if df_raw is None or df_raw.empty:
            raise ValueError("No data from Tiger API")

        times_ms = df_raw["time"].tolist()
        df = df_raw[["open", "high", "low", "close", "volume"]].copy()
        df.index = pd.to_datetime(df_raw["time"], unit="ms")
        df = df.sort_index()
        df["_time_ms"] = sorted(times_ms)

        # ── 2. Compute indicators ────────────────────────────────
        p = {**DEFAULT_PARAMS, "ema_fast": 20, "ema_slow": 50}
        strategy = MGCStrategy(p)
        df_ind = strategy.compute_indicators(df[["open", "high", "low", "close", "volume"]].copy())
        signals = strategy.generate_signals(df_ind)
        df_ind["signal"] = signals

        # Also compute breakout signals
        high_20 = df_ind["high"].rolling(20).max().shift(1)
        vol_ma = df_ind["volume"].rolling(20).mean()
        vol_spike = df_ind["volume"] > 1.5 * vol_ma
        breakout = (df_ind["close"] > high_20) & vol_spike & (df_ind["ema_fast"] > df_ind["ema_slow"])
        df_ind["breakout"] = breakout.astype(int)

        # ── 3. Check last completed bar ──────────────────────────
        bar = df_ind.iloc[-2]  # second-to-last (completed)
        bar_time = str(df_ind.index[-2])
        current_price = float(df_ind["close"].iloc[-1])

        pullback_signal = int(bar.get("signal", 0)) == 1
        breakout_signal = int(bar.get("breakout", 0)) == 1
        has_signal = pullback_signal or breakout_signal
        if pullback_signal:
            signal_type = "PULLBACK"
        elif breakout_signal:
            signal_type = "BREAKOUT"
        else:
            signal_type = "NONE"

        atr_val = float(bar["atr"]) if not _isnan(bar["atr"]) else 0.0
        rsi_val = float(bar["rsi"]) if not _isnan(bar["rsi"]) else 50.0
        ema_f = float(bar["ema_fast"]) if not _isnan(bar["ema_fast"]) else 0.0
        ema_s = float(bar["ema_slow"]) if not _isnan(bar["ema_slow"]) else 0.0
        vol_ratio = float(bar["volume"] / vol_ma.iloc[-2]) if vol_ma.iloc[-2] > 0 else 1.0

        # Entry / SL / TP
        entry_price = current_price
        sl_price = entry_price - p["atr_sl_mult"] * atr_val
        tp_price = entry_price + p["atr_tp_mult"] * atr_val
        rr = abs(tp_price - entry_price) / abs(entry_price - sl_price) if abs(entry_price - sl_price) > 0 else 0

        # ── 4. Signal strength scoring (1-10) ────────────────────
        score = 0
        detail = {}

        # Trend alignment (0-2)
        if ema_f > ema_s:
            trend_gap_pct = (ema_f - ema_s) / ema_s * 100 if ema_s > 0 else 0
            trend_pts = min(2, int(trend_gap_pct / 0.1) + 1) if trend_gap_pct > 0 else 0
            score += trend_pts
            detail["trend"] = {"pts": trend_pts, "ema_gap_pct": round(trend_gap_pct, 3)}
        else:
            detail["trend"] = {"pts": 0, "note": "EMA20 < EMA50"}

        # RSI sweet spot (0-2)
        if 40 <= rsi_val <= 60:
            rsi_pts = 2
        elif 30 <= rsi_val < 40 or 60 < rsi_val <= 70:
            rsi_pts = 1
        else:
            rsi_pts = 0
        score += rsi_pts
        detail["rsi"] = {"pts": rsi_pts, "value": round(rsi_val, 1)}

        # Volume confirmation (0-2)
        if vol_ratio >= 2.0:
            vol_pts = 2
        elif vol_ratio >= 1.2:
            vol_pts = 1
        else:
            vol_pts = 0
        score += vol_pts
        detail["volume"] = {"pts": vol_pts, "ratio": round(vol_ratio, 2)}

        # Candle quality (0-2)
        candle_pts = 0
        if bool(bar.get("bullish_engulfing", False)):
            candle_pts = 2
        elif bool(bar.get("bullish_candle", False)):
            body_pct = abs(float(bar["close"]) - float(bar["open"])) / atr_val * 100 if atr_val > 0 else 0
            candle_pts = 2 if body_pct > 50 else 1
        score += candle_pts
        detail["candle"] = {"pts": candle_pts}

        # Risk-reward quality (0-2)
        if rr >= 2.5:
            rr_pts = 2
        elif rr >= 1.5:
            rr_pts = 1
        else:
            rr_pts = 0
        score += rr_pts
        detail["risk_reward"] = {"pts": rr_pts, "rr": round(rr, 2)}

        strength = max(1, min(10, score))

        # ── 5. Position sizing — use requested qty ────────────
        account_equity = 50_000.0  # demo default
        qty = req.qty
        risk_per_contract = abs(entry_price - sl_price) * CONTRACT_SIZE
        risk_amount = risk_per_contract * qty

        signal_obj = ScanSignal(
            found=has_signal,
            symbol=symbol,
            identifier=identifier,
            entry_price=round(entry_price, 2),
            stop_loss=round(sl_price, 2),
            take_profit=round(tp_price, 2),
            risk_reward=round(rr, 2),
            qty=qty,
            signal_type=signal_type,
            strength=strength,
            strength_detail=detail,
            rsi=round(rsi_val, 1),
            atr=round(atr_val, 2),
            ema_fast=round(ema_f, 2),
            ema_slow=round(ema_s, 2),
            volume_ratio=round(vol_ratio, 2),
            bar_time=bar_time,
        )

        # ── 6. Quick backtest validation ─────────────────────────
        bt_check = None
        if has_signal:
            bt = Backtester(capital=account_equity)
            bt_df = df[["open", "high", "low", "close", "volume"]].copy()
            result = bt.run(bt_df, p)

            bt_passed = result.win_rate >= 55 and result.risk_reward_ratio >= 1.5
            reason = "OK" if bt_passed else ""
            if result.win_rate < 55:
                reason = f"Win rate {result.win_rate:.1f}% < 55%"
            if result.risk_reward_ratio < 1.5:
                reason += ("; " if reason else "") + f"RR {result.risk_reward_ratio:.2f} < 1.5"

            bt_check = BacktestCheck(
                passed=bt_passed,
                win_rate=round(result.win_rate, 1),
                risk_reward=round(result.risk_reward_ratio, 2),
                total_trades=result.total_trades,
                profit_factor=round(result.profit_factor, 2),
                total_return_pct=round(result.total_return_pct, 2),
                reason=reason,
            )

        # ── 7. Risk check summary ────────────────────────────────
        current_pos = _get_tiger_position(symbol)
        at_max = current_pos >= req.max_qty
        risk_check = {
            "risk_per_trade_pct": round(risk_amount / account_equity * 100, 2),
            "risk_amount_usd": round(risk_amount, 2),
            "position_size": qty,
            "max_loss_usd": round(risk_per_contract * qty, 2),
            "account_equity": account_equity,
        }
        position_info = {
            "current_qty": current_pos,
            "max_qty": req.max_qty,
            "trade_qty": qty,
            "blocked": at_max,
        }

        # ── 8. Auto-execute on Tiger Demo when signal found ─────
        exec_result = None
        if has_signal and req.auto_execute:
            if at_max:
                exec_result = ExecutionResult(
                    executed=False,
                    order_id="",
                    side="BUY",
                    qty=qty,
                    status="MAX_POSITION",
                    reason=f"Position {current_pos}/{req.max_qty} — at max, no new orders",
                )
            else:
                trader = TigerTrader()
                trader.connect()
                bracket = trader.place_bracket_order(
                    symbol=symbol,
                    qty=qty,
                    side="BUY",
                    stop_loss_price=sl_price,
                    take_profit_price=tp_price,
                )
                if bracket.entry and bracket.entry.status != "FAILED":
                    parts = [f"Entry {bracket.entry.order_id}"]
                    if bracket.stop_loss:
                        parts.append(f"SL {bracket.stop_loss.order_id} @ ${sl_price:.2f}")
                    if bracket.take_profit:
                        parts.append(f"TP {bracket.take_profit.order_id} @ ${tp_price:.2f}")
                    exec_result = ExecutionResult(
                        executed=True,
                        order_id=bracket.entry.order_id,
                        side="BUY",
                        qty=qty,
                        status=bracket.entry.status,
                        reason=" | ".join(parts),
                    )
                else:
                    exec_result = ExecutionResult(
                        executed=False,
                        order_id="",
                        side="BUY",
                        qty=qty,
                        status="FAILED",
                        reason="Tiger API order failed",
                    )

        return has_signal, signal_obj, bt_check, exec_result, risk_check, position_info

    opportunity, signal, bt_check, exec_result, risk_check, position_info = await run_in_threadpool(_run)

    return ScanTradeResponse(
        opportunity=opportunity,
        signal=signal,
        backtest=bt_check,
        execution=exec_result,
        risk_check=risk_check,
        position=position_info,
        timestamp=datetime.now(timezone.utc).strftime("%d/%m/%Y %H:%M:%S UTC"),
    )


# ═══════════════════════════════════════════════════════════════════════
# 5-Minute Strategy Endpoints
# ═══════════════════════════════════════════════════════════════════════

class MGC5MinCandle(BaseModel):
    time: str
    open: float
    high: float
    low: float
    close: float
    volume: float
    ema_fast: Optional[float] = None
    ema_slow: Optional[float] = None
    rsi: Optional[float] = None
    macd_hist: Optional[float] = None
    st_dir: Optional[int] = None
    signal: int = 0


class MGC5MinTrade(BaseModel):
    entry_time: str
    exit_time: str
    entry_price: float
    exit_price: float
    qty: int
    pnl: float
    pnl_pct: float
    reason: str
    signal_type: str = ""
    direction: str = "CALL"  # "CALL" or "PUT"
    mae: float = 0.0  # Max Adverse Excursion (worst unrealized loss)


class MGC5MinMetrics(BaseModel):
    initial_capital: float
    final_equity: float
    total_return_pct: float
    max_drawdown_pct: float
    sharpe_ratio: float
    total_trades: int
    winners: int
    losers: int
    win_rate: float
    avg_win: float
    avg_loss: float
    profit_factor: float
    risk_reward_ratio: float
    # Out-of-sample
    oos_win_rate: float = 0.0
    oos_total_trades: int = 0
    oos_return_pct: float = 0.0


class MGC5MinBacktestResponse(BaseModel):
    symbol: str
    interval: str
    period: str
    candles: list[MGC5MinCandle]
    trades: list[MGC5MinTrade]
    equity_curve: list[float]
    metrics: MGC5MinMetrics
    params: dict
    timestamp: str


@router.get("/backtest_5min")
async def mgc_backtest_5min(
    symbol: Annotated[str, Query()] = "MGC=F",
    period: Annotated[str, Query()] = "60d",
    capital: Annotated[float, Query()] = INITIAL_CAPITAL,
    oos_split: Annotated[float, Query(ge=0, le=0.5)] = 0.3,
    atr_sl_mult: Annotated[float, Query(ge=0.5, le=10.0)] = 4.0,
    atr_tp_mult: Annotated[float, Query(ge=0.5, le=10.0)] = 3.0,
) -> MGC5MinBacktestResponse:
    """Run 5-minute strategy backtest with out-of-sample validation."""

    def _run():
        from mgc_trading.backtest_5min import Backtester5Min
        from mgc_trading.strategy_5min import MGCStrategy5Min, DEFAULT_5MIN_PARAMS

        # 5min: max 60d on yfinance
        effective_period = period
        if period not in ("1d", "2d", "5d", "7d", "30d", "60d"):
            effective_period = "60d"

        df = load_yfinance(symbol=symbol, interval="5m", period=effective_period)

        custom_params = {"atr_sl_mult": atr_sl_mult, "atr_tp_mult": atr_tp_mult}
        strategy = MGCStrategy5Min({**DEFAULT_5MIN_PARAMS, **custom_params})
        df_ind = strategy.compute_indicators(
            df[["open", "high", "low", "close", "volume"]].copy()
        )
        signals = strategy.generate_signals(df_ind)
        df_ind["signal"] = signals

        bt = Backtester5Min(capital=capital)
        result = bt.run(df, params=custom_params, oos_split=oos_split)

        # Build candle list
        candles = []
        for ts, row in df_ind.iterrows():
            candles.append(MGC5MinCandle(
                time=str(ts),
                open=round(float(row["open"]), 2),
                high=round(float(row["high"]), 2),
                low=round(float(row["low"]), 2),
                close=round(float(row["close"]), 2),
                volume=float(row.get("volume", 0)),
                ema_fast=round(float(row["ema_fast"]), 2) if not _isnan(row.get("ema_fast")) else None,
                ema_slow=round(float(row["ema_slow"]), 2) if not _isnan(row.get("ema_slow")) else None,
                rsi=round(float(row["rsi"]), 1) if not _isnan(row.get("rsi")) else None,
                macd_hist=round(float(row["macd_hist"]), 4) if not _isnan(row.get("macd_hist")) else None,
                st_dir=int(row["st_dir"]) if not _isnan(row.get("st_dir")) else None,
                signal=int(row.get("signal", 0)),
            ))

        trades = [
            MGC5MinTrade(
                entry_time=str(t.entry_time),
                exit_time=str(t.exit_time),
                entry_price=round(t.entry_price, 2),
                exit_price=round(t.exit_price, 2),
                qty=t.qty,
                pnl=round(t.pnl, 2),
                pnl_pct=round(t.pnl_pct, 2),
                reason=t.reason,
                signal_type=t.signal_type,
                direction=t.direction,
                mae=round(t.mae, 2),
            )
            for t in result.trades
        ]

        metrics = MGC5MinMetrics(
            initial_capital=result.initial_capital,
            final_equity=result.final_equity,
            total_return_pct=result.total_return_pct,
            max_drawdown_pct=result.max_drawdown_pct,
            sharpe_ratio=result.sharpe_ratio,
            total_trades=result.total_trades,
            winners=result.winners,
            losers=result.losers,
            win_rate=result.win_rate,
            avg_win=result.avg_win,
            avg_loss=result.avg_loss,
            profit_factor=result.profit_factor,
            risk_reward_ratio=result.risk_reward_ratio,
            oos_win_rate=result.oos_win_rate,
            oos_total_trades=result.oos_total_trades,
            oos_return_pct=result.oos_return_pct,
        )

        return candles, trades, result.equity_curve, metrics, result.params

    candles, trades, eq_curve, metrics, params = await run_in_threadpool(_run)

    return MGC5MinBacktestResponse(
        symbol=symbol,
        interval="5m",
        period=period,
        candles=candles,
        trades=trades,
        equity_curve=eq_curve,
        metrics=metrics,
        params=params,
        timestamp=datetime.now(timezone.utc).strftime("%d/%m/%Y %H:%M UTC"),
    )


# ── 5min Scan endpoint ──────────────────────────────────────────────

class Scan5MinSignal(BaseModel):
    found: bool
    direction: str  # "CALL" / "PUT" / "NONE"
    signal_type: str
    entry_price: float
    stop_loss: float
    take_profit: float
    risk_reward: float
    strength: int
    strength_detail: dict
    rsi: float
    atr: float
    ema_fast: float
    ema_slow: float
    macd_hist: float
    supertrend_dir: int
    volume_ratio: float
    bar_time: str


class Scan5MinResponse(BaseModel):
    opportunity: bool
    signal: Scan5MinSignal
    timestamp: str


@router.get("/scan_5min")
async def mgc_scan_5min(
    symbol: Annotated[str, Query()] = "MGC=F",
    period: Annotated[str, Query()] = "60d",
    atr_sl_mult: Annotated[float, Query(ge=0.5, le=10.0)] = 4.0,
    atr_tp_mult: Annotated[float, Query(ge=0.5, le=10.0)] = 3.0,
) -> Scan5MinResponse:
    """Scan for 5-minute entry signal using yfinance data."""

    def _run():
        from mgc_trading.scanner_5min import scan_5min

        effective_period = period
        if period not in ("1d", "2d", "5d", "7d", "30d", "60d"):
            effective_period = "60d"

        df = load_yfinance(symbol=symbol, interval="5m", period=effective_period)
        custom_params = {"atr_sl_mult": atr_sl_mult, "atr_tp_mult": atr_tp_mult}
        result = scan_5min(df, params=custom_params)

        sig = Scan5MinSignal(
            found=result.found,
            direction=result.direction,
            signal_type=result.signal_type,
            entry_price=result.entry_price,
            stop_loss=result.stop_loss,
            take_profit=result.take_profit,
            risk_reward=result.risk_reward,
            strength=result.strength,
            strength_detail=result.strength_detail,
            rsi=result.rsi,
            atr=result.atr,
            ema_fast=result.ema_fast,
            ema_slow=result.ema_slow,
            macd_hist=result.macd_hist,
            supertrend_dir=result.supertrend_dir,
            volume_ratio=result.volume_ratio,
            bar_time=result.bar_time,
        )
        return result.found, sig

    found, sig = await run_in_threadpool(_run)

    return Scan5MinResponse(
        opportunity=found,
        signal=sig,
        timestamp=datetime.now(timezone.utc).strftime("%d/%m/%Y %H:%M:%S UTC"),
    )


# ── 5min Live Scan (Tiger API) ──────────────────────────────────────

@router.get("/scan_5min_live")
async def mgc_scan_5min_live(
    atr_sl_mult: Annotated[float, Query(ge=0.5, le=10.0)] = 4.0,
    atr_tp_mult: Annotated[float, Query(ge=0.5, le=10.0)] = 3.0,
) -> Scan5MinResponse:
    """Scan for 5-minute entry signal using Tiger live data."""

    def _run():
        import pandas as pd
        from mgc_trading.scanner_5min import scan_5min

        if not _tiger_quote_ok:
            raise ValueError("Tiger SDK not available")

        quote_client, trade_client = _get_tiger_clients()
        contracts = trade_client.get_contracts("MGC", sec_type="FUT")
        if not contracts:
            raise ValueError("No MGC contract found")
        identifier = contracts[0].identifier
        period = _BAR_PERIOD_MAP.get("5m")

        df_raw = quote_client.get_future_bars(identifier, period=period, limit=500)
        if df_raw is None or df_raw.empty:
            raise ValueError("No data from Tiger API")

        df = df_raw[["open", "high", "low", "close", "volume"]].copy()
        df.index = pd.to_datetime(df_raw["time"], unit="ms")
        df = df.sort_index()

        result = scan_5min(df, params={"atr_sl_mult": atr_sl_mult, "atr_tp_mult": atr_tp_mult})

        sig = Scan5MinSignal(
            found=result.found,
            direction=result.direction,
            signal_type=result.signal_type,
            entry_price=result.entry_price,
            stop_loss=result.stop_loss,
            take_profit=result.take_profit,
            risk_reward=result.risk_reward,
            strength=result.strength,
            strength_detail=result.strength_detail,
            rsi=result.rsi,
            atr=result.atr,
            ema_fast=result.ema_fast,
            ema_slow=result.ema_slow,
            macd_hist=result.macd_hist,
            supertrend_dir=result.supertrend_dir,
            volume_ratio=result.volume_ratio,
            bar_time=result.bar_time,
        )
        return result.found, sig

    found, sig = await run_in_threadpool(_run)

    return Scan5MinResponse(
        opportunity=found,
        signal=sig,
        timestamp=datetime.now(timezone.utc).strftime("%d/%m/%Y %H:%M:%S UTC"),
    )


# ── 5min Execute (Tiger Bracket Order) ──────────────────────────────

class Execute5MinRequest(BaseModel):
    """Request body for /execute_5min endpoint."""
    qty: int = 1
    max_qty: int = 5
    direction: str = "CALL"       # "CALL" or "PUT"
    entry_price: float = 0.0
    stop_loss: float = 0.0
    take_profit: float = 0.0


class Execute5MinResponse(BaseModel):
    """Response from /execute_5min endpoint."""
    execution: Optional[ExecutionResult] = None
    position: dict = {}            # current_qty, max_qty, blocked
    timestamp: str = ""


@router.post("/execute_5min")
async def mgc_execute_5min(req: Execute5MinRequest) -> Execute5MinResponse:
    """Execute a 5-minute strategy trade on Tiger account.

    Places a bracket order (entry MKT + OCA SL/TP) for the given direction.
    """
    def _run():
        from mgc_trading.tiger_execution import TigerTrader

        side = "BUY" if req.direction == "CALL" else "SELL"

        # Position check
        current_pos = _get_tiger_position("MGC")
        at_max = current_pos >= req.max_qty
        position_info = {
            "current_qty": current_pos,
            "max_qty": req.max_qty,
            "trade_qty": req.qty,
            "blocked": at_max,
        }

        if at_max:
            exec_result = ExecutionResult(
                executed=False,
                order_id="",
                side=side,
                qty=req.qty,
                status="MAX_POSITION",
                reason=f"Position {current_pos}/{req.max_qty} — at max, no new orders",
            )
            return exec_result, position_info

        trader = TigerTrader()
        trader.connect()
        bracket = trader.place_bracket_order(
            symbol="MGC",
            qty=req.qty,
            side=side,
            stop_loss_price=req.stop_loss,
            take_profit_price=req.take_profit,
        )
        if bracket.entry and bracket.entry.status != "FAILED":
            parts = [f"Entry {bracket.entry.order_id} {side}"]
            if bracket.stop_loss:
                parts.append(f"SL {bracket.stop_loss.order_id} @ ${req.stop_loss:.2f}")
            if bracket.take_profit:
                parts.append(f"TP {bracket.take_profit.order_id} @ ${req.take_profit:.2f}")
            exec_result = ExecutionResult(
                executed=True,
                order_id=bracket.entry.order_id,
                side=side,
                qty=req.qty,
                status=bracket.entry.status,
                reason=" | ".join(parts),
            )
        else:
            exec_result = ExecutionResult(
                executed=False,
                order_id="",
                side=side,
                qty=req.qty,
                status="FAILED",
                reason="Tiger API order failed",
            )
        return exec_result, position_info

    exec_result, position_info = await run_in_threadpool(_run)

    return Execute5MinResponse(
        execution=exec_result,
        position=position_info,
        timestamp=datetime.now(timezone.utc).strftime("%d/%m/%Y %H:%M:%S UTC"),
    )


# ── 5min Optimize endpoint ──────────────────────────────────────────

class Optimize5MinResult(BaseModel):
    rank: int
    score: float
    win_rate: float
    total_return_pct: float
    max_drawdown_pct: float
    sharpe_ratio: float
    profit_factor: float
    risk_reward_ratio: float
    total_trades: int
    oos_win_rate: float
    oos_total_trades: int
    oos_return_pct: float
    params: dict


class Optimize5MinResponse(BaseModel):
    total_combos: int
    passed_filter: int
    results: list[Optimize5MinResult]
    timestamp: str


@router.get("/optimize_5min")
async def mgc_optimize_5min(
    symbol: Annotated[str, Query()] = "MGC=F",
    period: Annotated[str, Query()] = "60d",
    quick: Annotated[bool, Query()] = True,
    top_n: Annotated[int, Query(ge=1, le=20)] = 5,
) -> Optimize5MinResponse:
    """Run 5-minute strategy optimisation (grid search)."""

    def _run():
        from mgc_trading.optimizer_5min import (
            optimize_5min,
            QUICK_5MIN_GRID,
            DEFAULT_5MIN_GRID,
        )
        from itertools import product

        effective_period = period
        if period not in ("1d", "2d", "5d", "7d", "30d", "60d"):
            effective_period = "60d"

        df = load_yfinance(symbol=symbol, interval="5m", period=effective_period)

        grid = QUICK_5MIN_GRID if quick else DEFAULT_5MIN_GRID
        total_combos = 1
        for v in grid.values():
            total_combos *= len(v)

        results = optimize_5min(df, quick=quick)

        top = []
        for i, (params, res, score) in enumerate(results[:top_n]):
            top.append(Optimize5MinResult(
                rank=i + 1,
                score=round(score, 4),
                win_rate=res.win_rate,
                total_return_pct=res.total_return_pct,
                max_drawdown_pct=res.max_drawdown_pct,
                sharpe_ratio=res.sharpe_ratio,
                profit_factor=res.profit_factor,
                risk_reward_ratio=res.risk_reward_ratio,
                total_trades=res.total_trades,
                oos_win_rate=res.oos_win_rate,
                oos_total_trades=res.oos_total_trades,
                oos_return_pct=res.oos_return_pct,
                params=params,
            ))

        return total_combos, len(results), top

    total_combos, passed, top = await run_in_threadpool(_run)

    return Optimize5MinResponse(
        total_combos=total_combos,
        passed_filter=passed,
        results=top,
        timestamp=datetime.now(timezone.utc).strftime("%d/%m/%Y %H:%M UTC"),
    )


# ── Trade Log (last 50 from backtest) ───────────────────────────────

class TradeLog5MinResponse(BaseModel):
    trades: list[MGC5MinTrade]
    total: int
    win_rate: float
    total_pnl: float
    timestamp: str


@router.get("/trade_log_5min")
async def mgc_trade_log_5min(
    symbol: Annotated[str, Query()] = "MGC=F",
    period: Annotated[str, Query()] = "60d",
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
) -> TradeLog5MinResponse:
    """Return the last N trades from 5-minute backtest."""

    def _run():
        from mgc_trading.backtest_5min import Backtester5Min

        effective_period = period
        if period not in ("1d", "2d", "5d", "7d", "30d", "60d"):
            effective_period = "60d"

        df = load_yfinance(symbol=symbol, interval="5m", period=effective_period)
        bt = Backtester5Min()
        result = bt.run(df)

        all_trades = result.trades
        recent = all_trades[-limit:] if len(all_trades) > limit else all_trades

        trade_list = [
            MGC5MinTrade(
                entry_time=str(t.entry_time),
                exit_time=str(t.exit_time),
                entry_price=round(t.entry_price, 2),
                exit_price=round(t.exit_price, 2),
                qty=t.qty,
                pnl=round(t.pnl, 2),
                pnl_pct=round(t.pnl_pct, 2),
                reason=t.reason,
                signal_type=t.signal_type,
                mae=round(t.mae, 2),
            )
            for t in recent
        ]

        total_pnl = sum(t.pnl for t in recent)
        wins = sum(1 for t in recent if t.pnl > 0)
        wr = wins / len(recent) * 100 if recent else 0

        return trade_list, len(all_trades), round(wr, 1), round(total_pnl, 2)

    trades, total, wr, pnl = await run_in_threadpool(_run)

    return TradeLog5MinResponse(
        trades=trades,
        total=total,
        win_rate=wr,
        total_pnl=pnl,
        timestamp=datetime.now(timezone.utc).strftime("%d/%m/%Y %H:%M:%S UTC"),
    )
