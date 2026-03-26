from datetime import date, datetime

import pandas as pd
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, Field
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.db.database import get_db
from app.models.backtest_trade import BacktestTrade
from app.models.condition_preference import ConditionPreference, LogicPreference
from app.services.data_collector import fetch_stock
from app.strategies.sma_indicator import sma as compute_sma, sma5 as compute_sma5, halftrend_full as compute_halftrend_full
from app.strategies.conditions import get_buy_condition, get_sell_condition, CONDITION_MAP, SELL_PAIR
from app.utils.indicators import atr as compute_atr, ema as compute_ema, rsi as compute_rsi, detect_candle, weekly_supertrend, \
    pivot_low, pivot_high, hourly_supertrend, liquidity_sweep, market_structure_shift


router = APIRouter(prefix="/backtest", tags=["backtest"])


def _left_pullback_ok(
    closes: list[float],
    lows: list[float],
    ema20_values: list[float],
    atr_values: list[float],
    sweep_low_arr: list[float],
    idx: int,
    buffer_mult: float,
) -> bool:
    """Check if price is pulling back to EMA20 or structure zone."""
    import math as _math
    price = closes[idx]
    low_val = lows[idx]
    ema20 = ema20_values[idx] if idx < len(ema20_values) else None
    atr_val = atr_values[idx] if idx < len(atr_values) else 0
    if ema20 is None or _math.isnan(ema20):
        return False
    if _math.isnan(atr_val):
        atr_val = 0

    # Pullback to EMA20 zone
    upper = ema20 + buffer_mult * atr_val
    lower = ema20 - buffer_mult * atr_val
    if low_val <= upper and price >= lower:
        return True

    # Pullback to structure zone (sweep low area)
    sl = sweep_low_arr[idx]
    if sl > 0 and low_val <= sl + atr_val and price >= sl - atr_val * 0.5:
        return True

    return False


class BacktestRequest(BaseModel):
    symbol: str = Field(default="AAPL", min_length=1, max_length=16)
    quantity: float = Field(default=1.0, gt=0)
    investment: float = Field(default=0.0, ge=0, description="USD amount per trade. If > 0, overrides quantity with investment/buy_price")
    short_window: int = Field(default=5, ge=2, le=100)
    long_window: int = Field(default=20, ge=3, le=300)
    period: str = Field(default="5y", description="Data period for yfinance (1mo, 3mo, 6mo, 1y, 2y, 5y, 10y, max)")
    buy_conditions: list[str] = Field(default=["halftrend_green"], description="Buy condition names")
    sell_conditions: list[str] = Field(default=["close_below_low_ema5"], description="Sell condition names")
    buy_logic: str = Field(default="OR", pattern="^(AND|OR)$", description="AND = all buy conditions must be true, OR = any one triggers")
    sell_logic: str = Field(default="OR", pattern="^(AND|OR)$", description="AND = all sell conditions must be true, OR = any one triggers")
    take_profit_pct: float = Field(default=2.0, ge=0, le=100, description="Take profit percentage (e.g. 2.0 = 2%)")
    stop_loss_pct: float = Field(default=5.0, ge=0, le=100, description="Trailing stop loss percentage (e.g. 5.0 = 5%)")
    sma_sell_period: int = Field(default=10, ge=2, le=200, description="SMA period for 'Close below SMA' sell condition")
    # Left-side trading parameters
    swing_lookback: int = Field(default=10, ge=3, le=30, description="Pivot lookback for swing detection")
    sweep_valid_bars: int = Field(default=8, ge=1, le=20, description="How many bars a liquidity sweep stays active")
    mss_valid_bars: int = Field(default=10, ge=1, le=30, description="How many bars a MSS signal stays active")
    ema20_period: int = Field(default=20, ge=5, le=100, description="EMA period for pullback entry")
    pullback_atr_buffer: float = Field(default=0.5, ge=0, le=3.0, description="Pullback buffer in ATR multiples")
    atr_sl_mult: float = Field(default=0.5, ge=0, le=3.0, description="Stop-loss ATR buffer multiplier")
    left_tp1_rr: float = Field(default=2.0, ge=0.5, le=10.0, description="TP1 risk-reward ratio")
    left_tp2_rr: float = Field(default=4.0, ge=1.0, le=20.0, description="TP2 risk-reward ratio")
    trail_atr_mult: float = Field(default=2.0, ge=0.5, le=5.0, description="Trailing stop ATR multiplier")
    st_factor: float = Field(default=3.0, ge=0.5, le=10.0, description="HTF Supertrend factor")
    st_atr_period: int = Field(default=10, ge=1, le=50, description="HTF Supertrend ATR period")
    # ── Pro sell parameters ──
    atr_stop_mult: float = Field(default=1.5, ge=0.5, le=5.0, description="ATR multiplier for ATR stop loss")
    atr_tp_rr: float = Field(default=2.0, ge=0.5, le=10.0, description="Risk-reward ratio for ATR take profit")
    chandelier_mult: float = Field(default=3.0, ge=1.0, le=10.0, description="ATR multiplier for Chandelier exit")
    break_even_trigger_pct: float = Field(default=2.0, ge=0.5, le=20.0, description="% gain before break-even stop activates")
    time_stop_bars: int = Field(default=20, ge=5, le=100, description="Max bars held before time stop triggers")
    time_stop_min_return: float = Field(default=1.0, ge=0, le=20.0, description="Min return % to avoid time stop")
    rsi_overbought: float = Field(default=75.0, ge=50, le=95, description="RSI overbought threshold for exit")


def _execute_backtest(payload: BacktestRequest, frame: pd.DataFrame, db: Session, reset_before_run: bool) -> dict[str, object]:
    symbol = payload.symbol.upper()
    deleted_rows = 0

    if reset_before_run:
        deleted_rows = db.query(BacktestTrade).filter(BacktestTrade.symbol == symbol).delete(synchronize_session=False)

    if "Close" not in frame.columns:
        return {
            "symbol": symbol,
            "reset": reset_before_run,
            "deleted_rows": deleted_rows,
            "trades": [],
            "summary": {"count": 0, "wins": 0, "win_rate": 0.0, "net_pnl": 0.0},
        }

    normalized = frame.copy()
    if "Date" not in normalized.columns:
        normalized = normalized.reset_index().rename(columns={"index": "Date"})

    normalized["Date"] = pd.to_datetime(normalized["Date"], errors="coerce")
    normalized["Close"] = pd.to_numeric(normalized["Close"], errors="coerce")
    normalized = normalized.dropna(subset=["Date", "Close"]).reset_index(drop=True)

    closes = normalized["Close"].astype(float).tolist()
    highs = normalized["High"].astype(float).tolist() if "High" in normalized.columns else closes
    lows = normalized["Low"].astype(float).tolist() if "Low" in normalized.columns else closes
    opens = normalized["Open"].astype(float).tolist() if "Open" in normalized.columns else closes
    volumes = normalized["Volume"].astype(float).tolist() if "Volume" in normalized.columns else [0] * len(closes)
    candle_patterns = [detect_candle(opens[i], highs[i], lows[i], closes[i]) for i in range(len(closes))]
    short_values = compute_sma(closes, payload.short_window)
    long_values = compute_sma(closes, payload.long_window)
    sma5_values = compute_sma5(closes)
    ema5_values = compute_ema(closes, 5)
    sma10_values = compute_sma(closes, 10)
    sma_sell_values = compute_sma(closes, payload.sma_sell_period) if payload.sma_sell_period != 10 else sma10_values
    ht_result = compute_halftrend_full(highs, lows, closes)
    halftrend_values = ht_result["trend"]
    halftrend_line = ht_result["ht"]

    # Weekly Supertrend: -1 = uptrend, 1 = downtrend
    date_list = normalized["Date"].tolist()
    wst_dirs = weekly_supertrend(date_list, opens, highs, lows, closes)

    # ── Left-side trading indicators (pre-computed) ──────────────────
    # EMA20 for pullback entry
    ema20_values = compute_ema(closes, payload.ema20_period)

    # HTF (hourly approx) Supertrend for trend filter
    htf_dirs = hourly_supertrend(date_list, opens, highs, lows, closes,
                                  period=payload.st_atr_period, multiplier=payload.st_factor)

    # Pivot lows & highs for sweep/MSS detection
    piv_lows = pivot_low(lows, payload.swing_lookback)
    piv_highs = pivot_high(highs, payload.swing_lookback)

    # Liquidity sweep detection
    sweep_data = liquidity_sweep(highs, lows, closes, piv_lows,
                                  valid_bars=payload.sweep_valid_bars)

    # Market structure shift
    mss_signals = market_structure_shift(highs, lows, closes, piv_highs, piv_lows)

    # Build "active" arrays for sweep and MSS (with validity window)
    sweep_active_arr = [False] * len(closes)
    sweep_low_arr = [0.0] * len(closes)
    last_sweep_bar = -999
    last_sweep_low = 0.0
    for i in range(len(closes)):
        if sweep_data[i] is not None:
            last_sweep_bar = sweep_data[i]["sweep_bar"]
            last_sweep_low = sweep_data[i]["sweep_low"]
        if (i - last_sweep_bar) <= payload.sweep_valid_bars and last_sweep_low > 0:
            sweep_active_arr[i] = True
            sweep_low_arr[i] = last_sweep_low
        else:
            sweep_active_arr[i] = False

    mss_active_arr = [False] * len(closes)
    last_mss_bar = -999
    for i in range(len(closes)):
        if mss_signals[i]:
            last_mss_bar = i
        mss_active_arr[i] = (i - last_mss_bar) <= payload.mss_valid_bars

    # Pre-compute volume boost: volume >= 2x the 20-day average
    vol_boost = [False] * len(volumes)
    vol_ratio = [0.0] * len(volumes)
    for i in range(len(volumes)):
        start = max(0, i - 20)
        window = volumes[start:i]
        avg = sum(window) / len(window) if window else 0
        vol_boost[i] = (volumes[i] >= avg * 2) if avg > 0 else False
        vol_ratio[i] = (volumes[i] / avg) if avg > 0 else 0.0

    # ATR (14-period) + ATR SMA (20-period) for volatility expansion detection
    atr_values = compute_atr(highs, lows, closes, 14)
    atr_sma_values = compute_sma(atr_values, 20)
    rsi_values = compute_rsi(closes, 14)

    buy_fns = [get_buy_condition(name) for name in payload.buy_conditions] if payload.buy_conditions else [get_buy_condition("halftrend_green")]
    sell_names = payload.sell_conditions if payload.sell_conditions else ["close_below_low_ema5"]
    sell_fns = [get_sell_condition(name) for name in sell_names]

    min_start = max(payload.short_window, payload.long_window)
    open_trade: dict[str, object] | None = None
    trades: list[dict[str, object]] = []

    max_trades = 120

    # Day-by-day loop: iterate from the first valid day to the last day.
    for idx in range(min_start, len(normalized)):
        if len(trades) >= max_trades:
            break

        prev_short = short_values[idx - 1]
        prev_long = long_values[idx - 1]
        cur_short = short_values[idx]
        cur_long = long_values[idx]

        if pd.isna(prev_short) or pd.isna(prev_long) or pd.isna(cur_short) or pd.isna(cur_long):
            continue

        price = float(closes[idx])
        ts = normalized.iloc[idx]["Date"]
        cur_sma10 = float(sma10_values[idx]) if not pd.isna(sma10_values[idx]) else price

        cur_ht = halftrend_values[idx]
        prev_ht = halftrend_values[idx - 1] if idx > 0 else cur_ht

        buy_ctx = {
            "prev_short": float(prev_short),
            "prev_long": float(prev_long),
            "cur_short": float(cur_short),
            "cur_long": float(cur_long),
            "cur_sma10": float(sma10_values[idx]) if not pd.isna(sma10_values[idx]) else 0,
            "halftrend": cur_ht,
            "prev_halftrend": prev_ht,
            "price": price,
            "prev_close": float(closes[idx - 1]) if idx > 0 else 0,
            "prev_candle": candle_patterns[idx - 1] if idx > 0 else None,
            "prev_candle_high": float(highs[idx - 1]) if idx > 0 else 0,
            "prev_candle_low": float(lows[idx - 1]) if idx > 0 else 0,
            "prev_vol_ratio": vol_ratio[idx - 1] if idx > 0 else 0.0,
            "cur_vol_ratio": vol_ratio[idx],
            "weekly_trend_up": wst_dirs[idx] == -1 if idx < len(wst_dirs) else False,
            "prev_weekly_trend_up": wst_dirs[idx - 1] == -1 if idx > 0 and idx - 1 < len(wst_dirs) else False,
            "cur_ema20": float(ema20_values[idx]) if idx < len(ema20_values) and not pd.isna(ema20_values[idx]) else 0,
            "prev_ema20": float(ema20_values[idx - 1]) if idx > 0 and idx - 1 < len(ema20_values) and not pd.isna(ema20_values[idx - 1]) else 0,
            "prev_day_boost": vol_boost[idx - 1] if idx > 0 else False,
            "prev_day_high": float(highs[idx - 1]) if idx > 0 else 0,
            "prev_day_low": float(lows[idx - 1]) if idx > 0 else 0,
            "prev_day_vol": float(volumes[idx - 1]) if idx > 0 else 0,
            "prev_prev_day_vol": float(volumes[idx - 2]) if idx > 1 else 0,
            "cur_atr": float(atr_values[idx]) if idx < len(atr_values) and not pd.isna(atr_values[idx]) else 0,
            "cur_atr_sma": float(atr_sma_values[idx]) if idx < len(atr_sma_values) and not pd.isna(atr_sma_values[idx]) else 0,
            "prev_atr": float(atr_values[idx - 1]) if idx > 0 and not pd.isna(atr_values[idx - 1]) else 0,
            "prev_atr_sma": float(atr_sma_values[idx - 1]) if idx > 0 and idx - 1 < len(atr_sma_values) and not pd.isna(atr_sma_values[idx - 1]) else 0,
            # Left-side trading keys
            "htf_trend_up": htf_dirs[idx] == -1 if idx < len(htf_dirs) else False,
            "sweep_active": sweep_active_arr[idx],
            "sweep_low": sweep_low_arr[idx],
            "mss_active": mss_active_arr[idx],
            "pullback_ok": _left_pullback_ok(closes, lows, ema20_values, atr_values, sweep_low_arr, idx, payload.pullback_atr_buffer),
        }

        cur_sma_sell = float(sma_sell_values[idx]) if not pd.isna(sma_sell_values[idx]) else price

        sell_ctx = {
            "prev_short": float(prev_short),
            "prev_long": float(prev_long),
            "cur_short": float(cur_short),
            "cur_long": float(cur_long),
            "price": price,
            "sma10": cur_sma10,
            "close_sma_value": cur_sma_sell,
            "halftrend": cur_ht,
            "prev_halftrend": prev_ht,
            "halftrend_value": float(halftrend_line[idx]) if idx < len(halftrend_line) else 0,
            "buy_price": float(open_trade["buy_price"]) if open_trade else 0,
            "highest_price": float(open_trade["highest_price"]) if open_trade else 0,
            "lowest_price": float(open_trade["lowest_price"]) if open_trade else 0,
            "ema5": float(ema5_values[idx]) if idx < len(ema5_values) else price,
            "take_profit_pct": payload.take_profit_pct / 100,
            "stop_loss_pct": payload.stop_loss_pct / 100,
            "hammer_close": float(open_trade.get("hammer_close", 0)) if open_trade else 0,
            "boost_day_low": float(open_trade.get("boost_day_low", 0)) if open_trade else 0,
            "weekly_trend_up": wst_dirs[idx] == -1 if idx < len(wst_dirs) else False,
            "prev_day_boost": vol_boost[idx - 1] if idx > 0 else False,
            "prev_day_high": float(highs[idx - 1]) if idx > 0 else 0,
            "prev_day_low": float(lows[idx - 1]) if idx > 0 else 0,
            "prev_candle": candle_patterns[idx - 1] if idx > 0 else None,
            "prev_candle_high": float(highs[idx - 1]) if idx > 0 else 0,
            "prev_candle_low": float(lows[idx - 1]) if idx > 0 else 0,
            "prev_vol_ratio": vol_ratio[idx - 1] if idx > 0 else 0.0,
            "prev_day_vol": float(volumes[idx - 1]) if idx > 0 else 0,
            "prev_prev_day_vol": float(volumes[idx - 2]) if idx > 1 else 0,
            # Left-side trading keys (sell)
            "entry_sweep_low": float(open_trade.get("entry_sweep_low", 0)) if open_trade else 0,
            "atr_sl_mult": payload.atr_sl_mult,
            "left_tp1_rr": payload.left_tp1_rr,
            "left_tp2_rr": payload.left_tp2_rr,
            "trail_atr_mult": payload.trail_atr_mult,
            "cur_atr": float(atr_values[idx]) if idx < len(atr_values) and not pd.isna(atr_values[idx]) else 0,
            # Pro sell keys
            "entry_atr": float(open_trade.get("entry_atr", 0)) if open_trade else 0,
            "atr_stop_mult": payload.atr_stop_mult,
            "atr_tp_rr": payload.atr_tp_rr,
            "chandelier_mult": payload.chandelier_mult,
            "break_even_trigger_pct": payload.break_even_trigger_pct / 100,
            "bars_held": idx - int(open_trade["buy_index"]) if open_trade else 0,
            "time_stop_bars": payload.time_stop_bars,
            "time_stop_min_return": payload.time_stop_min_return / 100,
            "rsi": float(rsi_values[idx]) if idx < len(rsi_values) and not pd.isna(rsi_values[idx]) else 50,
            "rsi_overbought": payload.rsi_overbought,
            # Volume anchor exit keys
            "vol_anchor_close": float(open_trade.get("vol_anchor_close", 0)) if open_trade else 0,
            "vol_anchor_low": float(open_trade.get("vol_anchor_low", 0)) if open_trade else 0,
        }

        if open_trade is None:
            buy_match = all(fn(buy_ctx) for fn in buy_fns) if payload.buy_logic == "AND" else any(fn(buy_ctx) for fn in buy_fns)
            if buy_match:
                buy_joiner = " && " if payload.buy_logic == "AND" else " || "
                open_trade = {
                    "buy_price": price,
                    "highest_price": price,
                    "lowest_price": price,
                    "hammer_close": float(closes[idx - 1]) if idx > 0 and candle_patterns[idx - 1] == "Inverted Hammer" else 0,
                    "boost_day_low": float(lows[idx - 1]) if idx > 0 else 0,
                    "entry_sweep_low": sweep_low_arr[idx],
                    "entry_atr": float(atr_values[idx]) if idx < len(atr_values) and not pd.isna(atr_values[idx]) else 0,
                    "vol_anchor_close": 0.0,
                    "vol_anchor_low": 0.0,
                    "buy_time": ts,
                    "buy_index": idx,
                    "buy_criteria": buy_joiner.join(payload.buy_conditions),
                    "buy_sma5": float(sma5_values[idx]) if not pd.isna(sma5_values[idx]) else None,
                }
            continue

        if price > open_trade["highest_price"]:
            open_trade["highest_price"] = price
        if price < open_trade["lowest_price"]:
            open_trade["lowest_price"] = price

        # ── Volume anchor tracking (3x relative volume) ──
        anchor_close = open_trade["vol_anchor_close"]
        if anchor_close == 0:
            if vol_ratio[idx] >= 3.0:
                open_trade["vol_anchor_close"] = float(closes[idx])
                open_trade["vol_anchor_low"] = float(lows[idx])
        else:
            if float(closes[idx]) > anchor_close:
                open_trade["vol_anchor_close"] = float(closes[idx])
                open_trade["vol_anchor_low"] = float(lows[idx])

        if not (all(fn(sell_ctx) for fn in sell_fns) if payload.sell_logic == "AND" else any(fn(sell_ctx) for fn in sell_fns)):
            continue

        buy_price = float(open_trade["buy_price"])
        sell_joiner = " && " if payload.sell_logic == "AND" else " || "
        reason = sell_joiner.join(sell_names)

        qty = (payload.investment / buy_price) if payload.investment > 0 else payload.quantity
        pnl = (price - buy_price) * qty
        return_pct = (price - buy_price) / buy_price
        roi_dollar = pnl
        bars_held = idx - int(open_trade["buy_index"])

        db.add(
            BacktestTrade(
                symbol=symbol,
                quantity=qty,
                buy_price=buy_price,
                sell_price=price,
                buy_time=open_trade["buy_time"],
                sell_time=ts,
                pnl=pnl,
                return_pct=return_pct,
                bars_held=bars_held,
                buy_criteria=str(open_trade["buy_criteria"]),
                sell_criteria=reason,
                note=f"buy_logic={payload.buy_logic}, sell_logic={payload.sell_logic}, buy={open_trade['buy_criteria']}, sell={reason}",
            )
        )

        trades.append(
            {
                "symbol": symbol,
                "buy_time": str(open_trade["buy_time"]),
                "sell_time": str(ts),
                "buy_price": buy_price,
                "sell_price": price,
                "pnl": pnl,
                "return_pct": return_pct,
                "quantity": qty,
                "investment": payload.investment if payload.investment > 0 else buy_price * qty,
                "roi_dollar": roi_dollar,
                "bars_held": bars_held,
                "buy_criteria": open_trade["buy_criteria"],
                "sell_criteria": reason,
                "buy_sma5": open_trade["buy_sma5"],
                "sell_sma5": float(sma5_values[idx]) if not pd.isna(sma5_values[idx]) else None,
            }
        )
        open_trade = None

    if open_trade is not None and len(normalized) > 0:
        last_price = float(closes[-1])
        last_time = normalized.iloc[-1]["Date"]
        buy_price = float(open_trade["buy_price"])
        qty = (payload.investment / buy_price) if payload.investment > 0 else payload.quantity
        pnl = (last_price - buy_price) * qty
        return_pct = (last_price - buy_price) / buy_price
        roi_dollar = pnl
        bars_held = (len(normalized) - 1) - int(open_trade["buy_index"])

        db.add(
            BacktestTrade(
                symbol=symbol,
                quantity=qty,
                buy_price=buy_price,
                sell_price=last_price,
                buy_time=open_trade["buy_time"],
                sell_time=last_time,
                pnl=pnl,
                return_pct=return_pct,
                bars_held=bars_held,
                buy_criteria=str(open_trade["buy_criteria"]),
                sell_criteria="end_of_data",
                note=f"buy_logic={payload.buy_logic}, sell_logic={payload.sell_logic}, buy={open_trade['buy_criteria']}, sell=end_of_data",
            )
        )

        trades.append(
            {
                "symbol": symbol,
                "buy_time": str(open_trade["buy_time"]),
                "sell_time": str(last_time),
                "buy_price": buy_price,
                "sell_price": last_price,
                "pnl": pnl,
                "return_pct": return_pct,
                "quantity": qty,
                "investment": payload.investment if payload.investment > 0 else buy_price * qty,
                "roi_dollar": roi_dollar,
                "bars_held": bars_held,
                "buy_criteria": open_trade["buy_criteria"],
                "sell_criteria": "end_of_data",
                "buy_sma5": open_trade["buy_sma5"],
                "sell_sma5": float(sma5_values[-1]) if not pd.isna(sma5_values[-1]) else None,
            }
        )

    wins = sum(1 for item in trades if float(item["pnl"]) > 0)
    net_pnl = sum(float(item["pnl"]) for item in trades)
    total_invested = sum(float(item["investment"]) for item in trades)
    total_roi_pct = (net_pnl / total_invested * 100) if total_invested > 0 else 0.0
    win_rate = (wins / len(trades)) if trades else 0.0

    return {
        "symbol": symbol,
        "reset": reset_before_run,
        "deleted_rows": deleted_rows,
        "criteria": {
            "buy": payload.buy_conditions,
            "sell": sell_names,
            "short_window": payload.short_window,
            "long_window": payload.long_window,
        },
        "summary": {
            "count": len(trades),
            "wins": wins,
            "win_rate": win_rate,
            "net_pnl": net_pnl,
            "total_invested": total_invested,
            "total_roi_pct": total_roi_pct,
        },
        "trades": trades,
    }


@router.post("/run")
async def run_backtest(payload: BacktestRequest, db: Session = Depends(get_db)) -> dict[str, object]:
    frame = await run_in_threadpool(fetch_stock, payload.symbol, payload.period)
    result = _execute_backtest(payload=payload, frame=frame, db=db, reset_before_run=True)

    try:
        db.commit()
    except SQLAlchemyError as exc:
        db.rollback()
        raise HTTPException(status_code=503, detail=f"database write failed: {exc}") from exc

    return result


@router.delete("/reset")
def reset_backtest(symbol: str = Query(default="AAPL", min_length=1, max_length=16), db: Session = Depends(get_db)) -> dict[str, object]:
    upper_symbol = symbol.upper()
    try:
        deleted = db.query(BacktestTrade).filter(BacktestTrade.symbol == upper_symbol).delete(synchronize_session=False)
        db.commit()
    except SQLAlchemyError as exc:
        db.rollback()
        raise HTTPException(status_code=503, detail=f"database reset failed: {exc}") from exc

    return {"symbol": upper_symbol, "deleted_rows": deleted}


@router.get("/trades")
def list_backtest_trades(symbol: str | None = Query(default=None), db: Session = Depends(get_db)) -> dict[str, object]:
    try:
        query = db.query(BacktestTrade)
        if symbol:
            query = query.filter(BacktestTrade.symbol == symbol.upper())

        rows = query.order_by(BacktestTrade.id.desc()).limit(200).all()
    except SQLAlchemyError as exc:
        raise HTTPException(status_code=503, detail=f"database read failed: {exc}") from exc

    return {
        "count": len(rows),
        "items": [
            {
                "id": row.id,
                "symbol": row.symbol,
                "quantity": row.quantity,
                "buy_price": row.buy_price,
                "sell_price": row.sell_price,
                "buy_time": row.buy_time.isoformat(),
                "sell_time": row.sell_time.isoformat(),
                "pnl": row.pnl,
                "return_pct": row.return_pct,
                "bars_held": row.bars_held,
                "buy_criteria": row.buy_criteria,
                "sell_criteria": row.sell_criteria,
                "note": row.note,
                "created_at": row.created_at.isoformat() if row.created_at else None,
            }
            for row in rows
        ],
    }


@router.get("/conditions")
def list_conditions() -> dict[str, list[dict[str, str]]]:
    """Return all available buy/sell conditions for the UI."""
    buy_conditions = []
    sell_conditions = []
    for key, entry in CONDITION_MAP.items():
        item = {"name": key, "label": entry["label"]}
        if entry["type"] == "buy":
            buy_conditions.append(item)
        else:
            sell_conditions.append(item)
    return {"buy": buy_conditions, "sell": sell_conditions}


# ── Condition preferences (persist checked state) ────────────────────

class ConditionPrefsPayload(BaseModel):
    checked: list[str] = Field(default_factory=list, description="List of condition names that are checked")
    buy_logic: str = Field(default="OR", pattern="^(AND|OR)$")
    sell_logic: str = Field(default="OR", pattern="^(AND|OR)$")
    sma_sell_period: int = Field(default=10, ge=2, le=200)
    take_profit_pct: float = Field(default=2.0, ge=0, le=100)


@router.get("/conditions/preferences")
def get_condition_preferences(symbol: str = Query("AAPL"), db: Session = Depends(get_db)) -> dict[str, object]:
    """Return saved checked condition names and logic modes for a specific stock."""
    symbol_upper = symbol.upper()
    print(f"[LOAD PREFERENCES] Loading for symbol: {symbol_upper}")
    
    rows = db.query(ConditionPreference).filter(
        ConditionPreference.symbol == symbol_upper,
        ConditionPreference.checked.is_(True)
    ).all()
    
    checked_list = [r.name for r in rows]
    print(f"  Found {len(checked_list)} checked conditions: {checked_list}")
    
    buy_row = db.query(LogicPreference).filter(
        LogicPreference.symbol == symbol_upper,
        LogicPreference.key == "buy_logic"
    ).first()
    sell_row = db.query(LogicPreference).filter(
        LogicPreference.symbol == symbol_upper,
        LogicPreference.key == "sell_logic"
    ).first()
    sma_sell_row = db.query(LogicPreference).filter(
        LogicPreference.symbol == symbol_upper,
        LogicPreference.key == "sma_sell_period"
    ).first()
    take_profit_row = db.query(LogicPreference).filter(
        LogicPreference.symbol == symbol_upper,
        LogicPreference.key == "take_profit_pct"
    ).first()
    
    result = {
        "checked": checked_list,
        "buy_logic": buy_row.value if buy_row else "OR",
        "sell_logic": sell_row.value if sell_row else "OR",
        "sma_sell_period": int(sma_sell_row.value) if sma_sell_row else 10,
        "take_profit_pct": float(take_profit_row.value) if take_profit_row else 2.0,
    }
    print(f"[LOAD PREFERENCES] Returning: {result}")
    return result


@router.post("/conditions/preferences")
def save_condition_preferences(
    payload: ConditionPrefsPayload,
    symbol: str = Query("AAPL"),
    db: Session = Depends(get_db),
) -> dict[str, str]:
    """Save which conditions are currently checked and logic modes for a specific stock."""
    symbol_upper = symbol.upper()
    print(f"[SAVE PREFERENCES] Symbol: {symbol_upper}, Checked: {payload.checked}")
    
    # Delete old preferences for this stock
    db.query(ConditionPreference).filter(ConditionPreference.symbol == symbol_upper).delete(synchronize_session=False)
    
    # Add new condition preferences for this stock
    added_count = 0
    for name in payload.checked:
        if name in CONDITION_MAP:
            db.add(ConditionPreference(symbol=symbol_upper, name=name, checked=True))
            added_count += 1
            print(f"  ✓ Added condition: {name}")
        else:
            print(f"  ✗ Condition not in map: {name}")
    
    # Upsert logic preferences for this stock
    for key, val in [
        ("buy_logic", payload.buy_logic),
        ("sell_logic", payload.sell_logic),
        ("sma_sell_period", str(payload.sma_sell_period)),
        ("take_profit_pct", str(payload.take_profit_pct)),
    ]:
        existing = db.query(LogicPreference).filter(
            LogicPreference.symbol == symbol_upper,
            LogicPreference.key == key
        ).first()
        if existing:
            existing.value = val
        else:
            db.add(LogicPreference(symbol=symbol_upper, key=key, value=val))
    
    db.commit()
    print(f"[SAVE PREFERENCES] Saved {added_count} conditions for {symbol_upper}")
    
    # Verify data was saved
    verify = db.query(ConditionPreference).filter(
        ConditionPreference.symbol == symbol_upper,
        ConditionPreference.checked.is_(True)
    ).all()
    print(f"[SAVE PREFERENCES] VERIFY: Found {len(verify)} conditions in DB for {symbol_upper}: {[v.name for v in verify]}")
    
    return {"status": "ok"}


@router.delete("/conditions/preferences")
def reset_condition_preferences(symbol: str = Query("AAPL"), db: Session = Depends(get_db)) -> dict[str, str]:
    """Reset condition preferences for a specific stock."""
    symbol_upper = symbol.upper()
    db.query(ConditionPreference).filter(ConditionPreference.symbol == symbol_upper).delete(synchronize_session=False)
    db.query(LogicPreference).filter(LogicPreference.symbol == symbol_upper).delete(synchronize_session=False)
    db.commit()
    return {"status": "reset"}


# ── Buy signals preview (read-only, no DB writes) ────────────────────

class SignalsRequest(BaseModel):
    symbol: str = Field(default="AAPL", min_length=1, max_length=16)
    short_window: int = Field(default=5, ge=2, le=100)
    long_window: int = Field(default=20, ge=3, le=300)
    period: str = Field(default="5y", description="Data period for yfinance")
    buy_conditions: list[str] = Field(default=["halftrend_green"])
    buy_logic: str = Field(default="OR", pattern="^(AND|OR)$")


@router.post("/signals")
async def preview_buy_signals(payload: SignalsRequest) -> dict[str, object]:
    """Scan data and return all dates where buy conditions fire (no trades executed)."""
    frame = await run_in_threadpool(fetch_stock, payload.symbol, payload.period)

    if "Close" not in frame.columns:
        return {"symbol": payload.symbol.upper(), "signals": []}

    normalized = frame.copy()
    if "Date" not in normalized.columns:
        normalized = normalized.reset_index().rename(columns={"index": "Date"})

    normalized["Date"] = pd.to_datetime(normalized["Date"], errors="coerce")
    normalized["Close"] = pd.to_numeric(normalized["Close"], errors="coerce")
    normalized = normalized.dropna(subset=["Date", "Close"]).reset_index(drop=True)

    closes = normalized["Close"].astype(float).tolist()
    highs = normalized["High"].astype(float).tolist() if "High" in normalized.columns else closes
    lows = normalized["Low"].astype(float).tolist() if "Low" in normalized.columns else closes
    opens = normalized["Open"].astype(float).tolist() if "Open" in normalized.columns else closes
    volumes = normalized["Volume"].astype(float).tolist() if "Volume" in normalized.columns else [0] * len(closes)
    candle_patterns = [
        detect_candle(opens[i], highs[i], lows[i], closes[i],
                       opens[i - 1] if i > 0 else None, highs[i - 1] if i > 0 else None,
                       lows[i - 1] if i > 0 else None, closes[i - 1] if i > 0 else None)
        for i in range(len(closes))
    ]

    short_values = compute_sma(closes, payload.short_window)
    long_values = compute_sma(closes, payload.long_window)
    sma10_values = compute_sma(closes, 10)
    ht_result2 = compute_halftrend_full(highs, lows, closes)
    halftrend_values = ht_result2["trend"]

    date_list = normalized["Date"].tolist()
    wst_dirs = weekly_supertrend(date_list, opens, highs, lows, closes)

    vol_boost = [False] * len(volumes)
    vol_ratio = [0.0] * len(volumes)
    for i in range(len(volumes)):
        start = max(0, i - 20)
        window = volumes[start:i]
        avg = sum(window) / len(window) if window else 0
        vol_boost[i] = (volumes[i] >= avg * 2) if avg > 0 else False
        vol_ratio[i] = (volumes[i] / avg) if avg > 0 else 0.0

    atr_values2 = compute_atr(highs, lows, closes, 14)
    atr_sma_values2 = compute_sma(atr_values2, 20)
    ema20_values2 = compute_ema(closes, 20)

    buy_fns = [get_buy_condition(name) for name in payload.buy_conditions]
    min_start = max(payload.short_window, payload.long_window)
    signals: list[dict[str, object]] = []

    for idx in range(min_start, len(normalized)):
        prev_short = short_values[idx - 1]
        prev_long = long_values[idx - 1]
        cur_short = short_values[idx]
        cur_long = long_values[idx]

        if pd.isna(prev_short) or pd.isna(prev_long) or pd.isna(cur_short) or pd.isna(cur_long):
            continue

        price = float(closes[idx])
        cur_ht = halftrend_values[idx]
        prev_ht = halftrend_values[idx - 1] if idx > 0 else cur_ht

        buy_ctx = {
            "prev_short": float(prev_short),
            "prev_long": float(prev_long),
            "cur_short": float(cur_short),
            "cur_long": float(cur_long),
            "cur_sma10": float(sma10_values[idx]) if not pd.isna(sma10_values[idx]) else 0,
            "halftrend": cur_ht,
            "prev_halftrend": prev_ht,
            "price": price,
            "prev_close": float(closes[idx - 1]) if idx > 0 else 0,
            "prev_candle": candle_patterns[idx - 1] if idx > 0 else None,
            "prev_candle_high": float(highs[idx - 1]) if idx > 0 else 0,
            "prev_candle_low": float(lows[idx - 1]) if idx > 0 else 0,
            "prev_vol_ratio": vol_ratio[idx - 1] if idx > 0 else 0.0,
            "cur_vol_ratio": vol_ratio[idx],
            "weekly_trend_up": wst_dirs[idx] == -1 if idx < len(wst_dirs) else False,
            "prev_weekly_trend_up": wst_dirs[idx - 1] == -1 if idx > 0 and idx - 1 < len(wst_dirs) else False,
            "prev_day_boost": vol_boost[idx - 1] if idx > 0 else False,
            "prev_day_high": float(highs[idx - 1]) if idx > 0 else 0,
            "prev_day_low": float(lows[idx - 1]) if idx > 0 else 0,
            "prev_day_vol": float(volumes[idx - 1]) if idx > 0 else 0,
            "prev_prev_day_vol": float(volumes[idx - 2]) if idx > 1 else 0,
            "cur_ema20": float(ema20_values2[idx]) if idx < len(ema20_values2) and not pd.isna(ema20_values2[idx]) else 0,
            "prev_ema20": float(ema20_values2[idx - 1]) if idx > 0 and idx - 1 < len(ema20_values2) and not pd.isna(ema20_values2[idx - 1]) else 0,
            "cur_atr": float(atr_values2[idx]) if idx < len(atr_values2) and not pd.isna(atr_values2[idx]) else 0,
            "cur_atr_sma": float(atr_sma_values2[idx]) if idx < len(atr_sma_values2) and not pd.isna(atr_sma_values2[idx]) else 0,
            "prev_atr": float(atr_values2[idx - 1]) if idx > 0 and not pd.isna(atr_values2[idx - 1]) else 0,
            "prev_atr_sma": float(atr_sma_values2[idx - 1]) if idx > 0 and idx - 1 < len(atr_sma_values2) and not pd.isna(atr_sma_values2[idx - 1]) else 0,
        }

        buy_match = all(fn(buy_ctx) for fn in buy_fns) if payload.buy_logic == "AND" else any(fn(buy_ctx) for fn in buy_fns)
        if buy_match:
            ts = normalized.iloc[idx]["Date"]
            cur_dir = wst_dirs[idx] if idx < len(wst_dirs) else 1
            prev_dir = wst_dirs[idx - 1] if idx > 0 and idx - 1 < len(wst_dirs) else cur_dir
            flip_up = prev_dir == 1 and cur_dir == -1
            flip_down = prev_dir == -1 and cur_dir == 1
            wst_label = "FLIP_UP" if flip_up else "FLIP_DOWN" if flip_down else ("UP" if cur_dir == -1 else "DOWN")
            ht_label = "Green" if cur_ht == 0 else "Red" if cur_ht == 1 else "—"
            signals.append({
                "date": str(ts)[:10],
                "price": round(price, 4),
                "wst": wst_label,
                "ht": ht_label,
                "rvol": round(vol_ratio[idx], 2),
                "vol_color": "green" if closes[idx] >= opens[idx] else "red",
                "candle_type": candle_patterns[idx] or "—",
            })

    return {"symbol": payload.symbol.upper(), "count": len(signals), "signals": signals}


# ── Quant Strategy Optimizer endpoint ─────────────────────────────────

class StrategyRequest(BaseModel):
    symbol: str = Field(default="AAPL", min_length=1, max_length=16)
    period: str = Field(default="5y")
    capital: float = Field(default=100000.0, gt=0)
    start_year: int = Field(default=2015, ge=1990, le=2030)


@router.post("/strategy")
async def run_strategy_optimizer(payload: StrategyRequest) -> dict[str, object]:
    """Run EMA+RSI+Supertrend+Volume strategy w/ grid-search optimization."""
    from strategy_backtest import run_backtest as strat_backtest, optimize as strat_optimize, StrategyParams, equity_curve

    frame = await run_in_threadpool(fetch_stock, payload.symbol, payload.period)
    if "Close" not in frame.columns:
        raise HTTPException(status_code=400, detail="No data for this symbol/period")

    normalized = frame.copy()
    if "Date" not in normalized.columns:
        normalized = normalized.reset_index().rename(columns={"index": "Date"})
    normalized["Date"] = pd.to_datetime(normalized["Date"], errors="coerce")
    normalized = normalized.dropna(subset=["Date", "Close"]).reset_index(drop=True)

    data = []
    for _, row in normalized.iterrows():
        try:
            data.append({
                "date": str(row["Date"])[:10],
                "open": float(row.get("Open", row["Close"])),
                "high": float(row.get("High", row["Close"])),
                "low": float(row.get("Low", row["Close"])),
                "close": float(row["Close"]),
                "volume": float(row.get("Volume", 0)),
            })
        except (ValueError, TypeError):
            continue

    if len(data) < 100:
        raise HTTPException(status_code=400, detail="Not enough data for strategy optimization")

    def _run():
        return strat_optimize(data, payload.capital, payload.start_year, top_n=5)

    top_results = await run_in_threadpool(_run)

    if not top_results:
        return {
            "symbol": payload.symbol.upper(),
            "best_params": {},
            "metrics": {},
            "trades": [],
            "equity_curve": [],
            "top_results": [],
        }

    best_score, best_params, best_metrics, best_trades = top_results[0]
    curve = equity_curve(best_trades, payload.capital)

    return {
        "symbol": payload.symbol.upper(),
        "best_params": best_params,
        "metrics": best_metrics,
        "trades": [
            {
                "entry_date": t.entry_date,
                "exit_date": t.exit_date,
                "entry_price": t.entry_price,
                "exit_price": t.exit_price,
                "pnl_pct": t.pnl_pct,
                "pnl_dollar": t.pnl_dollar,
                "bars_held": t.bars_held,
                "exit_reason": t.exit_reason,
            }
            for t in best_trades
        ],
        "equity_curve": [{"date": c[0], "equity": c[1]} for c in curve],
        "top_results": [
            {
                "rank": i + 1,
                "params": kw,
                "metrics": m,
            }
            for i, (score, kw, m, _) in enumerate(top_results)
        ],
    }
