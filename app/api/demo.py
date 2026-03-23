import math

from fastapi import APIRouter, Query
from fastapi.concurrency import run_in_threadpool
import pandas as pd

from app.services.data_collector import fetch_stock
from app.strategies.sma_indicator import halftrend_full
from app.utils.indicators import ema


router = APIRouter(tags=["demo"])


@router.get("/demo")
async def demo(symbol: str = Query(default="AAPL")) -> list[dict[str, float | str | int | None]]:
    frame = await run_in_threadpool(fetch_stock, symbol)

    if "Date" in frame.columns:
        frame["Date"] = pd.to_datetime(frame["Date"], errors="coerce")
        frame = frame.dropna(subset=["Date"])
        cutoff = pd.Timestamp("2025-01-01")
        frame = frame[frame["Date"] >= cutoff].reset_index(drop=True)

    closes = frame["Close"].astype(float).tolist()
    highs = frame["High"].astype(float).tolist() if "High" in frame.columns else closes
    lows = frame["Low"].astype(float).tolist() if "Low" in frame.columns else closes
    opens = frame["Open"].astype(float).tolist() if "Open" in frame.columns else closes
    volumes = frame["Volume"].astype(float).tolist() if "Volume" in frame.columns else [0.0] * len(closes)
    ema_values = ema(closes, 10)

    ht_result = halftrend_full(highs, lows, closes)
    ht_values = ht_result["ht"]
    ht_trends = ht_result["trend"]

    rows: list[dict[str, float | str | int | None]] = []
    for index, (_, row) in enumerate(frame.iterrows()):
        ts = str(row["Date"]) if "Date" in frame.columns else str(row.name)
        ht_val = ht_values[index] if index < len(ht_values) and not math.isnan(ht_values[index]) else None
        ht_trend = ht_trends[index] if index < len(ht_trends) else None
        rows.append(
            {
                "time": ts,
                "price": float(row["Close"]),
                "open": opens[index] if index < len(opens) else None,
                "high": highs[index] if index < len(highs) else None,
                "low": lows[index] if index < len(lows) else None,
                "ema": float(ema_values[index]) if index < len(ema_values) else float(row["Close"]),
                "ht": ht_val,
                "ht_trend": ht_trend,
                "volume": int(volumes[index]) if index < len(volumes) else 0,
            }
        )

    return rows