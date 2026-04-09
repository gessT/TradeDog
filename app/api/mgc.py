"""
MGC Trading API — REST endpoints for the frontend dashboard.
=============================================================
Provides /mgc/backtest and /mgc/live endpoints that the frontend
can call to get chart data, trade markers, and performance metrics.
"""
from __future__ import annotations

import logging
import math
from datetime import datetime, timedelta, timezone

SGT = timezone(timedelta(hours=8))  # Asia/Singapore UTC+8
from typing import Annotated, Optional

from fastapi import APIRouter, HTTPException, Query
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
        timestamp=datetime.now(SGT).strftime("%d/%m/%Y %H:%M SGT"),
    )


def _isnan(v) -> bool:
    try:
        return math.isnan(float(v))
    except (TypeError, ValueError):
        return True


# ═══════════════════════════════════════════════════════════════════════
# Single-symbol live price (lightweight)
# ═══════════════════════════════════════════════════════════════════════

@router.get("/price/{symbol}")
async def live_price(symbol: str):
    """Quick single-symbol price — Tiger first, yfinance fallback."""
    def _run():
        # Try Tiger API first for real broker price
        if _tiger_quote_ok:
            try:
                quote_client, trade_client = _get_tiger_clients()
                contracts = trade_client.get_contracts(symbol, sec_type="FUT")
                identifier = contracts[0].identifier if contracts else symbol
                period_1m = _BAR_PERIOD_MAP.get("1m")
                if period_1m:
                    df = quote_client.get_future_bars(identifier, period=period_1m, limit=1)
                    if df is not None and not df.empty:
                        return round(float(df["close"].iloc[-1]), 2)
            except Exception:
                pass  # fallback to yfinance

        import yfinance as yf
        commodity = _COMMODITY_SYMBOLS.get(symbol, {"yf": f"{symbol}=F"})
        t = yf.Ticker(commodity["yf"])
        price = float(t.fast_info.last_price or 0)
        return round(price, 2)

    price = await run_in_threadpool(_run)
    return {"symbol": symbol, "price": price}


# ═══════════════════════════════════════════════════════════════════════
# Multi-commodity quotes endpoint
# ═══════════════════════════════════════════════════════════════════════

# yfinance symbols for commodities we track
_COMMODITY_SYMBOLS = {
    "MGC": {"yf": "MGC=F", "name": "Micro Gold", "icon": "🥇", "tiger": "MGC", "tick": 0.10},
    "MCL": {"yf": "MCL=F", "name": "Micro Crude Oil", "icon": "🛢️", "tiger": "MCL", "tick": 0.01},
}


class CommodityQuote(BaseModel):
    symbol: str
    name: str
    icon: str
    price: float
    prev_close: float
    change: float
    change_pct: float
    high: float
    low: float
    volume: int
    updated: str


class CommodityQuotesResponse(BaseModel):
    quotes: list[CommodityQuote]
    timestamp: str


@router.get("/quotes")
async def commodity_quotes() -> CommodityQuotesResponse:
    """Fetch latest quotes for multiple commodity futures via yfinance."""

    def _run():
        import yfinance as yf

        quotes: list[CommodityQuote] = []
        symbols = list(_COMMODITY_SYMBOLS.keys())
        yf_tickers = [_COMMODITY_SYMBOLS[s]["yf"] for s in symbols]

        tickers = yf.Tickers(" ".join(yf_tickers))

        for sym_key, yf_sym in zip(symbols, yf_tickers):
            meta = _COMMODITY_SYMBOLS[sym_key]
            try:
                info = tickers.tickers[yf_sym].fast_info
                price = float(info.last_price or 0)
                prev = float(info.previous_close or 0)
                change = price - prev
                change_pct = (change / prev * 100) if prev else 0.0

                # Get today's high/low/volume from 1d history
                hist = tickers.tickers[yf_sym].history(period="1d", interval="1m")
                day_high = float(hist["High"].max()) if not hist.empty else price
                day_low = float(hist["Low"].min()) if not hist.empty else price
                day_vol = int(hist["Volume"].sum()) if not hist.empty else 0

                quotes.append(CommodityQuote(
                    symbol=sym_key,
                    name=meta["name"],
                    icon=meta["icon"],
                    price=round(price, 2),
                    prev_close=round(prev, 2),
                    change=round(change, 2),
                    change_pct=round(change_pct, 2),
                    high=round(day_high, 2),
                    low=round(day_low, 2),
                    volume=day_vol,
                    updated=datetime.now(SGT).strftime("%H:%M:%S SGT"),
                ))
            except Exception as exc:
                logger.warning("Quote fetch failed for %s: %s", sym_key, exc)
                quotes.append(CommodityQuote(
                    symbol=sym_key, name=meta["name"], icon=meta["icon"],
                    price=0, prev_close=0, change=0, change_pct=0,
                    high=0, low=0, volume=0, updated="--:--:--",
                ))

        return quotes

    quotes = await run_in_threadpool(_run)
    return CommodityQuotesResponse(
        quotes=quotes,
        timestamp=datetime.now(SGT).strftime("%d/%m/%Y %H:%M:%S SGT"),
    )


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
    """Create Tiger quote + trade clients (cached — reuse across calls)."""
    if not hasattr(_get_tiger_clients, "_cache"):
        config = _TConfig()
        config.tiger_id = TIGER_ID
        config.language = _Language.en_US
        config.private_key = _read_pk(TIGER_PRIVATE_KEY)
        config.account = TIGER_ACCOUNT
        _get_tiger_clients._cache = (_QuoteClient(config), _TradeClient(config))
    return _get_tiger_clients._cache


@router.get("/live")
async def mgc_live(
    symbol: Annotated[str, Query()] = "MGC",
    interval: Annotated[str, Query()] = "15m",
    limit: Annotated[int, Query(ge=50, le=2000)] = 500,
) -> MGCLiveResponse:
    """Fetch real-time bars from Tiger API with yfinance fallback."""

    def _run():
        import pandas as pd
        from mgc_trading import indicators as ind

        # Resolve yfinance symbol from commodity map
        commodity = _COMMODITY_SYMBOLS.get(symbol, {"yf": "MGC=F"})
        yf_symbol = commodity["yf"]

        identifier = symbol
        use_tiger = False

        # ── Try Tiger API first (only for MGC) ───────────────────
        if _tiger_quote_ok and symbol == "MGC":
            try:
                quote_client, trade_client = _get_tiger_clients()
                contracts = trade_client.get_contracts("MGC", sec_type="FUT")
                identifier = contracts[0].identifier if contracts else "MGC"

                period = _BAR_PERIOD_MAP.get(interval)
                if period is None:
                    raise ValueError(f"Unsupported interval: {interval}")

                df_raw = quote_client.get_future_bars(identifier, period=period, limit=limit)
                if df_raw is not None and not df_raw.empty:
                    times = df_raw["time"].tolist()
                    df = df_raw[["open", "high", "low", "close", "volume"]].copy()
                    df.index = pd.to_datetime(df_raw["time"], unit="ms")
                    df["_time_ms"] = times
                    df = df.sort_index()
                    use_tiger = True
            except Exception:
                logger.warning("Tiger API unavailable, falling back to yfinance")

        # ── Fallback: yfinance ───────────────────────────────────
        if not use_tiger:
            # yfinance caps: 1m→7d, 5m/15m→60d
            yf_period = "60d"
            if interval == "1m":
                yf_period = "7d"
            df = load_yfinance(symbol=yf_symbol, interval=interval, period=yf_period)
            if df is None or df.empty:
                raise ValueError(f"No data from yfinance for {yf_symbol}")
            # Trim to requested limit
            if len(df) > limit:
                df = df.iloc[-limit:]
            # Add epoch-ms column
            df["_time_ms"] = [int(ts.timestamp() * 1000) for ts in df.index]

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

    try:
        identifier, candles, ema_fast, ema_slow, rsi_vals, signals, price = await run_in_threadpool(_run)
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as exc:
        logger.exception("Live data fetch failed for %s", symbol)
        raise HTTPException(status_code=500, detail=str(exc))

    return MGCLiveResponse(
        symbol=symbol,
        identifier=identifier,
        interval=interval,
        candles=candles,
        ema_fast=ema_fast,
        ema_slow=ema_slow,
        rsi=rsi_vals,
        signals=signals,
        current_price=round(price, 2),
        timestamp=datetime.now(SGT).strftime("%d/%m/%Y %H:%M:%S SGT"),
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
    is_fresh: bool = True           # True = signal just appeared this bar
    bars_since_first: int = 0       # 0 = fresh, 1+ = stale


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


# ── Tiger Account: Positions, Orders, Assets, Buy/Sell, Cancel ──────


class TigerPositionItem(BaseModel):
    symbol: str
    quantity: int
    average_cost: float
    latest_price: float = 0.0
    market_value: float
    unrealized_pnl: float
    realized_pnl: float
    currency: str = "USD"
    open_time: str = ""


class TigerOrderItem(BaseModel):
    order_id: str
    symbol: str
    action: str          # BUY / SELL
    order_type: str      # MKT / LMT / STP
    quantity: int
    filled_quantity: int
    limit_price: float
    avg_fill_price: float
    status: str
    trade_time: str


class TigerAccountInfo(BaseModel):
    net_liquidation: float
    cash: float
    unrealized_pnl: float
    realized_pnl: float
    buying_power: float
    currency: str = "USD"


class TigerAccountResponse(BaseModel):
    account: TigerAccountInfo
    positions: list[TigerPositionItem]
    open_orders: list[TigerOrderItem]
    filled_orders: list[TigerOrderItem]
    timestamp: str


class SimpleOrderRequest(BaseModel):
    symbol: str = "MGC"
    side: str = "BUY"          # BUY or SELL
    qty: int = 1
    order_type: str = "MKT"   # MKT or LMT
    limit_price: Optional[float] = None


class SimpleOrderResponse(BaseModel):
    success: bool
    order_id: str = ""
    message: str = ""


@router.get("/account")
async def tiger_account() -> TigerAccountResponse:
    """Retrieve full Tiger account: assets + positions + orders."""

    def _run():
        _, trade_client = _get_tiger_clients()

        # Assets
        account_info = TigerAccountInfo(
            net_liquidation=0, cash=0, unrealized_pnl=0,
            realized_pnl=0, buying_power=0,
        )
        try:
            assets = trade_client.get_assets(account=TIGER_ACCOUNT)
            if assets:
                a = assets[0]
                # Summary has the aggregated values
                s = getattr(a, "summary", None) or a
                # Commodity segment for futures-specific cash
                segs = getattr(a, "segments", {})
                comm = segs.get("C", None)

                account_info = TigerAccountInfo(
                    net_liquidation=float(getattr(s, "net_liquidation", 0) or 0),
                    cash=float(getattr(comm, "cash", 0) or getattr(s, "cash", 0) or 0),
                    unrealized_pnl=float(getattr(s, "unrealized_pnl", 0) or 0),
                    realized_pnl=float(getattr(s, "realized_pnl", 0) or 0),
                    buying_power=float(getattr(s, "buying_power", 0) or getattr(comm, "available_funds", 0) or 0),
                )
        except Exception:
            logger.exception("Failed to get Tiger assets")

        # Positions
        positions: list[TigerPositionItem] = []
        try:
            raw_pos = trade_client.get_positions(account=TIGER_ACCOUNT, sec_type="FUT")
            for p in (raw_pos or []):
                sym = ""
                if p.contract and p.contract.symbol:
                    sym = p.contract.symbol
                positions.append(TigerPositionItem(
                    symbol=sym,
                    quantity=int(getattr(p, "quantity", 0) or 0),
                    average_cost=float(getattr(p, "average_cost", 0) or 0),
                    latest_price=float(getattr(p, "latest_price", 0) or getattr(p, "market_price", 0) or 0),
                    market_value=float(getattr(p, "market_value", 0) or 0),
                    unrealized_pnl=float(getattr(p, "unrealized_pnl", 0) or 0),
                    realized_pnl=float(getattr(p, "realized_pnl", 0) or 0),
                ))
        except Exception:
            logger.exception("Failed to get Tiger positions")

        # Open orders
        open_orders: list[TigerOrderItem] = []
        try:
            raw_open = trade_client.get_open_orders(account=TIGER_ACCOUNT, sec_type="FUT")
            for o in (raw_open or []):
                open_orders.append(_order_to_item(o))
        except Exception:
            logger.exception("Failed to get Tiger open orders")

        # Recent filled orders (last 50)
        filled_orders: list[TigerOrderItem] = []
        try:
            _start = (datetime.now() - timedelta(days=7)).strftime("%Y-%m-%d")
            _end = (datetime.now() + timedelta(days=1)).strftime("%Y-%m-%d")
            raw_filled = trade_client.get_filled_orders(account=TIGER_ACCOUNT, sec_type="FUT", start_date=_start, end_date=_end)
            all_items = [_order_to_item(o) for o in (raw_filled or [])]
            filled_orders = all_items[:50]  # Tiger returns newest-first; keep most recent 50
        except Exception:
            logger.exception("Failed to get Tiger filled orders")

        # Cross-reference positions with filled orders to find open time
        for pos in positions:
            if not pos.symbol:
                continue
            # Find the direction that opened this position (BUY for long, SELL for short)
            open_action = "BUY" if pos.quantity > 0 else "SELL"
            # Strip trailing digits from position symbol (e.g. MGC2606 → MGC) to match order symbol
            import re
            pos_base = re.sub(r"\d+$", "", pos.symbol)
            # Find earliest filled order for this symbol + direction
            matching = [
                o for o in filled_orders
                if o.symbol == pos_base and o.action == open_action and o.trade_time
            ]
            if matching:
                matching.sort(key=lambda o: o.trade_time, reverse=True)
                pos.open_time = matching[0].trade_time

        return TigerAccountResponse(
            account=account_info,
            positions=positions,
            open_orders=open_orders,
            filled_orders=filled_orders,
            timestamp=datetime.now(SGT).strftime("%d/%m/%Y %H:%M:%S SGT"),
        )

    return await run_in_threadpool(_run)


# ── Trade History: pair filled orders into round-trip trades ─────────

# Contract multipliers for P&L calculation
_CONTRACT_MULT: dict[str, float] = {
    "MGC": 10.0,    # 10 troy oz per Micro Gold
    "MCL": 100.0,   # 100 barrels per Micro Crude
    "MNQ": 2.0,     # $2 per point Micro Nasdaq
    "MES": 5.0,     # $5 per point Micro S&P
    "MYM": 0.5,     # $0.50 per point Micro Dow
    "M2K": 5.0,     # $5 per point Micro Russell
    "CL": 1000.0,   # 1000 barrels Crude Oil
    "GC": 100.0,    # 100 troy oz Gold
    "NQ": 20.0,     # $20 per point Nasdaq
    "ES": 50.0,     # $50 per point S&P
    "NG": 10000.0,  # 10,000 MMBtu Natural Gas
    "SI": 5000.0,   # 5,000 troy oz Silver
    "HG": 25000.0,  # 25,000 lbs Copper
}


def _get_multiplier(symbol: str) -> float:
    """Get contract multiplier from symbol (strip trailing digits)."""
    import re
    base = re.sub(r"\d+$", "", symbol)
    return _CONTRACT_MULT.get(base, 1.0)


class TradeRecord(BaseModel):
    """A round-trip trade: entry → exit with P&L."""
    symbol: str
    side: str              # LONG or SHORT (direction of entry)
    qty: int
    entry_price: float
    exit_price: float
    entry_time: str
    exit_time: str
    pnl: float             # dollar P&L
    pnl_pct: float         # % return on entry notional
    multiplier: float
    entry_order_id: str = ""
    exit_order_id: str = ""
    status: str = "CLOSED" # CLOSED or OPEN (still holding)


class TradeHistoryResponse(BaseModel):
    trades: list[TradeRecord]
    summary: dict
    timestamp: str


@router.get("/trade_history")
async def tiger_trade_history(
    days: Annotated[int, Query(ge=1, le=90)] = 7,
) -> TradeHistoryResponse:
    """Pair filled orders into round-trip trades with P&L."""

    def _run():
        _, trade_client = _get_tiger_clients()

        _start = (datetime.now() - timedelta(days=days)).strftime("%Y-%m-%d")
        _end = (datetime.now() + timedelta(days=1)).strftime("%Y-%m-%d")

        raw_filled = trade_client.get_filled_orders(
            account=TIGER_ACCOUNT, sec_type="FUT",
            start_date=_start, end_date=_end,
        )
        if not raw_filled:
            return TradeHistoryResponse(
                trades=[], summary=_empty_summary(),
                timestamp=datetime.now(SGT).strftime("%d/%m/%Y %H:%M:%S SGT"),
            )

        # Normalize fills
        fills = []
        for o in raw_filled:
            sym = ""
            if hasattr(o, "contract") and o.contract and hasattr(o.contract, "symbol"):
                sym = o.contract.symbol or ""
            action = str(getattr(o, "action", "") or "").upper()
            qty = int(getattr(o, "filled", 0) or getattr(o, "filled_quantity", 0) or 0)
            price = float(getattr(o, "avg_fill_price", 0) or 0)
            oid = str(getattr(o, "order_id", "") or getattr(o, "id", "") or "")
            raw_time = getattr(o, "trade_time", None) or getattr(o, "order_time", None)
            tstr = _fmt_tiger_time(raw_time)

            if sym and action in ("BUY", "SELL") and qty > 0 and price > 0:
                fills.append({
                    "symbol": sym, "action": action, "qty": qty,
                    "price": price, "time": tstr, "order_id": oid,
                    "ts": raw_time if isinstance(raw_time, (int, float)) else 0,
                })

        # Sort by timestamp
        fills.sort(key=lambda f: f["ts"])

        # Pair into round-trip trades (FIFO per symbol)
        from collections import defaultdict
        open_fills: dict[str, list] = defaultdict(list)
        trades: list[TradeRecord] = []

        for fill in fills:
            sym = fill["symbol"]
            action = fill["action"]
            remaining = fill["qty"]

            while remaining > 0:
                stack = open_fills[sym]
                if stack and stack[0]["action"] != action:
                    # Opposite side — close the trade
                    entry_fill = stack[0]
                    match_qty = min(remaining, entry_fill["qty"])

                    mult = _get_multiplier(sym)
                    if entry_fill["action"] == "BUY":
                        # LONG trade: bought then sold
                        pnl = (fill["price"] - entry_fill["price"]) * match_qty * mult
                        side = "LONG"
                    else:
                        # SHORT trade: sold then bought
                        pnl = (entry_fill["price"] - fill["price"]) * match_qty * mult
                        side = "SHORT"

                    entry_notional = entry_fill["price"] * match_qty * mult
                    pnl_pct = (pnl / entry_notional * 100) if entry_notional else 0

                    trades.append(TradeRecord(
                        symbol=sym,
                        side=side,
                        qty=match_qty,
                        entry_price=round(entry_fill["price"], 4),
                        exit_price=round(fill["price"], 4),
                        entry_time=entry_fill["time"],
                        exit_time=fill["time"],
                        pnl=round(pnl, 2),
                        pnl_pct=round(pnl_pct, 2),
                        multiplier=mult,
                        entry_order_id=entry_fill["order_id"],
                        exit_order_id=fill["order_id"],
                    ))

                    entry_fill["qty"] -= match_qty
                    remaining -= match_qty
                    if entry_fill["qty"] <= 0:
                        stack.pop(0)
                else:
                    # Same side or no open — add to stack
                    open_fills[sym].append({**fill, "qty": remaining})
                    remaining = 0

        # Add open (unpaired) positions as OPEN trades
        for sym, stack in open_fills.items():
            for f in stack:
                if f["qty"] > 0:
                    mult = _get_multiplier(sym)
                    side = "LONG" if f["action"] == "BUY" else "SHORT"
                    trades.append(TradeRecord(
                        symbol=sym,
                        side=side,
                        qty=f["qty"],
                        entry_price=round(f["price"], 4),
                        exit_price=0,
                        entry_time=f["time"],
                        exit_time="",
                        pnl=0,
                        pnl_pct=0,
                        multiplier=mult,
                        entry_order_id=f["order_id"],
                        exit_order_id="",
                        status="OPEN",
                    ))

        # Sort: OPEN first, then CLOSED newest first
        trades.sort(key=lambda t: (
            0 if t.status == "OPEN" else 1,
            t.exit_time or t.entry_time,
        ), reverse=True)
        # Re-sort: OPEN on top, then by time desc
        open_trades = [t for t in trades if t.status == "OPEN"]
        closed_trades = [t for t in trades if t.status == "CLOSED"]
        closed_trades.sort(key=lambda t: t.exit_time, reverse=True)
        trades = open_trades + closed_trades

        # Summary (only count closed trades)
        closed = [t for t in trades if t.status == "CLOSED"]
        total_pnl = sum(t.pnl for t in closed)
        wins = [t for t in closed if t.pnl > 0]
        losses = [t for t in closed if t.pnl <= 0]
        win_rate = len(wins) / len(closed) * 100 if closed else 0
        gross_win = sum(t.pnl for t in wins)
        gross_loss = abs(sum(t.pnl for t in losses))
        pf = gross_win / gross_loss if gross_loss > 0 else float("inf") if gross_win > 0 else 0

        summary = {
            "total_trades": len(closed),
            "open_trades": len(open_trades),
            "wins": len(wins),
            "losses": len(losses),
            "win_rate": round(win_rate, 1),
            "total_pnl": round(total_pnl, 2),
            "avg_pnl": round(total_pnl / len(closed), 2) if closed else 0,
            "profit_factor": round(pf, 2) if pf != float("inf") else 999.99,
            "best_trade": round(max((t.pnl for t in trades), default=0), 2),
            "worst_trade": round(min((t.pnl for t in trades), default=0), 2),
        }

        return TradeHistoryResponse(
            trades=trades, summary=summary,
            timestamp=datetime.now(SGT).strftime("%d/%m/%Y %H:%M:%S SGT"),
        )

    return await run_in_threadpool(_run)


def _empty_summary() -> dict:
    return {
        "total_trades": 0, "wins": 0, "losses": 0, "win_rate": 0,
        "total_pnl": 0, "avg_pnl": 0, "profit_factor": 0,
        "best_trade": 0, "worst_trade": 0,
    }


def _order_to_item(o) -> TigerOrderItem:
    """Convert a Tiger SDK order object to our serialisable model."""
    sym = ""
    if hasattr(o, "contract") and o.contract and hasattr(o.contract, "symbol"):
        sym = o.contract.symbol or ""
    status_raw = str(getattr(o, "status", "") or "")
    # Strip "OrderStatus." prefix from SDK enum repr
    if "." in status_raw:
        status_raw = status_raw.rsplit(".", 1)[-1]
    return TigerOrderItem(
        order_id=str(getattr(o, "order_id", "") or getattr(o, "id", "") or ""),
        symbol=sym,
        action=str(getattr(o, "action", "") or ""),
        order_type=str(getattr(o, "order_type", "") or ""),
        quantity=int(getattr(o, "quantity", 0) or 0),
        filled_quantity=int(getattr(o, "filled", 0) or getattr(o, "filled_quantity", 0) or 0),
        limit_price=float(getattr(o, "limit_price", 0) or 0),
        avg_fill_price=float(getattr(o, "avg_fill_price", 0) or 0),
        status=status_raw,
        trade_time=_fmt_tiger_time(getattr(o, "trade_time", None) or getattr(o, "order_time", None)),
    )


def _fmt_tiger_time(raw) -> str:
    """Convert Tiger SDK time (ms timestamp or string) to ISO format in SGT."""
    if not raw:
        return ""
    if isinstance(raw, (int, float)):
        # Millisecond timestamp
        ts = raw / 1000 if raw > 1e12 else raw
        return datetime.fromtimestamp(ts, tz=SGT).strftime("%Y-%m-%dT%H:%M:%S+08:00")
    return str(raw)


@router.post("/order")
async def place_simple_order(req: SimpleOrderRequest) -> SimpleOrderResponse:
    """Place a simple BUY or SELL market/limit order on Tiger."""

    def _run():
        import re
        from tigeropen.common.util.order_utils import market_order, limit_order

        _, trade_client = _get_tiger_clients()

        # Strip expiry digits (e.g. MGC2606 → MGC) for contract lookup
        base_symbol = re.sub(r"\d+$", "", req.symbol) or req.symbol

        # Resolve contract
        contracts = trade_client.get_contracts(base_symbol, sec_type="FUT")
        if not contracts:
            return SimpleOrderResponse(success=False, message=f"No contract found for {req.symbol} (base={base_symbol})")
        contract = contracts[0]
        contract.expiry = None  # SDK v3.5.7

        side = req.side.upper()
        if side not in ("BUY", "SELL"):
            return SimpleOrderResponse(success=False, message=f"Invalid side: {side}")

        if req.order_type == "LMT" and req.limit_price:
            order = limit_order(
                account=TIGER_ACCOUNT, contract=contract,
                action=side, quantity=req.qty, limit_price=req.limit_price,
            )
        else:
            order = market_order(
                account=TIGER_ACCOUNT, contract=contract,
                action=side, quantity=req.qty,
            )

        result = trade_client.place_order(order)
        return SimpleOrderResponse(
            success=True,
            order_id=str(result),
            message=f"{side} {req.qty}x {req.symbol} → {result}",
        )

    try:
        return await run_in_threadpool(_run)
    except Exception as exc:
        logger.exception("Order placement failed")
        return SimpleOrderResponse(success=False, message=str(exc))


@router.post("/cancel_order")
async def cancel_order(order_id: str):
    """Cancel an open order by display order_id.

    Looks up the global id from open orders since Tiger SDK cancel_order
    requires the global id, not the local order_id.
    """

    def _run():
        _, trade_client = _get_tiger_clients()
        try:
            # First try: find the global id by matching order_id in open orders
            open_orders = trade_client.get_open_orders(account=TIGER_ACCOUNT, sec_type="FUT")
            global_id = None
            for o in (open_orders or []):
                local = str(getattr(o, "order_id", "") or "")
                if local == order_id:
                    global_id = getattr(o, "id", None)
                    break

            cancel_id = int(global_id) if global_id else int(order_id)
            trade_client.cancel_order(id=cancel_id)
            return {"success": True, "message": f"Cancelled order {order_id}"}
        except Exception as exc:
            return {"success": False, "message": str(exc)}

    return await run_in_threadpool(_run)


@router.post("/close_position")
async def close_position(symbol: str = "MGC"):
    """Close all positions for a symbol by placing a market order in the opposite direction."""

    def _run():
        import re
        from tigeropen.common.util.order_utils import market_order

        _, trade_client = _get_tiger_clients()

        # Strip expiry digits (e.g. MGC2606 → MGC)
        base_symbol = re.sub(r"\d+$", "", symbol) or symbol

        # Get current position
        positions = trade_client.get_positions(account=TIGER_ACCOUNT, sec_type="FUT")
        total_qty = 0
        for p in (positions or []):
            if p.contract and p.contract.symbol and p.contract.symbol.startswith(base_symbol):
                total_qty += int(p.quantity)

        if total_qty == 0:
            return {"success": False, "message": "No open position to close"}

        # Determine close direction
        close_side = "SELL" if total_qty > 0 else "BUY"
        close_qty = abs(total_qty)

        contracts = trade_client.get_contracts(base_symbol, sec_type="FUT")
        if not contracts:
            return {"success": False, "message": f"No contract for {symbol}"}
        contract = contracts[0]
        contract.expiry = None

        order = market_order(
            account=TIGER_ACCOUNT, contract=contract,
            action=close_side, quantity=close_qty,
        )
        result = trade_client.place_order(order)
        return {
            "success": True,
            "order_id": str(result),
            "message": f"Closed {close_qty}x {symbol} ({close_side}) → {result}",
        }

    try:
        return await run_in_threadpool(_run)
    except Exception as exc:
        logger.exception("Close position failed")
        return {"success": False, "message": str(exc)}


# ── Cancel all open orders ──────────────────────────────────────────

@router.post("/cleanup_orders")
async def cleanup_orders():
    """Cancel ALL open orders for futures today.

    Fetches every open order and attempts to cancel each one.
    Orders that are already filled/cancelled/expired are skipped gracefully.
    """

    # Statuses that are definitely NOT cancellable — skip immediately
    _NOT_CANCELLABLE = {
        "FILLED", "CANCELLED", "CANCELED", "EXPIRED", "INACTIVE",
        "DEACTIVATED", "REJECTED",
        "filled", "cancelled", "canceled", "expired", "inactive",
        "deactivated", "rejected",
    }

    def _run():
        _, trade_client = _get_tiger_clients()

        # Get all open orders
        open_orders = trade_client.get_open_orders(account=TIGER_ACCOUNT, sec_type="FUT")
        cancelled = []
        skipped = []
        failed = []

        for o in (open_orders or []):
            # Tiger SDK: 'id' is the GLOBAL order id needed by cancel_order.
            # 'order_id' is only the local/display id.
            global_id = getattr(o, "id", None) or getattr(o, "order_id", None)
            display_id = str(getattr(o, "order_id", "") or global_id or "")
            sym = ""
            if hasattr(o, "contract") and o.contract and hasattr(o.contract, "symbol"):
                sym = o.contract.symbol or ""
            if not global_id:
                continue

            # Get order status
            status_raw = str(getattr(o, "status", "") or "")
            if "." in status_raw:
                status_raw = status_raw.rsplit(".", 1)[-1]

            # Skip orders that are clearly not cancellable
            if status_raw in _NOT_CANCELLABLE:
                skipped.append(display_id)
                logger.info("⏭️ Skip order %s — already %s", display_id, status_raw)
                continue

            # Attempt to cancel using GLOBAL id
            try:
                trade_client.cancel_order(id=int(global_id))
                cancelled.append(display_id)
                logger.info("🧹 Cancelled order %s / gid=%s (%s) [was %s]", display_id, global_id, sym, status_raw)
            except Exception as exc:
                err_msg = str(exc)
                logger.warning("⚠️ cancel_order(%s / gid=%s) error: %s", display_id, global_id, err_msg[:120])
                # If the error indicates it's already done, count as skipped
                if any(kw in err_msg.lower() for kw in
                       ["filled", "cancelled", "canceled", "inactive",
                        "invalid status", "expired", "not found", "cannot cancel",
                        "not exist", "does not exist"]):
                    skipped.append(display_id)
                else:
                    failed.append(display_id)

        msg_parts = []
        if cancelled:
            msg_parts.append(f"Cancelled {len(cancelled)} order(s)")
        if skipped:
            msg_parts.append(f"{len(skipped)} already done")
        if failed:
            msg_parts.append(f"{len(failed)} failed")
        if not cancelled and not skipped and not failed:
            msg_parts.append("No open orders")

        return {
            "success": len(failed) == 0,
            "cancelled": cancelled,
            "message": ". ".join(msg_parts),
        }

    try:
        return await run_in_threadpool(_run)
    except Exception as exc:
        logger.exception("Cleanup failed")
        return {"success": False, "cancelled": [], "message": str(exc)}


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

        symbol = req.symbols[0] if req.symbols else "MGC"
        identifier = symbol
        use_tiger = False

        # ── 1. Fetch real-time data (Tiger first, yfinance fallback)
        if _tiger_quote_ok:
            try:
                quote_client, trade_client = _get_tiger_clients()
                contracts = trade_client.get_contracts(symbol, sec_type="FUT")
                if not contracts:
                    raise ValueError(f"No contract found for {symbol}")
                identifier = contracts[0].identifier

                period = _BAR_PERIOD_MAP.get(req.interval, _BAR_PERIOD_MAP.get("5m"))
                df_raw = quote_client.get_future_bars(identifier, period=period, limit=500)
                if df_raw is not None and not df_raw.empty:
                    times_ms = df_raw["time"].tolist()
                    df = df_raw[["open", "high", "low", "close", "volume"]].copy()
                    df.index = pd.to_datetime(df_raw["time"], unit="ms")
                    df = df.sort_index()
                    df["_time_ms"] = sorted(times_ms)
                    use_tiger = True
            except Exception:
                logger.warning("Tiger API unavailable for scan_trade, falling back to yfinance")

        if not use_tiger:
            yf_symbol = "MGC=F"
            yf_period = "7d" if req.interval == "1m" else "60d"
            df = load_yfinance(symbol=yf_symbol, interval=req.interval, period=yf_period)
            if df is None or df.empty:
                raise ValueError(f"No data from yfinance for {yf_symbol}")
            df["_time_ms"] = [int(ts.timestamp() * 1000) for ts in df.index]

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
        timestamp=datetime.now(SGT).strftime("%d/%m/%Y %H:%M:%S SGT"),
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
    mkt_structure: int = 0  # 1=BULL, -1=BEAR, 0=SIDEWAYS
    sl: float = 0.0  # Stop-loss price
    tp: float = 0.0  # Take-profit price


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
    daily_pnl: list[dict] = []
    params: dict
    open_position: Optional[dict] = None  # current open position from backtest (not yet TP/SL)
    timestamp: str


@router.get("/backtest_5min")
async def mgc_backtest_5min(
    symbol: Annotated[str, Query()] = "MGC=F",
    period: Annotated[str, Query()] = "60d",
    capital: Annotated[float, Query()] = INITIAL_CAPITAL,
    oos_split: Annotated[float, Query(ge=0, le=0.5)] = 0.3,
    atr_sl_mult: Annotated[float, Query(ge=0.5, le=10.0)] = 4.0,
    atr_tp_mult: Annotated[float, Query(ge=0.5, le=10.0)] = 3.0,
    date_from: Annotated[Optional[str], Query()] = None,
    date_to: Annotated[Optional[str], Query()] = None,
    disabled_conditions: Annotated[Optional[str], Query()] = None,
    skip_flat: Annotated[bool, Query()] = False,
    skip_counter_trend: Annotated[bool, Query()] = True,
    use_ema_exit: Annotated[bool, Query()] = False,
    use_structure_exit: Annotated[bool, Query()] = False,
) -> MGC5MinBacktestResponse:
    """Run 5-minute strategy backtest with out-of-sample validation.

    Optional date_from / date_to to slice data (format: YYYY-MM-DD).
    disabled_conditions: comma-separated condition keys to skip (e.g. "volume_spike,adx_ok").
    """
    # Parse disabled conditions from comma-separated string
    _disabled: set[str] = set()
    if disabled_conditions:
        _valid = {"ema_trend","ema_slope","pullback","breakout","supertrend",
                  "macd_momentum","rsi_momentum","volume_spike","atr_range","session_ok","adx_ok",
                  "smc_ob","smc_fvg","smc_bos"}
        _disabled = {c.strip() for c in disabled_conditions.split(",") if c.strip() in _valid}

    def _run():
        import pandas as _pd
        from mgc_trading.backtest_5min import Backtester5Min
        from mgc_trading.strategy_5min import MGCStrategy5Min, DEFAULT_5MIN_PARAMS

        # Always load 60d so indicators are fully warmed up
        # (EMA, RSI, MACD, Supertrend need history to stabilize)
        df = load_yfinance(symbol=symbol, interval="5m", period="60d")

        if df.empty or len(df) < 20:
            raise ValueError("Not enough 5m data from yfinance.")

        # Also apply date_to filter on the raw data
        if date_to:
            trade_end = _pd.Timestamp(date_to, tz=df.index.tz) + _pd.Timedelta(days=1)
            df = df[df.index < trade_end]

        # ── Run full 60d simulation for consistent results ──────
        custom_params = {"atr_sl_mult": atr_sl_mult, "atr_tp_mult": atr_tp_mult, "use_ema_exit": use_ema_exit, "use_structure_exit": use_structure_exit}
        bt = Backtester5Min(capital=capital)
        result = bt.run(df, params=custom_params, oos_split=oos_split, disabled_conditions=_disabled or None, skip_flat=skip_flat, skip_counter_trend=skip_counter_trend)

        # ── Determine display window ────────────────────────────
        display_start: str | None = None
        if date_from:
            display_start = date_from
        elif period != "60d":
            _period_days = {"1d": 1, "2d": 2, "3d": 3, "5d": 5, "7d": 7, "30d": 30}
            days_back = _period_days.get(period, 60)
            if days_back < 60:
                last_date = df.index[-1]
                cutoff = last_date - _pd.Timedelta(days=days_back)
                display_start = cutoff.strftime("%Y-%m-%d")

        # ── Filter trades to display window ─────────────────────
        filtered_trades = result.trades
        if display_start:
            filtered_trades = [
                t for t in result.trades
                if str(t.exit_time)[:10] >= display_start
            ]

        # ── Filter daily_pnl to display window ─────────────────
        filtered_daily = result.daily_pnl
        if display_start:
            filtered_daily = [d for d in result.daily_pnl if d["date"] >= display_start]

        # ── Recompute metrics for the display window ────────────
        display_wins = [t for t in filtered_trades if t.pnl > 0]
        display_losses = [t for t in filtered_trades if t.pnl <= 0]
        n_trades = len(filtered_trades)
        display_total_pnl = sum(t.pnl for t in filtered_trades)

        metrics = MGC5MinMetrics(
            initial_capital=result.initial_capital,
            final_equity=round(result.initial_capital + display_total_pnl, 2),
            total_return_pct=round(display_total_pnl / result.initial_capital * 100, 2) if result.initial_capital else 0,
            max_drawdown_pct=result.max_drawdown_pct,
            sharpe_ratio=result.sharpe_ratio,
            total_trades=n_trades,
            winners=len(display_wins),
            losers=len(display_losses),
            win_rate=round(len(display_wins) / n_trades * 100, 1) if n_trades else 0,
            avg_win=round(sum(t.pnl for t in display_wins) / len(display_wins), 2) if display_wins else 0,
            avg_loss=round(sum(t.pnl for t in display_losses) / len(display_losses), 2) if display_losses else 0,
            profit_factor=round(
                abs(sum(t.pnl for t in display_wins) / sum(t.pnl for t in display_losses)), 2
            ) if display_losses and sum(t.pnl for t in display_losses) != 0 else 999.0,
            risk_reward_ratio=result.risk_reward_ratio,
            oos_win_rate=result.oos_win_rate,
            oos_total_trades=result.oos_total_trades,
            oos_return_pct=result.oos_return_pct,
        )

        # ── Build candle list (display window only) ─────────────
        strategy = MGCStrategy5Min({**DEFAULT_5MIN_PARAMS, **custom_params})
        df_ind = strategy.compute_indicators(
            df[["open", "high", "low", "close", "volume"]].copy()
        )
        signals = strategy.generate_signals(df_ind)
        if display_start:
            ts = _pd.Timestamp(display_start, tz=df_ind.index.tz)
            df_ind = df_ind[df_ind.index >= ts]
            signals = signals[df_ind.index]
        df_ind["signal"] = signals

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
                mkt_structure=getattr(t, "mkt_structure", 0),
                sl=round(getattr(t, "sl", 0.0), 2),
                tp=round(getattr(t, "tp", 0.0), 2),
            )
            for t in filtered_trades
        ]

        return candles, trades, result.equity_curve, metrics, result.params, filtered_daily

    try:
        candles, trades, eq_curve, metrics, params, daily_pnl = await run_in_threadpool(_run)
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as exc:
        logger.exception("5min backtest failed")
        raise HTTPException(status_code=500, detail=str(exc))

    # Check if backtest currently has an open position
    open_pos = None
    try:
        def _get_open_pos():
            from mgc_trading.backtest_5min import Backtester5Min
            df = load_yfinance(symbol=symbol, interval="5m", period="60d")
            bt = Backtester5Min()
            _disabled_set = set()
            if disabled_conditions:
                _disabled_set = {c.strip() for c in disabled_conditions.split(",") if c.strip()}
            return bt.get_live_position(df, params={"atr_sl_mult": atr_sl_mult, "atr_tp_mult": atr_tp_mult}, disabled_conditions=_disabled_set or None)
        open_pos = await run_in_threadpool(_get_open_pos)
    except Exception:
        pass

    # If last trade is EOD at data end and backtest still has open position → mark as OPEN
    if open_pos and trades:
        last_t = trades[-1]
        if last_t.reason == "EOD" and round(last_t.entry_price, 2) == open_pos["entry_price"]:
            trades[-1] = MGC5MinTrade(
                entry_time=last_t.entry_time,
                exit_time=last_t.exit_time,
                entry_price=last_t.entry_price,
                exit_price=last_t.exit_price,
                qty=last_t.qty,
                pnl=last_t.pnl,
                pnl_pct=last_t.pnl_pct,
                reason="OPEN",
                signal_type=last_t.signal_type,
                direction=last_t.direction,
                mae=last_t.mae,
                mkt_structure=last_t.mkt_structure,
                sl=round(open_pos["sl"], 2),
                tp=round(open_pos["tp"], 2),
            )

    return MGC5MinBacktestResponse(
        symbol=symbol,
        interval="5m",
        period=period,
        candles=candles,
        trades=trades,
        equity_curve=eq_curve,
        metrics=metrics,
        daily_pnl=daily_pnl,
        params=params,
        open_position=open_pos,
        timestamp=datetime.now(SGT).strftime("%d/%m/%Y %H:%M SGT"),
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
    is_fresh: bool = True
    bars_since_first: int = 0


class Scan5MinConditions(BaseModel):
    """Per-condition status for the last completed 5m bar."""
    ema_trend: bool = False
    ema_slope: bool = False
    pullback: bool = False
    breakout: bool = False
    supertrend: bool = False
    macd_momentum: bool = False
    rsi_momentum: bool = False
    volume_spike: bool = False
    atr_range: bool = False
    session_ok: bool = False
    adx_ok: bool = False
    htf_15m_trend: bool = False
    htf_15m_supertrend: bool = False
    htf_1h_trend: bool = False
    htf_1h_supertrend: bool = False
    mkt_structure: int = 0  # 1=BULL(HH+HL), -1=BEAR(LH+LL), 0=SIDEWAYS


class Scan5MinResponse(BaseModel):
    opportunity: bool
    signal: Scan5MinSignal
    signals: list[Scan5MinSignal] = []
    candles: list[dict] = []
    conditions: Optional[Scan5MinConditions] = None
    bias: str = "NEUTRAL"
    conditions_met: int = 0
    conditions_total: int = 8
    timestamp: str


@router.get("/scan_5min")
async def mgc_scan_5min(
    symbol: Annotated[str, Query()] = "MGC=F",
    period: Annotated[str, Query()] = "60d",
    atr_sl_mult: Annotated[float, Query(ge=0.5, le=10.0)] = 4.0,
    atr_tp_mult: Annotated[float, Query(ge=0.5, le=10.0)] = 3.0,
    disabled_conditions: Annotated[Optional[str], Query()] = None,
) -> Scan5MinResponse:
    """Scan for 5-minute entry signal using yfinance data."""
    # Parse disabled conditions
    _disabled: set[str] | None = None
    if disabled_conditions:
        _valid = {"ema_trend","ema_slope","pullback","breakout","supertrend",
                  "macd_momentum","rsi_momentum","volume_spike","atr_range","session_ok","adx_ok",
                  "smc_ob","smc_fvg","smc_bos"}
        _disabled = {c.strip() for c in disabled_conditions.split(",") if c.strip() in _valid} or None

    def _run():
        from mgc_trading.scanner_5min import scan_5min, scan_5min_all, scan_5min_mtf

        effective_period = period
        if period not in ("1d", "2d", "5d", "7d", "30d", "60d"):
            effective_period = "60d"

        df_5m = load_yfinance(symbol=symbol, interval="5m", period=effective_period)
        custom_params = {"atr_sl_mult": atr_sl_mult, "atr_tp_mult": atr_tp_mult}

        # Load higher timeframes for MTF confirmation
        df_15m = None
        df_1h = None
        try:
            df_15m = load_yfinance(symbol=symbol, interval="15m", period="60d")
        except Exception:
            pass
        try:
            df_1h = load_yfinance(symbol=symbol, interval="1h", period="60d")
        except Exception:
            pass

        # MTF scan (includes per-condition status)
        mtf_result = scan_5min_mtf(df_5m, df_15m, df_1h, params=custom_params, disabled=_disabled)
        result = mtf_result.scan

        # All recent signals (last 10 completed bars) — respect disabled conditions
        all_results = scan_5min_all(df_5m, params=custom_params, lookback=10, disabled=_disabled)

        # Last 30 candles for mini chart
        tail = df_5m.tail(30)
        candles_out = []
        for idx, row in tail.iterrows():
            t = str(idx)
            candles_out.append({
                "time": t[:16] if len(t) > 16 else t,
                "open": round(float(row.get("Open", row.get("open", 0))), 2),
                "high": round(float(row.get("High", row.get("high", 0))), 2),
                "low": round(float(row.get("Low", row.get("low", 0))), 2),
                "close": round(float(row.get("Close", row.get("close", 0))), 2),
                "volume": int(row.get("Volume", row.get("volume", 0))),
            })

        def _to_sig(r):
            return Scan5MinSignal(
                found=r.found, direction=r.direction, signal_type=r.signal_type,
                entry_price=r.entry_price, stop_loss=r.stop_loss, take_profit=r.take_profit,
                risk_reward=r.risk_reward, strength=r.strength, strength_detail=r.strength_detail,
                rsi=r.rsi, atr=r.atr, ema_fast=r.ema_fast, ema_slow=r.ema_slow,
                macd_hist=r.macd_hist, supertrend_dir=r.supertrend_dir,
                volume_ratio=r.volume_ratio, bar_time=r.bar_time,
                is_fresh=getattr(r, 'is_fresh', True),
                bars_since_first=getattr(r, 'bars_since_first', 0),
            )

        sig = _to_sig(result)
        all_sigs = [_to_sig(r) for r in all_results]

        # Build conditions model
        c = mtf_result.conditions
        cond_model = Scan5MinConditions(
            ema_trend=c.ema_trend, ema_slope=c.ema_slope,
            pullback=c.pullback, breakout=c.breakout,
            supertrend=c.supertrend, macd_momentum=c.macd_momentum,
            rsi_momentum=c.rsi_momentum, volume_spike=c.volume_spike,
            atr_range=c.atr_range, session_ok=c.session_ok, adx_ok=c.adx_ok,
            htf_15m_trend=c.htf_15m_trend, htf_15m_supertrend=c.htf_15m_supertrend,
            htf_1h_trend=c.htf_1h_trend, htf_1h_supertrend=c.htf_1h_supertrend,
            mkt_structure=c.mkt_structure,
        )
        return (result.found, sig, all_sigs, candles_out, cond_model,
                mtf_result.bias, mtf_result.conditions_met, mtf_result.conditions_total)

    found, sig, all_sigs, candles_out, cond_model, bias, met, total = await run_in_threadpool(_run)

    return Scan5MinResponse(
        opportunity=found,
        signal=sig,
        signals=all_sigs,
        candles=candles_out,
        conditions=cond_model,
        bias=bias,
        conditions_met=met,
        conditions_total=total,
        timestamp=datetime.now(SGT).strftime("%d/%m/%Y %H:%M:%S SGT"),
    )


# ── 5min Live Scan (Tiger API) ──────────────────────────────────────

@router.get("/scan_5min_live")
async def mgc_scan_5min_live(
    atr_sl_mult: Annotated[float, Query(ge=0.5, le=10.0)] = 4.0,
    atr_tp_mult: Annotated[float, Query(ge=0.5, le=10.0)] = 3.0,
    disabled_conditions: Annotated[Optional[str], Query()] = None,
) -> Scan5MinResponse:
    """Scan for 5-minute entry signal using Tiger live data."""
    _disabled: set[str] | None = None
    if disabled_conditions:
        _valid = {"ema_trend","ema_slope","pullback","breakout","supertrend",
                  "macd_momentum","rsi_momentum","volume_spike","atr_range","session_ok","adx_ok",
                  "smc_ob","smc_fvg","smc_bos"}
        _disabled = {c.strip() for c in disabled_conditions.split(",") if c.strip() in _valid} or None

    def _run():
        import pandas as pd
        from mgc_trading.scanner_5min import scan_5min, scan_5min_all, scan_5min_mtf

        if not _tiger_quote_ok:
            raise ValueError("Tiger SDK not available")

        quote_client, trade_client = _get_tiger_clients()
        contracts = trade_client.get_contracts("MGC", sec_type="FUT")
        if not contracts:
            raise ValueError("No MGC contract found")
        identifier = contracts[0].identifier
        custom_params = {"atr_sl_mult": atr_sl_mult, "atr_tp_mult": atr_tp_mult}

        # Load 5m bars
        period_5m = _BAR_PERIOD_MAP.get("5m")
        df_raw = quote_client.get_future_bars(identifier, period=period_5m, limit=500)
        if df_raw is None or df_raw.empty:
            raise ValueError("No data from Tiger API")
        df_5m = df_raw[["open", "high", "low", "close", "volume"]].copy()
        df_5m.index = pd.to_datetime(df_raw["time"], unit="ms")
        df_5m = df_5m.sort_index()

        # Load 15m and 1h bars for MTF
        df_15m = None
        df_1h = None
        try:
            period_15m = _BAR_PERIOD_MAP.get("15m")
            if period_15m:
                raw_15 = quote_client.get_future_bars(identifier, period=period_15m, limit=500)
                if raw_15 is not None and not raw_15.empty:
                    df_15m = raw_15[["open", "high", "low", "close", "volume"]].copy()
                    df_15m.index = pd.to_datetime(raw_15["time"], unit="ms")
                    df_15m = df_15m.sort_index()
        except Exception:
            pass
        try:
            period_1h = _BAR_PERIOD_MAP.get("1h")
            if period_1h:
                raw_1h = quote_client.get_future_bars(identifier, period=period_1h, limit=500)
                if raw_1h is not None and not raw_1h.empty:
                    df_1h = raw_1h[["open", "high", "low", "close", "volume"]].copy()
                    df_1h.index = pd.to_datetime(raw_1h["time"], unit="ms")
                    df_1h = df_1h.sort_index()
        except Exception:
            pass

        # MTF scan
        mtf_result = scan_5min_mtf(df_5m, df_15m, df_1h, params=custom_params, disabled=_disabled)
        result = mtf_result.scan

        # All recent signals
        all_results = scan_5min_all(df_5m, params=custom_params, lookback=10, disabled=_disabled)

        def _to_sig(r):
            return Scan5MinSignal(
                found=r.found, direction=r.direction, signal_type=r.signal_type,
                entry_price=r.entry_price, stop_loss=r.stop_loss, take_profit=r.take_profit,
                risk_reward=r.risk_reward, strength=r.strength, strength_detail=r.strength_detail,
                rsi=r.rsi, atr=r.atr, ema_fast=r.ema_fast, ema_slow=r.ema_slow,
                macd_hist=r.macd_hist, supertrend_dir=r.supertrend_dir,
                volume_ratio=r.volume_ratio, bar_time=r.bar_time,
                is_fresh=getattr(r, 'is_fresh', True),
                bars_since_first=getattr(r, 'bars_since_first', 0),
            )

        sig = _to_sig(result)
        all_sigs = [_to_sig(r) for r in all_results]

        # Last 30 candles for mini chart
        tail = df_5m.tail(30)
        candles_out = []
        for i_row, row in tail.iterrows():
            t = str(i_row)
            candles_out.append({
                "time": t[:16] if len(t) > 16 else t,
                "open": round(float(row["open"]), 2),
                "high": round(float(row["high"]), 2),
                "low": round(float(row["low"]), 2),
                "close": round(float(row["close"]), 2),
                "volume": int(row["volume"]),
            })

        c = mtf_result.conditions
        cond_model = Scan5MinConditions(
            ema_trend=c.ema_trend, ema_slope=c.ema_slope,
            pullback=c.pullback, breakout=c.breakout,
            supertrend=c.supertrend, macd_momentum=c.macd_momentum,
            rsi_momentum=c.rsi_momentum, volume_spike=c.volume_spike,
            atr_range=c.atr_range, session_ok=c.session_ok, adx_ok=c.adx_ok,
            htf_15m_trend=c.htf_15m_trend, htf_15m_supertrend=c.htf_15m_supertrend,
            htf_1h_trend=c.htf_1h_trend, htf_1h_supertrend=c.htf_1h_supertrend,
            mkt_structure=c.mkt_structure,
        )
        return (result.found, sig, all_sigs, candles_out, cond_model,
                mtf_result.bias, mtf_result.conditions_met, mtf_result.conditions_total)

    found, sig, all_sigs, candles_out, cond_model, bias, met, total = await run_in_threadpool(_run)

    return Scan5MinResponse(
        opportunity=found,
        signal=sig,
        signals=all_sigs,
        candles=candles_out,
        conditions=cond_model,
        bias=bias,
        conditions_met=met,
        conditions_total=total,
        timestamp=datetime.now(SGT).strftime("%d/%m/%Y %H:%M:%S SGT"),
    )


# ── 5min Execute (Tiger Bracket Order) ──────────────────────────────

class Execute5MinRequest(BaseModel):
    """Request body for /execute_5min endpoint."""
    symbol: str = "MGC"            # commodity key (MGC, BZ, NG, SI, CL, HG)
    qty: int = 1
    max_qty: int = 5
    direction: str = "CALL"       # "CALL" or "PUT"
    entry_price: float = 0.0
    stop_loss: float = 0.0
    take_profit: float = 0.0
    bar_time: str = ""            # signal bar timestamp for dedup + parity
    allow_scale_in: bool = False  # permit adding to existing position during retracement
    current_price: float = 0.0    # live price for retracement check


class Execute5MinResponse(BaseModel):
    """Response from /execute_5min endpoint."""
    execution: Optional[ExecutionResult] = None
    position: dict = {}            # current_qty, max_qty, blocked
    engine_state: dict = {}        # execution engine state snapshot
    execution_record: dict = {}    # standardised execution output
    timestamp: str = ""


@router.post("/execute_5min")
async def mgc_execute_5min(req: Execute5MinRequest) -> Execute5MinResponse:
    """Execute a 5-minute strategy trade on Tiger account.

    Places a bracket order (entry MKT + OCA SL/TP) for the given direction.
    Uses ExecutionEngine state machine for validation + fail-safe.
    """
    def _run():
        from mgc_trading.tiger_execution import TigerTrader
        from mgc_trading.execution_engine import get_engine

        engine = get_engine(req.symbol)

        # Resolve commodity metadata
        commodity = _COMMODITY_SYMBOLS.get(req.symbol, _COMMODITY_SYMBOLS["MGC"])
        tiger_sym = commodity["tiger"]
        tick_size = commodity["tick"]

        side = "BUY" if req.direction == "CALL" else "SELL"

        # Position check (Tiger)
        current_pos = _get_tiger_position(tiger_sym)
        position_info = {
            "current_qty": current_pos,
            "max_qty": req.max_qty,
            "trade_qty": req.qty,
            "blocked": current_pos >= req.max_qty,
        }

        # Sync engine with broker state (detect closed positions)
        engine.sync_with_broker(current_pos)

        # ── Engine pre-validation gates ─────────────────────────────
        rejection = engine.validate_entry(
            direction=req.direction,
            entry_price=req.entry_price,
            sl_price=req.stop_loss,
            tp_price=req.take_profit,
            bar_time=req.bar_time,
            qty=req.qty,
            max_qty=req.max_qty,
            current_tiger_qty=current_pos,
            allow_scale_in=req.allow_scale_in,
            current_price=req.current_price,
        )
        if rejection is not None:
            exec_result = ExecutionResult(
                executed=False,
                order_id="",
                side=side,
                qty=req.qty,
                status="REJECTED",
                reason=rejection.reason,
            )
            return exec_result, position_info, rejection.to_dict(), engine.get_state_summary()

        # Round SL/TP to commodity tick size
        sl_price = round(round(req.stop_loss / tick_size) * tick_size, 6)
        tp_price = round(round(req.take_profit / tick_size) * tick_size, 6)

        try:
            trader = TigerTrader()
            trader.connect()
        except Exception as exc:
            logger.exception("TigerTrader connect failed")
            rec = engine.record_entry(
                req.direction, req.entry_price, sl_price, tp_price,
                req.qty, req.bar_time, "", sl_confirmed=False, tp_confirmed=False,
            )
            exec_result = ExecutionResult(
                executed=False, order_id="", side=side, qty=req.qty,
                status="CONNECT_FAILED",
                reason=f"Tiger connection failed: {exc}",
            )
            return exec_result, position_info, rec.to_dict(), engine.get_state_summary()

        try:
            bracket = trader.place_bracket_order(
                symbol=tiger_sym,
                qty=req.qty,
                side=side,
                stop_loss_price=sl_price,
                take_profit_price=tp_price,
            )
        except Exception as exc:
            logger.exception("Bracket order placement failed")
            rec = engine.record_entry(
                req.direction, req.entry_price, sl_price, tp_price,
                req.qty, req.bar_time, "", sl_confirmed=False, tp_confirmed=False,
            )
            exec_result = ExecutionResult(
                executed=False, order_id="", side=side, qty=req.qty,
                status="ORDER_ERROR",
                reason=f"Order error: {exc}",
            )
            return exec_result, position_info, rec.to_dict(), engine.get_state_summary()

        if bracket.entry and bracket.entry.status != "FAILED":
            # ── FAIL-SAFE: Verify SL + TP were placed ──────────────
            sl_ok = bracket.stop_loss is not None and bracket.stop_loss.status != "FAILED"
            tp_ok = bracket.take_profit is not None and bracket.take_profit.status != "FAILED"

            # Record in engine (will reject if OCO not confirmed)
            rec = engine.record_entry(
                direction=req.direction,
                entry_price=req.entry_price,
                sl_price=sl_price,
                tp_price=tp_price,
                qty=req.qty,
                bar_time=req.bar_time,
                order_id=bracket.entry.order_id,
                sl_confirmed=sl_ok,
                tp_confirmed=tp_ok,
            )

            if rec.status == "REJECTED":
                # OCO failed — must cancel entry order
                logger.error(
                    "FAIL-SAFE TRIGGERED: SL=%s TP=%s — cancelling entry %s",
                    sl_ok, tp_ok, bracket.entry.order_id,
                )
                exec_result = ExecutionResult(
                    executed=False,
                    order_id=bracket.entry.order_id,
                    side=side,
                    qty=req.qty,
                    status="CANCELLED_FAILSAFE",
                    reason=f"OCO not confirmed (SL={sl_ok}, TP={tp_ok}) — entry cancelled",
                )
            else:
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
            entry_status = bracket.entry.status if bracket.entry else "NO_ENTRY"
            rec = engine.record_entry(
                req.direction, req.entry_price, sl_price, tp_price,
                req.qty, req.bar_time, "", sl_confirmed=False, tp_confirmed=False,
            )
            exec_result = ExecutionResult(
                executed=False,
                order_id="",
                side=side,
                qty=req.qty,
                status="FAILED",
                reason=f"Tiger order failed ({entry_status}) — check risk gates or market hours",
            )
        return exec_result, position_info, rec.to_dict(), engine.get_state_summary()

    try:
        exec_result, position_info, exec_record, engine_state = await run_in_threadpool(_run)
    except Exception as exc:
        logger.exception("execute_5min unexpected error")
        exec_result = ExecutionResult(
            executed=False, order_id="", side="BUY", qty=req.qty,
            status="ERROR", reason=f"Unexpected error: {exc}",
        )
        position_info = {"current_qty": 0, "max_qty": req.max_qty, "trade_qty": req.qty, "blocked": False}
        exec_record = {"signal": "BUY", "entry_price": 0, "tp_price": 0, "sl_price": 0, "status": "REJECTED", "reason": str(exc)}
        engine_state = {}

    return Execute5MinResponse(
        execution=exec_result,
        position=position_info,
        engine_state=engine_state,
        execution_record=exec_record,
        timestamp=datetime.now(SGT).strftime("%d/%m/%Y %H:%M:%S SGT"),
    )


# ── Backtest Live Position (sync auto-trade with backtest) ──────────

@router.get("/backtest_position")
async def backtest_position(
    symbol: Annotated[str, Query()] = "MGC=F",
    period: Annotated[str, Query()] = "60d",
    atr_sl_mult: Annotated[float, Query()] = 3.0,
    atr_tp_mult: Annotated[float, Query()] = 2.5,
    disabled_conditions: Annotated[Optional[str], Query()] = None,
):
    """Run backtest to current bar and return open position (if any).

    Used by auto-trading to sync: if backtest is currently in a position,
    live should enter immediately.
    """
    def _run():
        from mgc_trading.backtest_5min import Backtester5Min

        effective_period = period if period in ("1d", "2d", "5d", "7d", "30d", "60d") else "60d"
        df = load_yfinance(symbol=symbol, interval="5m", period=effective_period)

        params = {"atr_sl_mult": atr_sl_mult, "atr_tp_mult": atr_tp_mult}
        disabled = set(disabled_conditions.split(",")) if disabled_conditions else None

        bt = Backtester5Min()
        pos = bt.get_live_position(df, params=params, disabled_conditions=disabled)

        return {
            "in_position": pos is not None,
            "position": pos,
            "data_end": str(df.index[-1]) if len(df) > 0 else "",
            "bars": len(df),
        }

    result = await run_in_threadpool(_run)
    result["timestamp"] = datetime.now(SGT).strftime("%d/%m/%Y %H:%M:%S SGT")
    return result


# ── Execution Engine State & Control ────────────────────────────────

@router.get("/engine_state")
async def get_engine_state(symbol: str = "MGC"):
    """Return current execution engine state for a symbol."""
    from mgc_trading.execution_engine import get_engine
    engine = get_engine(symbol)
    tiger_qty = _get_tiger_position(symbol)
    engine.sync_with_broker(tiger_qty)
    return {
        **engine.get_state_summary(),
        "tiger_qty": tiger_qty,
        "symbol": symbol,
    }


@router.post("/engine_sync")
async def engine_sync(symbol: str = "MGC"):
    """Force-sync execution engine state with Tiger broker position."""
    from mgc_trading.execution_engine import get_engine
    engine = get_engine(symbol)
    tiger_qty = _get_tiger_position(symbol)
    engine.sync_with_broker(tiger_qty)
    return {
        "synced": True,
        **engine.get_state_summary(),
        "tiger_qty": tiger_qty,
    }


class EngineSeedRequest(BaseModel):
    direction: str  # "CALL" or "PUT"
    entry_price: float
    sl_price: float
    tp_price: float
    qty: int = 1
    bar_time: str = ""
    entry_time: str = ""


@router.post("/engine_seed")
async def engine_seed(req: EngineSeedRequest, symbol: str = "MGC"):
    """Seed engine with an existing position (Tiger already in position).

    Used when auto-trading starts and Tiger already holds a position
    that matches the backtest — seeds the engine so it tracks SL/TP exits.
    """
    from mgc_trading.execution_engine import get_engine
    engine = get_engine(symbol)
    engine.seed_position(
        direction=req.direction,
        entry_price=req.entry_price,
        sl_price=req.sl_price,
        tp_price=req.tp_price,
        qty=req.qty,
        bar_time=req.bar_time,
        entry_time=req.entry_time,
    )
    return {
        "seeded": True,
        **engine.get_state_summary(),
        "symbol": symbol,
    }


@router.post("/engine_reset")
async def engine_reset(symbol: str = "MGC"):
    """Emergency reset: clear all engine state for a symbol."""
    from mgc_trading.execution_engine import get_engine
    engine = get_engine(symbol)
    engine.force_reset()
    return {"reset": True, **engine.get_state_summary()}


@router.get("/engine_log")
async def get_engine_log(symbol: str = "MGC", limit: int = 50):
    """Return recent execution log entries."""
    from mgc_trading.execution_engine import get_engine
    engine = get_engine(symbol)
    entries = engine.execution_log[-limit:]
    return {
        "symbol": symbol,
        "total": len(engine.execution_log),
        "entries": [e.to_dict() for e in entries],
    }


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
        timestamp=datetime.now(SGT).strftime("%d/%m/%Y %H:%M SGT"),
    )


# ── Trade Log (last 50 from backtest) ───────────────────────────────

class TradeLog5MinResponse(BaseModel):
    trades: list[MGC5MinTrade]
    total: int
    win_rate: float
    total_pnl: float
    open_position: Optional[dict] = None
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

        # Check open position
        open_pos = bt.get_live_position(df)

        all_trades = result.trades

        # If last trade is EOD at data end and matches open position → mark as OPEN
        if open_pos and all_trades and all_trades[-1].reason == "EOD":
            last_t = all_trades[-1]
            if round(last_t.entry_price, 2) == open_pos["entry_price"]:
                from mgc_trading.backtest_5min import Trade5Min
                all_trades[-1] = Trade5Min(
                    entry_time=last_t.entry_time,
                    exit_time=last_t.exit_time,
                    entry_price=last_t.entry_price,
                    exit_price=last_t.exit_price,
                    qty=last_t.qty,
                    pnl=last_t.pnl,
                    pnl_pct=last_t.pnl_pct,
                    reason="OPEN",
                    signal_type=last_t.signal_type,
                    direction=last_t.direction,
                    mae=last_t.mae,
                    mkt_structure=getattr(last_t, "mkt_structure", 0),
                    sl=round(open_pos["sl"], 2),
                    tp=round(open_pos["tp"], 2),
                )

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
                mkt_structure=getattr(t, "mkt_structure", 0),
                sl=round(getattr(t, "sl", 0.0), 2),
                tp=round(getattr(t, "tp", 0.0), 2),
            )
            for t in recent
        ]

        total_pnl = sum(t.pnl for t in recent)
        wins = sum(1 for t in recent if t.pnl > 0)
        wr = wins / len(recent) * 100 if recent else 0

        return trade_list, len(all_trades), round(wr, 1), round(total_pnl, 2), open_pos

    trades, total, wr, pnl, open_pos = await run_in_threadpool(_run)

    return TradeLog5MinResponse(
        trades=trades,
        total=total,
        win_rate=wr,
        total_pnl=pnl,
        open_position=open_pos,
        timestamp=datetime.now(SGT).strftime("%d/%m/%Y %H:%M:%S SGT"),
    )


# ═══════════════════════════════════════════════════════════════════════
# 5-Minute Condition Preferences (persisted in SQLite)
# ═══════════════════════════════════════════════════════════════════════

# Valid 5min condition keys
_VALID_5MIN_CONDITIONS = {
    "ema_trend", "ema_slope", "pullback", "breakout", "supertrend",
    "macd_momentum", "rsi_momentum", "volume_spike", "atr_range",
    "session_ok", "adx_ok",
    "htf_15m_trend", "htf_15m_supertrend", "htf_1h_trend", "htf_1h_supertrend",
}


class ConditionTogglesPayload(BaseModel):
    toggles: dict[str, bool]


class ConditionPresetItem(BaseModel):
    name: str
    toggles: dict[str, bool]
    created_at: str


class SaveConditionPresetPayload(BaseModel):
    name: str
    toggles: dict[str, bool]


@router.get("/condition_toggles")
def get_5min_condition_toggles(
    symbol: str = Query("MGC"),
) -> dict[str, bool]:
    """Return saved condition toggles for 5min strategy. Returns empty dict if none saved."""
    from sqlalchemy import text
    from app.db.database import engine

    db_key = f"{symbol.upper()}_5MIN"
    with engine.connect() as conn:
        rows = conn.execute(
            text("SELECT name, checked FROM condition_preferences WHERE symbol = :sym"),
            {"sym": db_key},
        ).fetchall()
    return {r[0]: bool(r[1]) for r in rows if r[0] in _VALID_5MIN_CONDITIONS}


@router.post("/condition_toggles")
def save_5min_condition_toggles(
    payload: ConditionTogglesPayload,
    symbol: str = Query("MGC"),
) -> dict[str, str]:
    """Save condition toggles for 5min strategy."""
    from sqlalchemy import text
    from app.db.database import engine

    db_key = f"{symbol.upper()}_5MIN"
    with engine.begin() as conn:
        # Delete old rows for this symbol
        conn.execute(
            text("DELETE FROM condition_preferences WHERE symbol = :sym"),
            {"sym": db_key},
        )
        # Insert new rows
        for name, checked in payload.toggles.items():
            if name in _VALID_5MIN_CONDITIONS:
                conn.execute(
                    text("INSERT INTO condition_preferences (symbol, name, checked) VALUES (:sym, :name, :checked)"),
                    {"sym": db_key, "name": name, "checked": checked},
                )
    return {"status": "ok"}


@router.post("/condition_presets")
def save_5min_condition_preset(
    payload: SaveConditionPresetPayload,
    symbol: str = Query("MGC"),
) -> dict[str, str]:
    """Save a condition preset for 5min strategy."""
    import json
    from sqlalchemy import text
    from app.db.database import engine

    db_key = f"{symbol.upper()}_5MIN"
    toggles_json = json.dumps(payload.toggles)
    
    with engine.begin() as conn:
        # Insert or replace the preset
        conn.execute(
            text("""
                INSERT INTO condition_presets (symbol, name, toggles, created_at) 
                VALUES (:sym, :name, :toggles, CURRENT_TIMESTAMP)
                ON CONFLICT (symbol, name) DO UPDATE SET
                    toggles = EXCLUDED.toggles,
                    created_at = CURRENT_TIMESTAMP
            """),
            {"sym": db_key, "name": payload.name, "toggles": toggles_json},
        )
    return {"status": "ok"}


@router.get("/condition_presets")
def get_5min_condition_presets(
    symbol: str = Query("MGC"),
) -> list[ConditionPresetItem]:
    """Return saved condition presets for 5min strategy."""
    import json
    from sqlalchemy import text
    from app.db.database import engine

    db_key = f"{symbol.upper()}_5MIN"
    with engine.connect() as conn:
        rows = conn.execute(
            text("SELECT name, toggles, created_at FROM condition_presets WHERE symbol = :sym ORDER BY created_at DESC"),
            {"sym": db_key},
        ).fetchall()
    
    presets = []
    for row in rows:
        try:
            toggles = json.loads(row[1])
            presets.append(ConditionPresetItem(
                name=row[0],
                toggles=toggles,
                created_at=row[2].isoformat() if hasattr(row[2], 'isoformat') else str(row[2])
            ))
        except (json.JSONDecodeError, TypeError):
            continue  # Skip invalid presets
    
    return presets


@router.delete("/condition_presets")
def delete_5min_condition_preset(
    name: str = Query(...),
    symbol: str = Query("MGC"),
) -> dict[str, str]:
    """Delete a condition preset for 5min strategy."""
    from sqlalchemy import text
    from app.db.database import engine

    db_key = f"{symbol.upper()}_5MIN"
    with engine.begin() as conn:
        conn.execute(
            text("DELETE FROM condition_presets WHERE symbol = :sym AND name = :name"),
            {"sym": db_key, "name": name},
        )
    return {"status": "ok"}


# ═══════════════════════════════════════════════════════════════════════
# Auto-Trade Settings (verify lock, qty — persisted in SQLite)
# ═══════════════════════════════════════════════════════════════════════

class AutoTradeSettingsPayload(BaseModel):
    verify_lock: bool = True
    auto_qty: int = 1


@router.get("/auto_trade_settings")
def get_auto_trade_settings(
    symbol: str = Query("MGC"),
) -> dict:
    """Return saved auto-trade settings for a symbol."""
    from sqlalchemy import text
    from app.db.database import engine

    sym = symbol.upper()
    with engine.connect() as conn:
        row = conn.execute(
            text("SELECT verify_lock, auto_qty FROM auto_trade_settings WHERE symbol = :sym"),
            {"sym": sym},
        ).fetchone()
    if row:
        return {"verify_lock": bool(row[0]), "auto_qty": int(row[1])}
    return {"verify_lock": True, "auto_qty": 1}  # defaults


@router.post("/auto_trade_settings")
def save_auto_trade_settings(
    payload: AutoTradeSettingsPayload,
    symbol: str = Query("MGC"),
) -> dict[str, str]:
    """Save auto-trade settings for a symbol."""
    from sqlalchemy import text
    from app.db.database import engine

    sym = symbol.upper()
    with engine.begin() as conn:
        conn.execute(
            text("""
                INSERT INTO auto_trade_settings (symbol, verify_lock, auto_qty, updated_at)
                VALUES (:sym, :vl, :aq, CURRENT_TIMESTAMP)
                ON CONFLICT (symbol) DO UPDATE SET
                    verify_lock = EXCLUDED.verify_lock,
                    auto_qty = EXCLUDED.auto_qty,
                    updated_at = CURRENT_TIMESTAMP
            """),
            {"sym": sym, "vl": payload.verify_lock, "aq": payload.auto_qty},
        )
    return {"status": "ok"}


# ── Strategy Config (persist period, SL/TP, risk filters) ────────────


class StrategyConfigPayload(BaseModel):
    period: str = "3d"
    sl_mult: float = 4.0
    tp_mult: float = 3.0
    risk_filters: dict[str, bool] = {}
    active_preset: str | None = None


@router.get("/strategy_config")
def get_strategy_config(symbol: str = Query("MGC")) -> dict:
    """Load persisted strategy config for a symbol."""
    import json
    from sqlalchemy import text
    from app.db.database import engine

    sym = f"{symbol.upper()}_5MIN"
    with engine.connect() as conn:
        row = conn.execute(
            text("SELECT config_json FROM strategy_configs WHERE symbol = :sym"),
            {"sym": sym},
        ).fetchone()
    if row:
        try:
            return json.loads(row[0])
        except Exception:
            pass
    return {}


@router.post("/strategy_config")
def save_strategy_config(
    payload: StrategyConfigPayload,
    symbol: str = Query("MGC"),
) -> dict[str, str]:
    """Save strategy config for a symbol."""
    import json
    from sqlalchemy import text
    from app.db.database import engine

    sym = f"{symbol.upper()}_5MIN"
    config = json.dumps({
        "period": payload.period,
        "sl_mult": payload.sl_mult,
        "tp_mult": payload.tp_mult,
        "risk_filters": payload.risk_filters,
        "active_preset": payload.active_preset,
    })
    with engine.begin() as conn:
        conn.execute(
            text("""
                INSERT INTO strategy_configs (symbol, config_json, updated_at)
                VALUES (:sym, :cfg, CURRENT_TIMESTAMP)
                ON CONFLICT (symbol) DO UPDATE SET
                    config_json = EXCLUDED.config_json,
                    updated_at = CURRENT_TIMESTAMP
            """),
            {"sym": sym, "cfg": config},
        )
    return {"status": "ok"}


@router.get("/optimize_conditions_5min")
async def optimize_5min_conditions(
    symbol: Annotated[str, Query()] = "MGC=F",
    period: Annotated[str, Query()] = "60d",
    top_n: Annotated[int, Query(ge=1, le=10)] = 5,
    atr_sl_mult: Annotated[float, Query(ge=0.5, le=10.0)] = 4.0,
    atr_tp_mult: Annotated[float, Query(ge=0.5, le=10.0)] = 3.0,
    skip_flat: Annotated[bool, Query()] = False,
    skip_counter_trend: Annotated[bool, Query()] = True,
    use_ema_exit: Annotated[bool, Query()] = False,
    use_structure_exit: Annotated[bool, Query()] = False,
) -> list[dict]:
    """Optimize 5-minute condition combinations using current risk filters and SL/TP."""
    
    def _run():
        import pandas as _pd
        from mgc_trading.backtest_5min import Backtester5Min
        from mgc_trading.strategy_5min import DEFAULT_5MIN_PARAMS
        from itertools import combinations

        # Load 5m data
        df = load_yfinance(symbol=symbol, interval="5m", period="60d")
        if df.empty or len(df) < 20:
            raise ValueError("Not enough 5m data from yfinance.")

        # Determine display window (same logic as backtest_5min endpoint)
        display_start: str | None = None
        if period != "60d":
            _period_days = {"1d": 1, "2d": 2, "3d": 3, "5d": 5, "7d": 7, "30d": 30}
            days_back = _period_days.get(period, 60)
            if days_back < 60:
                last_date = df.index[-1]
                cutoff = last_date - _pd.Timedelta(days=days_back)
                display_start = cutoff.strftime("%Y-%m-%d")

        # Build params matching the user's current settings
        custom_params = {
            "atr_sl_mult": atr_sl_mult,
            "atr_tp_mult": atr_tp_mult,
            "use_ema_exit": use_ema_exit,
            "use_structure_exit": use_structure_exit,
        }

        condition_keys = [
            "ema_trend",
            "ema_slope",
            "pullback",
            "breakout",
            "supertrend",
            "macd_momentum",
            "rsi_momentum",
            "volume_spike",
            "atr_range",
            "smc_ob",
            "smc_fvg",
            "smc_bos",
        ]

        results = []

        # Pre-compute indicators ONCE (the expensive part — SMC, swing detection etc.)
        from mgc_trading.strategy_5min import MGCStrategy5Min
        full_params = {**DEFAULT_5MIN_PARAMS, **custom_params}
        strategy = MGCStrategy5Min(full_params)
        df_ind = strategy.compute_indicators(
            df[["open", "high", "low", "close", "volume"]].copy()
        )

        _skip_flat = skip_flat or full_params.get("skip_flat", False)
        _skip_counter = skip_counter_trend or full_params.get("skip_counter_trend", False)

        min_enabled = max(7, len(condition_keys) - 3)  # allow disabling up to 3 conditions
        for r in range(min_enabled, len(condition_keys) + 1):
            for combo in combinations(condition_keys, r):
                enabled = set(combo)
                disabled = set(condition_keys) - enabled

                try:
                    # Only regenerate signals (fast) — reuse precomputed indicators
                    signals = strategy.generate_signals(df_ind, disabled=disabled or None)

                    bt = Backtester5Min()
                    result = bt.run_from_precomputed(
                        df_ind, signals, full_params,
                        oos_split=0.3,
                        skip_flat=_skip_flat,
                        skip_counter_trend=_skip_counter,
                    )

                    if result.total_trades < 10:
                        continue

                    # Filter trades to the display window (same as backtest_5min)
                    filtered = result.trades
                    if display_start:
                        filtered = [t for t in result.trades if str(t.exit_time)[:10] >= display_start]

                    n_trades = len(filtered)
                    if n_trades < 3:
                        continue

                    wins = [t for t in filtered if t.pnl > 0]
                    losses = [t for t in filtered if t.pnl <= 0]
                    total_pnl = sum(t.pnl for t in filtered)
                    win_rate = round(len(wins) / n_trades * 100, 1) if n_trades else 0
                    return_pct = round(total_pnl / bt.initial_capital * 100, 2)
                    total_loss = abs(sum(t.pnl for t in losses)) if losses else 0
                    total_win = sum(t.pnl for t in wins) if wins else 0
                    pf = round(total_win / total_loss, 2) if total_loss > 0 else 999.0

                    score = (
                        (return_pct / 100) * 0.45
                        + (win_rate / 100) * 0.35
                        - (result.max_drawdown_pct / 100) * 0.20
                    )

                    results.append({
                        "conditions": sorted(list(enabled)),
                        "disabled": sorted(list(disabled)),
                        "score": round(score, 6),
                        "win_rate": win_rate,
                        "total_return_pct": return_pct,
                        "max_drawdown_pct": round(result.max_drawdown_pct, 2),
                        "sharpe_ratio": round(result.sharpe_ratio, 4),
                        "profit_factor": pf,
                        "total_trades": n_trades,
                        "oos_win_rate": round(result.oos_win_rate, 2),
                        "oos_return_pct": round(result.oos_return_pct, 2),
                        "oos_total_trades": result.oos_total_trades,
                    })

                except Exception:
                    continue

        results.sort(key=lambda x: x["score"], reverse=True)

        # Pick 3 category winners: best WR, best Return, lowest risk (DD)
        if not results:
            return []

        best_wr = max(results, key=lambda x: x["win_rate"])
        best_wr["category"] = "best_winrate"

        best_ret = max(results, key=lambda x: x["total_return_pct"])
        best_ret["category"] = "best_return"

        best_safe = min(results, key=lambda x: x["max_drawdown_pct"])
        best_safe["category"] = "low_risk"

        # De-duplicate: if same combo wins multiple categories, keep first
        seen: set[str] = set()
        top3: list[dict] = []
        for r in [best_wr, best_ret, best_safe]:
            key = ",".join(r["conditions"])
            if key not in seen:
                seen.add(key)
                top3.append(r)

        return top3

    top = await run_in_threadpool(_run)
    return top


class V2Candle(BaseModel):
    time: str
    open: float
    high: float
    low: float
    close: float
    volume: float
    ema20: Optional[float] = None
    ema50: Optional[float] = None
    ema200: Optional[float] = None
    rsi: Optional[float] = None
    macd_hist: Optional[float] = None
    st_dir: Optional[int] = None
    ht_trend: Optional[int] = None
    signal: int = 0


class V2Trade(BaseModel):
    entry_time: str
    exit_time: str
    entry_price: float
    exit_price: float
    qty: int
    pnl: float
    pnl_pct: float
    reason: str
    rsi: float = 0.0
    ema_align: str = ""
    ht_dir: str = ""
    vol_ratio: float = 0.0
    macd_hist: float = 0.0
    st_dir: int = 0
    mae: float = 0.0


class V2Metrics(BaseModel):
    initial_capital: float
    final_equity: float
    total_return_pct: float
    max_drawdown_pct: float
    sharpe_ratio: float
    calmar_ratio: float = 0.0
    total_trades: int
    winners: int
    losers: int
    win_rate: float
    avg_win: float
    avg_loss: float
    avg_pnl_pct: float = 0.0
    profit_factor: float
    risk_reward_ratio: float
    oos_win_rate: float = 0.0
    oos_total_trades: int = 0
    oos_return_pct: float = 0.0


class V2BacktestResponse(BaseModel):
    symbol: str
    interval: str
    period: str
    candles: list[V2Candle]
    trades: list[V2Trade]
    equity_curve: list[float]
    metrics: V2Metrics
    params: dict
    timestamp: str


class V2ScanSignal(BaseModel):
    found: bool
    entry_price: float
    stop_loss: float
    take_profit: float
    risk_reward: float
    strength: int
    strength_detail: dict
    bar_time: str
    rsi: float
    atr: float
    ema20: float
    ema50: float
    ema200: float
    ema_align: str
    ht_dir: str
    st_dir: int
    macd_hist: float
    vol_ratio: float
    vol_breakout: bool
    candle_body_pct: float


class V2ScanResponse(BaseModel):
    opportunity: bool
    signal: V2ScanSignal
    signals: list[V2ScanSignal] = []
    candles: list[dict] = []
    timestamp: str


# ── V2 Backtest endpoint ────────────────────────────────────────────

@router.get("/backtest_v2")
async def mgc_backtest_v2(
    symbol: Annotated[str, Query()] = "MGC=F",
    period: Annotated[str, Query()] = "60d",
    capital: Annotated[float, Query()] = INITIAL_CAPITAL,
    oos_split: Annotated[float, Query(ge=0, le=0.5)] = 0.3,
    atr_sl_mult: Annotated[float, Query(ge=0.3, le=5.0)] = 1.0,
    atr_tp_mult: Annotated[float, Query(ge=0.5, le=5.0)] = 2.0,
    st_mult: Annotated[float, Query(ge=1.0, le=5.0)] = 2.0,
    vol_mult: Annotated[float, Query(ge=0.5, le=3.0)] = 1.2,
    date_from: Annotated[Optional[str], Query()] = None,
    date_to: Annotated[Optional[str], Query()] = None,
) -> V2BacktestResponse:
    """Run Strategy V2 backtest (long-only, EMA alignment + HalfTrend + Supertrend)."""

    def _run():
        import pandas as _pd
        from mgc_trading.backtest_v2 import BacktesterV2
        from mgc_trading.strategy_v2 import StrategyV2, DEFAULT_V2_PARAMS

        effective_period = period if period in ("1d", "2d", "5d", "7d", "30d", "60d") else "60d"

        df = load_yfinance(symbol=symbol, interval="5m", period=effective_period)
        if date_from:
            df = df[df.index >= _pd.Timestamp(date_from, tz=df.index.tz)]
        if date_to:
            df = df[df.index < _pd.Timestamp(date_to, tz=df.index.tz) + _pd.Timedelta(days=1)]

        if df.empty or len(df) < 50:
            raise ValueError("Not enough data. yfinance 5m data available for last ~60 days.")

        custom_params = {
            "atr_sl_mult": atr_sl_mult,
            "atr_tp_mult": atr_tp_mult,
            "st_mult": st_mult,
            "vol_mult": vol_mult,
        }

        strategy = StrategyV2({**DEFAULT_V2_PARAMS, **custom_params})
        df_ind = strategy.compute_indicators(
            df[["open", "high", "low", "close", "volume"]].copy()
        )
        signals = strategy.generate_signals(df_ind)
        df_ind["signal"] = signals

        bt = BacktesterV2(capital=capital)
        result = bt.run(df, params=custom_params, oos_split=oos_split)

        candles = []
        for ts, row in df_ind.iterrows():
            candles.append(V2Candle(
                time=str(ts),
                open=round(float(row["open"]), 2),
                high=round(float(row["high"]), 2),
                low=round(float(row["low"]), 2),
                close=round(float(row["close"]), 2),
                volume=float(row.get("volume", 0)),
                ema20=round(float(row["ema20"]), 2) if not _isnan(row.get("ema20")) else None,
                ema50=round(float(row["ema50"]), 2) if not _isnan(row.get("ema50")) else None,
                ema200=round(float(row["ema200"]), 2) if not _isnan(row.get("ema200")) else None,
                rsi=round(float(row["rsi"]), 1) if not _isnan(row.get("rsi")) else None,
                macd_hist=round(float(row["macd_hist"]), 4) if not _isnan(row.get("macd_hist")) else None,
                st_dir=int(row["st_dir"]) if not _isnan(row.get("st_dir")) else None,
                ht_trend=int(row["ht_trend"]) if not _isnan(row.get("ht_trend")) else None,
                signal=int(row.get("signal", 0)),
            ))

        trades = [
            V2Trade(
                entry_time=str(t.entry_time), exit_time=str(t.exit_time),
                entry_price=round(t.entry_price, 2), exit_price=round(t.exit_price, 2),
                qty=t.qty, pnl=round(t.pnl, 2), pnl_pct=round(t.pnl_pct, 2),
                reason=t.reason, rsi=t.rsi, ema_align=t.ema_align, ht_dir=t.ht_dir,
                vol_ratio=t.vol_ratio, macd_hist=t.macd_hist, st_dir=t.st_dir,
                mae=round(t.mae, 2),
            )
            for t in result.trades
        ]

        metrics = V2Metrics(
            initial_capital=result.initial_capital,
            final_equity=result.final_equity,
            total_return_pct=result.total_return_pct,
            max_drawdown_pct=result.max_drawdown_pct,
            sharpe_ratio=result.sharpe_ratio,
            calmar_ratio=result.calmar_ratio,
            total_trades=result.total_trades,
            winners=result.winners,
            losers=result.losers,
            win_rate=result.win_rate,
            avg_win=result.avg_win,
            avg_loss=result.avg_loss,
            avg_pnl_pct=result.avg_pnl_pct,
            profit_factor=result.profit_factor,
            risk_reward_ratio=result.risk_reward_ratio,
            oos_win_rate=result.oos_win_rate,
            oos_total_trades=result.oos_total_trades,
            oos_return_pct=result.oos_return_pct,
        )

        return candles, trades, result.equity_curve, metrics, result.params

    try:
        candles, trades, eq_curve, metrics, params = await run_in_threadpool(_run)
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as exc:
        logger.exception("V2 backtest failed")
        raise HTTPException(status_code=500, detail=str(exc))

    return V2BacktestResponse(
        symbol=symbol, interval="5m", period=period,
        candles=candles, trades=trades, equity_curve=eq_curve,
        metrics=metrics, params=params,
        timestamp=datetime.now(SGT).strftime("%d/%m/%Y %H:%M SGT"),
    )


# ── V2 Scan endpoint ────────────────────────────────────────────────

@router.get("/scan_v2")
async def mgc_scan_v2(
    symbol: Annotated[str, Query()] = "MGC=F",
    period: Annotated[str, Query()] = "60d",
    atr_sl_mult: Annotated[float, Query(ge=0.3, le=5.0)] = 1.0,
    atr_tp_mult: Annotated[float, Query(ge=0.5, le=5.0)] = 2.0,
) -> V2ScanResponse:
    """Scan for V2 entry signals on latest 5m data."""

    def _run():
        from mgc_trading.scanner_v2 import scan_v2, scan_v2_all

        effective_period = period if period in ("1d", "2d", "5d", "7d", "30d", "60d") else "60d"
        df = load_yfinance(symbol=symbol, interval="5m", period=effective_period)

        custom_params = {"atr_sl_mult": atr_sl_mult, "atr_tp_mult": atr_tp_mult}
        result = scan_v2(df, params=custom_params)
        all_results = scan_v2_all(df, params=custom_params, lookback=10)

        tail = df.tail(30)
        candles_out = []
        for idx, row in tail.iterrows():
            t = str(idx)
            candles_out.append({
                "time": t[:16] if len(t) > 16 else t,
                "open": round(float(row.get("Open", row.get("open", 0))), 2),
                "high": round(float(row.get("High", row.get("high", 0))), 2),
                "low": round(float(row.get("Low", row.get("low", 0))), 2),
                "close": round(float(row.get("Close", row.get("close", 0))), 2),
                "volume": int(row.get("Volume", row.get("volume", 0))),
            })

        def _to_sig(r):
            return V2ScanSignal(
                found=r.found, entry_price=r.entry_price,
                stop_loss=r.stop_loss, take_profit=r.take_profit,
                risk_reward=r.risk_reward, strength=r.strength,
                strength_detail=r.strength_detail, bar_time=r.bar_time,
                rsi=r.rsi, atr=r.atr, ema20=r.ema20, ema50=r.ema50,
                ema200=r.ema200, ema_align=r.ema_align, ht_dir=r.ht_dir,
                st_dir=r.st_dir, macd_hist=r.macd_hist,
                vol_ratio=r.vol_ratio, vol_breakout=r.vol_breakout,
                candle_body_pct=r.candle_body_pct,
            )

        sig = _to_sig(result)
        all_sigs = [_to_sig(r) for r in all_results]
        return result.found, sig, all_sigs, candles_out

    found, sig, all_sigs, candles_out = await run_in_threadpool(_run)

    return V2ScanResponse(
        opportunity=found, signal=sig, signals=all_sigs,
        candles=candles_out,
        timestamp=datetime.now(SGT).strftime("%d/%m/%Y %H:%M:%S SGT"),
    )


# ── V2 Optimize endpoint ────────────────────────────────────────────

@router.get("/optimize_v2")
async def mgc_optimize_v2(
    symbol: Annotated[str, Query()] = "MGC=F",
    period: Annotated[str, Query()] = "60d",
    capital: Annotated[float, Query()] = INITIAL_CAPITAL,
) -> dict:
    """Run V2 grid-search optimizer. Returns best result + top 20."""

    def _run():
        from mgc_trading.backtest_v2 import optimize_v2 as _optimize

        effective_period = period if period in ("1d", "2d", "5d", "7d", "30d", "60d") else "60d"
        df = load_yfinance(symbol=symbol, interval="5m", period=effective_period)

        best, top_results = _optimize(df, capital=capital)

        return {
            "best": {
                "params": best.params,
                "trades": best.total_trades,
                "win_rate": best.win_rate,
                "return_pct": best.total_return_pct,
                "max_dd": best.max_drawdown_pct,
                "sharpe": best.sharpe_ratio,
                "pf": best.profit_factor,
                "rr": best.risk_reward_ratio,
                "avg_pnl_pct": best.avg_pnl_pct,
            },
            "top_results": top_results,
            "total_combos": len(top_results),
            "timestamp": datetime.now(SGT).strftime("%d/%m/%Y %H:%M SGT"),
        }

    try:
        return await run_in_threadpool(_run)
    except Exception as exc:
        logger.exception("V2 optimize failed")
        raise HTTPException(status_code=500, detail=str(exc))


# ═══════════════════════════════════════════════════════════════════════
# Market Structure — fast, cached endpoint
# ═══════════════════════════════════════════════════════════════════════
import time as _time

_structure_cache: dict[str, dict] = {}   # symbol -> {value, ts}
_STRUCTURE_TTL = 60  # seconds — cache for 1 min (re-compute on next 5m candle)


@router.get("/market_structure")
async def get_market_structure(
    symbol: Annotated[str, Query()] = "MGC",
):
    """Fast market structure endpoint — returns BULL(1)/BEAR(-1)/SIDEWAYS(0).
    Cached for 60s to avoid recomputing on every poll."""

    now = _time.time()
    cached = _structure_cache.get(symbol)
    if cached and (now - cached["ts"]) < _STRUCTURE_TTL:
        return cached["data"]

    def _compute():
        from mgc_trading.indicators_5min import market_structure

        commodity = _COMMODITY_SYMBOLS.get(symbol, {"yf": "MGC=F"})
        yf_symbol = commodity["yf"]

        df = load_yfinance(symbol=yf_symbol, interval="5m", period="5d")
        if df is None or df.empty:
            return {"symbol": symbol, "structure": 0, "label": "NO DATA", "cached": False}

        ms = market_structure(df["high"], df["low"], df["close"], lookback=100)
        val = int(ms.iloc[-1]) if len(ms) > 0 else 0
        label = {1: "BULL", -1: "BEAR", 0: "SIDEWAYS"}.get(val, "SIDEWAYS")

        return {
            "symbol": symbol,
            "structure": val,
            "label": label,
            "bars": len(df),
            "last_price": round(float(df["close"].iloc[-1]), 4),
            "timestamp": datetime.now(SGT).strftime("%H:%M:%S SGT"),
        }

    try:
        data = await run_in_threadpool(_compute)
        _structure_cache[symbol] = {"data": data, "ts": now}
        return data
    except Exception as exc:
        logger.exception("Market structure failed")
        raise HTTPException(status_code=500, detail=str(exc))
