"""
MGC Trading API — REST endpoints for the frontend dashboard.
=============================================================
Provides /mgc/backtest and /mgc/live endpoints that the frontend
can call to get chart data, trade markers, and performance metrics.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Optional

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
    symbol: str = Query(default="MGC=F"),
    interval: str = Query(default="15m"),
    period: str = Query(default="60d"),
    capital: float = Query(default=INITIAL_CAPITAL),
    # Optional param overrides
    ema_fast: Optional[int] = None,
    ema_slow: Optional[int] = None,
    atr_sl_mult: Optional[float] = None,
    atr_tp_mult: Optional[float] = None,
) -> MGCBacktestResponse:
    """Run MGC backtest and return chart candles + trades + metrics."""

    def _run():
        # Load data
        df = load_yfinance(symbol=symbol, interval=interval, period=period)

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
        result = bt.run(df, params)

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
        timestamp=datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC"),
    )


def _isnan(v) -> bool:
    try:
        import math
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
    interval: str = Query(default="15m"),
    limit: int = Query(default=500, ge=50, le=1000),
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
        atr_vals = ind.atr(df["high"], df["low"], df["close"], p["atr_period"])

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
        timestamp=datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC"),
    )
