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
from app.strategies.sma_indicator import sma as compute_sma, sma5 as compute_sma5, halftrend as compute_halftrend
from app.strategies.conditions import get_buy_condition, get_sell_condition, CONDITION_MAP, SELL_PAIR
from app.utils.indicators import detect_candle, weekly_supertrend


router = APIRouter(prefix="/backtest", tags=["backtest"])


class BacktestRequest(BaseModel):
    symbol: str = Field(default="AAPL", min_length=1, max_length=16)
    quantity: float = Field(default=1.0, gt=0)
    investment: float = Field(default=0.0, ge=0, description="USD amount per trade. If > 0, overrides quantity with investment/buy_price")
    short_window: int = Field(default=5, ge=2, le=100)
    long_window: int = Field(default=20, ge=3, le=300)
    start_date: date | None = Field(default=None, description="Only use data from this date onward (YYYY-MM-DD)")
    buy_conditions: list[str] = Field(default=["sma_cross_up"], description="Buy condition names")
    sell_conditions: list[str] = Field(default=["close_below_sma10"], description="Sell condition names")
    buy_logic: str = Field(default="OR", pattern="^(AND|OR)$", description="AND = all buy conditions must be true, OR = any one triggers")
    sell_logic: str = Field(default="OR", pattern="^(AND|OR)$", description="AND = all sell conditions must be true, OR = any one triggers")
    alignment_days: int = Field(default=3, ge=1, le=30, description="Min consecutive days SMA5>SMA10>SMA20 must hold")
    take_profit_pct: float = Field(default=2.0, ge=0, le=100, description="Take profit percentage (e.g. 2.0 = 2%)")
    stop_loss_pct: float = Field(default=5.0, ge=0, le=100, description="Trailing stop loss percentage (e.g. 5.0 = 5%)")
    sma_sell_period: int = Field(default=10, ge=2, le=200, description="SMA period for 'Close below SMA' sell condition")


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
    highs = normalized["High"].astype(float).tolist() if "High" in normalized.columns else closes
    lows = normalized["Low"].astype(float).tolist() if "Low" in normalized.columns else closes
    opens = normalized["Open"].astype(float).tolist() if "Open" in normalized.columns else closes
    candle_patterns = [detect_candle(opens[i], highs[i], lows[i], closes[i]) for i in range(len(closes))]
    short_values = compute_sma(closes, payload.short_window)
    long_values = compute_sma(closes, payload.long_window)
    sma5_values = compute_sma5(closes)
    sma10_values = compute_sma(closes, 10)
    sma_sell_values = compute_sma(closes, payload.sma_sell_period) if payload.sma_sell_period != 10 else sma10_values
    halftrend_values = compute_halftrend(highs, lows, closes)

    # Weekly Supertrend: -1 = uptrend, 1 = downtrend
    date_list = normalized["Date"].tolist()
    wst_dirs = weekly_supertrend(date_list, opens, highs, lows, closes)

    buy_fns = [get_buy_condition(name) for name in payload.buy_conditions] if payload.buy_conditions else [get_buy_condition("sma_cross_up")]
    sell_names = payload.sell_conditions if payload.sell_conditions else ["close_below_sma10"]
    sell_fns = [get_sell_condition(name) for name in sell_names]

    # Pre-compute alignment streak: consecutive days SMA5 > SMA10 > SMA20
    alignment_streak = [0] * len(closes)
    for i in range(1, len(closes)):
        s5 = short_values[i] if not pd.isna(short_values[i]) else 0
        s10 = sma10_values[i] if not pd.isna(sma10_values[i]) else 0
        s20 = long_values[i] if not pd.isna(long_values[i]) else 0
        if s5 > s10 > s20:
            alignment_streak[i] = alignment_streak[i - 1] + 1
        else:
            alignment_streak[i] = 0

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
            "alignment_streak": alignment_streak[idx],
            "alignment_days": payload.alignment_days,
            "weekly_trend_up": wst_dirs[idx] == -1 if idx < len(wst_dirs) else False,
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
            "buy_price": float(open_trade["buy_price"]) if open_trade else 0,
            "highest_price": float(open_trade["highest_price"]) if open_trade else 0,
            "take_profit_pct": payload.take_profit_pct / 100,
            "stop_loss_pct": payload.stop_loss_pct / 100,
            "hammer_close": float(open_trade.get("hammer_close", 0)) if open_trade else 0,
            "weekly_trend_up": wst_dirs[idx] == -1 if idx < len(wst_dirs) else False,
        }

        if open_trade is None:
            buy_match = all(fn(buy_ctx) for fn in buy_fns) if payload.buy_logic == "AND" else any(fn(buy_ctx) for fn in buy_fns)
            if buy_match:
                buy_joiner = " && " if payload.buy_logic == "AND" else " || "
                open_trade = {
                    "buy_price": price,
                    "highest_price": price,
                    "hammer_close": float(closes[idx - 1]) if idx > 0 and candle_patterns[idx - 1] == "Inverted Hammer" else 0,
                    "buy_time": ts,
                    "buy_index": idx,
                    "buy_criteria": buy_joiner.join(payload.buy_conditions),
                    "buy_sma5": float(sma5_values[idx]) if not pd.isna(sma5_values[idx]) else None,
                }
            continue

        if price > open_trade["highest_price"]:
            open_trade["highest_price"] = price

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
    frame = await run_in_threadpool(fetch_stock, payload.symbol)
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
    alignment_days: int = Field(default=3, ge=1, le=30)
    sma_sell_period: int = Field(default=10, ge=2, le=200)


@router.get("/conditions/preferences")
def get_condition_preferences(db: Session = Depends(get_db)) -> dict[str, object]:
    """Return saved checked condition names and logic modes."""
    rows = db.query(ConditionPreference).filter(ConditionPreference.checked.is_(True)).all()
    buy_row = db.query(LogicPreference).filter(LogicPreference.key == "buy_logic").first()
    sell_row = db.query(LogicPreference).filter(LogicPreference.key == "sell_logic").first()
    align_row = db.query(LogicPreference).filter(LogicPreference.key == "alignment_days").first()
    sma_sell_row = db.query(LogicPreference).filter(LogicPreference.key == "sma_sell_period").first()
    return {
        "checked": [r.name for r in rows],
        "buy_logic": buy_row.value if buy_row else "OR",
        "sell_logic": sell_row.value if sell_row else "OR",
        "alignment_days": int(align_row.value) if align_row else 3,
        "sma_sell_period": int(sma_sell_row.value) if sma_sell_row else 10,
    }


@router.post("/conditions/preferences")
def save_condition_preferences(payload: ConditionPrefsPayload, db: Session = Depends(get_db)) -> dict[str, str]:
    """Save which conditions are currently checked and logic modes."""
    db.query(ConditionPreference).delete(synchronize_session=False)
    for name in payload.checked:
        if name in CONDITION_MAP:
            db.add(ConditionPreference(name=name, checked=True))
    # Upsert logic preferences
    for key, val in [("buy_logic", payload.buy_logic), ("sell_logic", payload.sell_logic), ("alignment_days", str(payload.alignment_days)), ("sma_sell_period", str(payload.sma_sell_period))]:
        existing = db.query(LogicPreference).filter(LogicPreference.key == key).first()
        if existing:
            existing.value = val
        else:
            db.add(LogicPreference(key=key, value=val))
    db.commit()
    return {"status": "ok"}


@router.delete("/conditions/preferences")
def reset_condition_preferences(db: Session = Depends(get_db)) -> dict[str, str]:
    """Reset condition preferences (delete all saved state)."""
    db.query(ConditionPreference).delete(synchronize_session=False)
    db.query(LogicPreference).delete(synchronize_session=False)
    db.commit()
    return {"status": "reset"}
