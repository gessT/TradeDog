from datetime import datetime

import pandas as pd
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, Field
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.db.database import get_db
from app.models.backtest_trade import BacktestTrade
from app.services.data_collector import fetch_stock
from app.utils.indicators import sma


router = APIRouter(prefix="/backtest", tags=["backtest"])


class BacktestRequest(BaseModel):
    symbol: str = Field(default="AAPL", min_length=1, max_length=16)
    quantity: float = Field(default=1.0, gt=0)
    short_window: int = Field(default=5, ge=2, le=100)
    long_window: int = Field(default=20, ge=3, le=300)
    stop_loss_pct: float = Field(default=0.03, gt=0, lt=1)
    take_profit_pct: float = Field(default=0.06, gt=0, lt=2)


def _cross_up(prev_short: float, prev_long: float, cur_short: float, cur_long: float) -> bool:
    return prev_short <= prev_long and cur_short > cur_long


def _cross_down(prev_short: float, prev_long: float, cur_short: float, cur_long: float) -> bool:
    return prev_short >= prev_long and cur_short < cur_long


@router.post("/run")
async def run_backtest(payload: BacktestRequest, db: Session = Depends(get_db)) -> dict[str, object]:
    frame = await run_in_threadpool(fetch_stock, payload.symbol)

    if "Close" not in frame.columns:
        return {"symbol": payload.symbol.upper(), "trades": [], "summary": {"count": 0, "net_pnl": 0.0}}

    normalized = frame.copy()
    if "Date" not in normalized.columns:
        normalized = normalized.reset_index().rename(columns={"index": "Date"})

    normalized["Date"] = pd.to_datetime(normalized["Date"], errors="coerce")
    normalized["Close"] = pd.to_numeric(normalized["Close"], errors="coerce")
    normalized = normalized.dropna(subset=["Date", "Close"]).reset_index(drop=True)

    closes = normalized["Close"].astype(float).tolist()
    short_values = sma(closes, payload.short_window)
    long_values = sma(closes, payload.long_window)

    min_start = max(payload.short_window, payload.long_window)
    open_trade: dict[str, object] | None = None
    trades: list[dict[str, object]] = []

    for idx in range(min_start, len(normalized)):
        prev_short = short_values[idx - 1]
        prev_long = long_values[idx - 1]
        cur_short = short_values[idx]
        cur_long = long_values[idx]

        if pd.isna(prev_short) or pd.isna(prev_long) or pd.isna(cur_short) or pd.isna(cur_long):
            continue

        price = float(closes[idx])
        ts = normalized.iloc[idx]["Date"]

        if open_trade is None:
            if _cross_up(float(prev_short), float(prev_long), float(cur_short), float(cur_long)):
                open_trade = {
                    "buy_price": price,
                    "buy_time": ts,
                    "buy_index": idx,
                    "buy_criteria": "sma_cross_up",
                }
            continue

        buy_price = float(open_trade["buy_price"])
        stop_price = buy_price * (1 - payload.stop_loss_pct)
        take_price = buy_price * (1 + payload.take_profit_pct)

        reason = ""
        if price <= stop_price:
            reason = "stop_loss"
        elif price >= take_price:
            reason = "take_profit"
        elif _cross_down(float(prev_short), float(prev_long), float(cur_short), float(cur_long)):
            reason = "sma_cross_down"

        if not reason:
            continue

        pnl = (price - buy_price) * payload.quantity
        return_pct = (price - buy_price) / buy_price
        bars_held = idx - int(open_trade["buy_index"])

        trade_row = BacktestTrade(
            symbol=payload.symbol.upper(),
            quantity=payload.quantity,
            buy_price=buy_price,
            sell_price=price,
            buy_time=open_trade["buy_time"],
            sell_time=ts,
            pnl=pnl,
            return_pct=return_pct,
            bars_held=bars_held,
            buy_criteria=str(open_trade["buy_criteria"]),
            sell_criteria=reason,
            note=f"short={payload.short_window}, long={payload.long_window}",
        )
        db.add(trade_row)

        trades.append(
            {
                "symbol": payload.symbol.upper(),
                "buy_time": str(open_trade["buy_time"]),
                "sell_time": str(ts),
                "buy_price": buy_price,
                "sell_price": price,
                "pnl": pnl,
                "return_pct": return_pct,
                "quantity": payload.quantity,
                "bars_held": bars_held,
                "buy_criteria": open_trade["buy_criteria"],
                "sell_criteria": reason,
            }
        )
        open_trade = None

    # Force close the last open position at the last bar so every buy has a sell record.
    if open_trade is not None and len(normalized) > 0:
        last_price = float(closes[-1])
        last_time = normalized.iloc[-1]["Date"]
        buy_price = float(open_trade["buy_price"])
        pnl = (last_price - buy_price) * payload.quantity
        return_pct = (last_price - buy_price) / buy_price
        bars_held = (len(normalized) - 1) - int(open_trade["buy_index"])

        trade_row = BacktestTrade(
            symbol=payload.symbol.upper(),
            quantity=payload.quantity,
            buy_price=buy_price,
            sell_price=last_price,
            buy_time=open_trade["buy_time"],
            sell_time=last_time,
            pnl=pnl,
            return_pct=return_pct,
            bars_held=bars_held,
            buy_criteria=str(open_trade["buy_criteria"]),
            sell_criteria="end_of_data",
            note=f"short={payload.short_window}, long={payload.long_window}",
        )
        db.add(trade_row)

        trades.append(
            {
                "symbol": payload.symbol.upper(),
                "buy_time": str(open_trade["buy_time"]),
                "sell_time": str(last_time),
                "buy_price": buy_price,
                "sell_price": last_price,
                "pnl": pnl,
                "return_pct": return_pct,
                "quantity": payload.quantity,
                "bars_held": bars_held,
                "buy_criteria": open_trade["buy_criteria"],
                "sell_criteria": "end_of_data",
            }
        )

    try:
        db.commit()
    except SQLAlchemyError as exc:
        db.rollback()
        raise HTTPException(status_code=503, detail=f"database write failed: {exc}") from exc

    wins = sum(1 for item in trades if float(item["pnl"]) > 0)
    net_pnl = sum(float(item["pnl"]) for item in trades)
    win_rate = (wins / len(trades)) if trades else 0.0

    return {
        "symbol": payload.symbol.upper(),
        "criteria": {
            "buy": "short_sma crosses above long_sma",
            "sell": "short_sma crosses below long_sma OR stop_loss OR take_profit",
            "short_window": payload.short_window,
            "long_window": payload.long_window,
            "stop_loss_pct": payload.stop_loss_pct,
            "take_profit_pct": payload.take_profit_pct,
        },
        "summary": {
            "count": len(trades),
            "wins": wins,
            "win_rate": win_rate,
            "net_pnl": net_pnl,
        },
        "trades": trades,
    }


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
