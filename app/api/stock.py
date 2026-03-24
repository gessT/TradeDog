from datetime import datetime, timezone
import logging

from fastapi import APIRouter, HTTPException
from fastapi.concurrency import run_in_threadpool
import pandas as pd
import yfinance as yf

from app.core.config import get_settings
from app.services.data_collector import fetch_stock
from app.services.redis_client import redis_service
from app.utils.indicators import ema

logger = logging.getLogger(__name__)

router = APIRouter()
settings = get_settings()
SMOOTHING_WINDOW = 20

# ── Major Bursa Malaysia (KLCI + popular) stocks ─────────────────────
BURSA_STOCKS: dict[str, str] = {
    "1155.KL": "Maybank",
    "1295.KL": "Public Bank",
    "6888.KL": "CIMB",
    "5347.KL": "Tenaga",
    "3182.KL": "Genting Bhd",
    "4715.KL": "Genting Malaysia",
    "1082.KL": "Hong Leong",
    "5183.KL": "Petronas Chem",
    "5681.KL": "Petronas Dagangan",
    "4863.KL": "TM (Telekom)",
    "6012.KL": "Maxis",
    "6947.KL": "DiGi/CelcomDigi",
    "1023.KL": "CIMB Group",
    "5296.KL": "Petronas Gas",
    "4065.KL": "PPB Group",
    "2445.KL": "KLK",
    "5225.KL": "IHH Healthcare",
    "4197.KL": "Sime Darby",
    "4677.KL": "YTL Corp",
    "6742.KL": "YTL Power",
    "5285.KL": "SD Plantation",
    "1961.KL": "IOI Corp",
    "3816.KL": "MISC",
    "5819.KL": "Hong Leong Bank",
    "1066.KL": "RHB Bank",
    "8869.KL": "Press Metal",
    "7084.KL": "QL Resources",
    "5168.KL": "Hartalega",
    "7113.KL": "Top Glove",
    "7153.KL": "Kossan Rubber",
    "6399.KL": "Atlas Corp",
    "5218.KL": "Sapura Energy",
    "6033.KL": "Petronas Gas",
    "4707.KL": "Nestle MY",
    "3476.KL": "AEON Co",
    "5235.KL": "KLCC Stapled",
    "2828.KL": "Sam Eng",
    "7052.KL": "Padini",
    "5014.KL": "MPI",
    "0166.KL": "Inari Amertron",
    "5264.KL": "Vitrox",
    "7033.KL": "MRDIY",
    "5398.KL": "Gamuda",
    "1015.KL": "AMMB",
    "7164.KL": "MBM Resources",
    "6888.KL": "CIMB",
    "3867.KL": "Axiata",
    "5168.KL": "Hartalega",
    "1562.KL": "Berjaya Corp",
}


def _normalize_column_name(column: object) -> str:
    if isinstance(column, tuple):
        parts = [str(part) for part in column if part not in (None, "")]
        for candidate in ("Datetime", "Date", "Open", "High", "Low", "Close", "Adj Close", "Volume"):
            if candidate in parts:
                return candidate
        return parts[0] if parts else ""
    return str(column)


def _to_float(value: object) -> float | None:
    if value is None or pd.isna(value):
        return None
    return float(value)


def _to_int(value: object) -> int | None:
    if value is None or pd.isna(value):
        return None
    return int(value)


def _latest_close(frame) -> float:
    if "Close" in frame.columns:
        return float(frame["Close"].iloc[-1])

    for column in frame.columns:
        if isinstance(column, tuple) and column[0] == "Close":
            return float(frame[column].iloc[-1])

    raise ValueError("Close price not found in market data")


def _serialize_rows(frame: pd.DataFrame) -> list[dict[str, object]]:
    normalized = frame.reset_index().copy()
    normalized.columns = [_normalize_column_name(column) for column in normalized.columns]

    time_column = "Datetime" if "Datetime" in normalized.columns else "Date"
    if time_column in normalized.columns:
        normalized[time_column] = normalized[time_column].astype(str)

    closes = [
        float(value)
        for value in pd.to_numeric(normalized.get("Close"), errors="coerce").ffill().fillna(0.0).tolist()
    ]
    smoothed = ema(closes, SMOOTHING_WINDOW)

    rows: list[dict[str, object]] = []
    for index, (_, record) in enumerate(normalized.iterrows()):
        rows.append(
            {
                "time": str(record.get(time_column, "-")),
                "open": _to_float(record.get("Open")),
                "high": _to_float(record.get("High")),
                "low": _to_float(record.get("Low")),
                "close": _to_float(record.get("Close")),
                "volume": _to_int(record.get("Volume")),
                "raw_close": _to_float(record.get("Close")),
                "smoothed_close": float(smoothed[index]) if index < len(smoothed) else None,
            }
        )

    return rows


# ── Near All-Time High Scanner ──────────────────────────────────────

def _scan_single_stock(code: str, name: str) -> dict | None:
    """Fetch max history for one stock and return ATH info, or None on failure."""
    try:
        ticker = yf.Ticker(code)
        hist = ticker.history(period="max", auto_adjust=False)
        if hist is None or hist.empty or len(hist) < 20:
            return None

        # Normalize columns
        cols = hist.columns
        if isinstance(cols[0], tuple):
            hist.columns = [c[0] if isinstance(c, tuple) else str(c) for c in cols]

        if "Close" not in hist.columns or "High" not in hist.columns:
            return None

        close_series = pd.to_numeric(hist["Close"], errors="coerce").dropna()
        high_series = pd.to_numeric(hist["High"], errors="coerce").dropna()
        if close_series.empty or high_series.empty:
            return None

        ath = float(high_series.max())
        current = float(close_series.iloc[-1])
        if ath <= 0:
            return None

        pct_from_ath = ((ath - current) / ath) * 100.0

        return {
            "symbol": code,
            "name": name,
            "current_price": round(current, 4),
            "ath_price": round(ath, 4),
            "pct_from_ath": round(pct_from_ath, 2),
            "data_points": len(hist),
        }
    except Exception as exc:
        logger.debug("ATH scan failed for %s: %s", code, exc)
        return None


@router.get("/near-ath")
async def near_ath(top: int = 10) -> dict:
    """Return top N Bursa Malaysia stocks nearest to their All-Time High."""
    import concurrent.futures

    top = min(max(top, 1), 50)

    def _scan_all() -> list[dict]:
        results: list[dict] = []
        with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
            futures = {
                pool.submit(_scan_single_stock, code, name): code
                for code, name in BURSA_STOCKS.items()
            }
            for fut in concurrent.futures.as_completed(futures):
                res = fut.result()
                if res is not None:
                    results.append(res)
        results.sort(key=lambda x: x["pct_from_ath"])
        return results[:top]

    stocks = await run_in_threadpool(_scan_all)

    return {
        "count": len(stocks),
        "scanned": len(BURSA_STOCKS),
        "stocks": stocks,
    }


# ── Unusual / Special Volume Scanner ────────────────────────────────

def _scan_volume(code: str, name: str, avg_days: int = 20) -> dict | None:
    """Compare today's volume to the N-day average. Return result or None."""
    try:
        ticker = yf.Ticker(code)
        hist = ticker.history(period="3mo", auto_adjust=False)
        if hist is None or hist.empty or len(hist) < avg_days + 1:
            return None

        cols = hist.columns
        if isinstance(cols[0], tuple):
            hist.columns = [c[0] if isinstance(c, tuple) else str(c) for c in cols]

        if "Volume" not in hist.columns or "Close" not in hist.columns:
            return None

        vol_series = pd.to_numeric(hist["Volume"], errors="coerce").dropna()
        close_series = pd.to_numeric(hist["Close"], errors="coerce").dropna()
        if len(vol_series) < avg_days + 1:
            return None

        today_vol = float(vol_series.iloc[-1])
        avg_vol = float(vol_series.iloc[-(avg_days + 1):-1].mean())
        if avg_vol <= 0:
            return None

        vol_ratio = today_vol / avg_vol
        current_price = float(close_series.iloc[-1])
        prev_close = float(close_series.iloc[-2]) if len(close_series) >= 2 else current_price
        change_pct = ((current_price - prev_close) / prev_close * 100) if prev_close > 0 else 0.0

        return {
            "symbol": code,
            "name": name,
            "current_price": round(current_price, 4),
            "change_pct": round(change_pct, 2),
            "today_volume": int(today_vol),
            "avg_volume": int(avg_vol),
            "vol_ratio": round(vol_ratio, 2),
        }
    except Exception as exc:
        logger.debug("Volume scan failed for %s: %s", code, exc)
        return None


@router.get("/top-volume")
async def top_volume(top: int = 10) -> dict:
    """Return top N Bursa Malaysia stocks with highest volume ratio (today vs 20-day avg)."""
    import concurrent.futures

    top = min(max(top, 1), 50)

    def _scan_all() -> list[dict]:
        results: list[dict] = []
        with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
            futures = {
                pool.submit(_scan_volume, code, name): code
                for code, name in BURSA_STOCKS.items()
            }
            for fut in concurrent.futures.as_completed(futures):
                res = fut.result()
                if res is not None and res["vol_ratio"] >= 0.5:
                    results.append(res)
        results.sort(key=lambda x: x["vol_ratio"], reverse=True)
        return results[:top]

    stocks = await run_in_threadpool(_scan_all)

    return {
        "count": len(stocks),
        "scanned": len(BURSA_STOCKS),
        "stocks": stocks,
    }
async def get_stock(symbol: str) -> dict[str, object]:
    try:
        data = await run_in_threadpool(fetch_stock, symbol)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    rows = _serialize_rows(data)

    try:
        latest_price = _latest_close(data)
    except ValueError:
        latest_price = 0.0

    latest_smoothed = 0.0
    if rows and rows[-1]["smoothed_close"] is not None:
        latest_smoothed = float(rows[-1]["smoothed_close"])

    quote = {
        "symbol": symbol.upper(),
        "price": latest_price,
        "smoothed_price": latest_smoothed,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }
    await redis_service.publish_json(settings.quote_channel, quote)

    return {
        "symbol": symbol.upper(),
        "latest": quote,
        "meta": {
            "source": "dummy-yfinance-json",
            "smoothing": "ema",
            "window": SMOOTHING_WINDOW,
            "points": len(rows),
        },
        "data": rows,
    }


