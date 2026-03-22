from fastapi import APIRouter, Query
from fastapi.concurrency import run_in_threadpool
import pandas as pd

from app.services.data_collector import fetch_stock
from app.utils.indicators import ema


router = APIRouter(tags=["demo"])


@router.get("/demo")
async def demo(symbol: str = Query(default="AAPL")) -> list[dict[str, float | str]]:
    frame = await run_in_threadpool(fetch_stock, symbol)

    if "Date" in frame.columns:
        frame["Date"] = pd.to_datetime(frame["Date"], errors="coerce")
        frame = frame.dropna(subset=["Date"])
        cutoff = pd.Timestamp("2022-01-01")
        frame = frame[frame["Date"] >= cutoff].reset_index(drop=True)

    closes = frame["Close"].astype(float).tolist()
    ema_values = ema(closes, 10)

    rows: list[dict[str, float | str]] = []
    for index, (_, row) in enumerate(frame.iterrows()):
        ts = str(row["Date"]) if "Date" in frame.columns else str(row.name)
        rows.append(
            {
                "time": ts,
                "price": float(row["Close"]),
                "ema": float(ema_values[index]) if index < len(ema_values) else float(row["Close"]),
            }
        )

    return rows