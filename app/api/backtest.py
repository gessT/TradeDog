from datetime import date, datetime

import pandas as pd
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, Field
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.db.database import get_db
from app.models.backtest_trade import BacktestTrade
from app.services.data_collector import fetch_stock
from app.strategies.sma_indicator import ema, sma5 as compute_sma5


router = APIRouter(prefix="/backtest", tags=["backtest"])


class BacktestRequest(BaseModel):
    symbol: str = Field(default="AAPL", min_length=1, max_length=16)
    quantity: float = Field(default=1.0, gt=0)
    short_window: int = Field(default=5, ge=2, le=100)
    long_window: int = Field(default=20, ge=3, le=300)
    start_date: date | None = Field(default=None, description="Only use data from this date onward (YYYY-MM-DD)")


def _cross_up(prev_short: float, prev_long: float, cur_short: float, cur_long: float) -> bool:
    return prev_short <= prev_long and cur_short > cur_long


def _cross_down(prev_short: float, prev_long: float, cur_short: float, cur_long: float) -> bool:
    return prev_short >= prev_long and cur_short < cur_long


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

    if payload.start_date is not None:
        normalized = normalized[normalized["Date"] >= pd.Timestamp(payload.start_date)].reset_index(drop=True)

    closes = normalized["Close"].astype(float).tolist()
    short_values = ema(closes, payload.short_window)
    long_values = ema(closes, payload.long_window)
    sma5_values = compute_sma5(closes)

    min_start = max(payload.short_window, payload.long_window)
    open_trade: dict[str, object] | None = None
    trades: list[dict[str, object]] = []

    max_trades = 50

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

        if open_trade is None:
            if _cross_up(float(prev_short), float(prev_long), float(cur_short), float(cur_long)):
                open_trade = {
                    "buy_price": price,
                    "buy_time": ts,
                    "buy_index": idx,
                    "buy_criteria": "ema_cross_up",
                    "buy_sma5": float(sma5_values[idx]) if not pd.isna(sma5_values[idx]) else None,
                }
            continue

        if not _cross_down(float(prev_short), float(prev_long), float(cur_short), float(cur_long)):
            continue

        buy_price = float(open_trade["buy_price"])
        reason = "ema_cross_down"

        pnl = (price - buy_price) * payload.quantity
        return_pct = (price - buy_price) / buy_price
        bars_held = idx - int(open_trade["buy_index"])

        db.add(
            BacktestTrade(
                symbol=symbol,
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
                note=f"ema_short={payload.short_window}, ema_long={payload.long_window}",
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
                "quantity": payload.quantity,
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
        pnl = (last_price - buy_price) * payload.quantity
        return_pct = (last_price - buy_price) / buy_price
        bars_held = (len(normalized) - 1) - int(open_trade["buy_index"])

        db.add(
            BacktestTrade(
                symbol=symbol,
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
                note=f"ema_short={payload.short_window}, ema_long={payload.long_window}",
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
                "quantity": payload.quantity,
                "bars_held": bars_held,
                "buy_criteria": open_trade["buy_criteria"],
                "sell_criteria": "end_of_data",
                "buy_sma5": open_trade["buy_sma5"],
                "sell_sma5": float(sma5_values[-1]) if not pd.isna(sma5_values[-1]) else None,
            }
        )

    wins = sum(1 for item in trades if float(item["pnl"]) > 0)
    net_pnl = sum(float(item["pnl"]) for item in trades)
    win_rate = (wins / len(trades)) if trades else 0.0

    return {
        "symbol": symbol,
        "reset": reset_before_run,
        "deleted_rows": deleted_rows,
        "criteria": {
            "buy": "EMA5 crosses above EMA20",
            "sell": "EMA5 crosses below EMA20",
            "short_window": payload.short_window,
            "long_window": payload.long_window,
        },
        "summary": {
            "count": len(trades),
            "wins": wins,
            "win_rate": win_rate,
            "net_pnl": net_pnl,
        },
        "trades": trades,
    }


@router.post("/run")
async def run_backtest(payload: BacktestRequest, db: Session = Depends(get_db)) -> dict[str, object]:
    frame = await run_in_threadpool(fetch_stock, payload.symbol)
    result = _execute_backtest(payload=payload, frame=frame, db=db, reset_before_run=False)

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
