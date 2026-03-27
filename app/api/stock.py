from __future__ import annotations

from datetime import datetime, timezone
import logging

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.concurrency import run_in_threadpool
import pandas as pd
from pydantic import BaseModel, Field
import requests as http_requests
from sqlalchemy.orm import Session
import yfinance as yf

from app.core.config import get_settings
from app.db.database import get_db
from app.models.stock import StockPreference
from app.services.data_collector import fetch_stock
from app.services.redis_client import redis_service
from app.utils.indicators import ema

logger = logging.getLogger(__name__)

router = APIRouter()
settings = get_settings()
SMOOTHING_WINDOW = 20


class StockConfigurationPayload(BaseModel):
    symbol: str = Field(default="5248.KL", min_length=1, max_length=16)
    period: str = Field(default="5y", min_length=1, max_length=16)


def _get_stock_pref_value(db: Session, key: str) -> str | None:
    row = db.query(StockPreference).filter(StockPreference.key == key).first()
    return row.value if row else None


def _upsert_stock_pref(db: Session, key: str, value: str) -> None:
    row = db.query(StockPreference).filter(StockPreference.key == key).first()
    if row:
        row.value = value
    else:
        db.add(StockPreference(key=key, value=value))

# ── Major Bursa Malaysia stocks (Yahoo Finance verified 2026) ────────
BURSA_STOCKS: dict[str, str] = {
    # FINANCE
    "1155.KL": "Maybank",
    "1295.KL": "Public Bank",
    "1023.KL": "CIMB",
    "5819.KL": "Hong Leong Bank",
    "1066.KL": "RHB Bank",
    "1082.KL": "Hong Leong Financial",
    "1015.KL": "Ambank",
    "5185.KL": "AFFIN Bank",
    "1163.KL": "Allianz Malaysia",
    "1818.KL": "Bursa Malaysia",
    # CONSUMER
    "4707.KL": "Nestle Malaysia",
    "7052.KL": "Padini",
    "6599.KL": "AEON Co",
    "5296.KL": "MR DIY",
    "4065.KL": "PPB Group",
    "3026.KL": "Dutch Lady",
    "3255.KL": "Heineken Malaysia",
    "3689.KL": "Fraser & Neave",
    "7084.KL": "QL Resources",
    "3182.KL": "Genting Bhd",
    "4715.KL": "Genting Malaysia",
    "1562.KL": "Sports Toto",
    "5248.KL": "Bermaz Auto",
    # TRANSPORTATION
    "3816.KL": "MISC",
    "5099.KL": "Capital A",
    "5246.KL": "Westports",
    "5983.KL": "MBM Resources",
    # TELECOMMUNICATIONS
    "4863.KL": "Telekom Malaysia",
    "6012.KL": "Maxis",
    "6947.KL": "CelcomDigi",
    "6888.KL": "Axiata",
    "0138.KL": "MyEG",
    # IND-PROD
    "8869.KL": "Press Metal",
    "4197.KL": "Sime Darby",
    "5168.KL": "Hartalega",
    "7113.KL": "Top Glove",
    "7153.KL": "Kossan Rubber",
    "3867.KL": "MPI",
    "5347.KL": "Tenaga Nasional",
    # HEALTH
    "5225.KL": "IHH Healthcare",
    "5878.KL": "KPJ Healthcare",
    "7081.KL": "Duopharma Biotech",
    # CONSTRUCTION
    "5398.KL": "Gamuda",
    "1171.KL": "Sunway Bhd",
    "3336.KL": "IJM Corp",
    "5263.KL": "Sunway Construction",
    "9679.KL": "WCT Holdings",
    # PROPERTIES
    "5235SS.KL": "KLCC Property",
    "1651.KL": "MRCB",
    "4677.KL": "YTL Corp",
    "5148.KL": "UEM Sunrise",
    "8664.KL": "SP Setia",
    "5053.KL": "OSK Holdings",
    "8583.KL": "Mah Sing",
    # TECHNOLOGY
    "0166.KL": "Inari Amertron",
    "0097.KL": "ViTrox",
    "0128.KL": "Frontken",
    "0208.KL": "Greatech",
    "5005.KL": "Unisem",
    # PLANTATION
    "2445.KL": "KLK",
    "5285.KL": "SD Guthrie",
    "1961.KL": "IOI Corp",
    "2291.KL": "Genting Plantations",
    "5126.KL": "Sarawak Oil Palms",
    "1899.KL": "Batu Kawan",
    "3034.KL": "Hap Seng",
    # ENERGY
    "5183.KL": "Petronas Chemicals",
    "5681.KL": "Petronas Dagangan",
    "6033.KL": "Petronas Gas",
    "5209.KL": "Gas Malaysia",
    # UTILITIES
    "6742.KL": "YTL Power",
    "5264.KL": "Malakoff",
    "3069.KL": "Mega First",
    # REIT
    "5176.KL": "Sunway REIT",
    "5227.KL": "IGB REIT",
    "5212.KL": "Pavilion REIT",
    "5106.KL": "Axis REIT",
}

# ── Bursa Malaysia Official Sector Mapping (Yahoo Finance 2026) ──────
BURSA_SECTORS: dict[str, list[tuple[str, str]]] = {
    "FINANCE": [
        ("1155.KL", "Maybank"),
        ("1295.KL", "Public Bank"),
        ("1023.KL", "CIMB"),
        ("5819.KL", "Hong Leong Bank"),
        ("1066.KL", "RHB Bank"),
        ("1082.KL", "Hong Leong Financial"),
        ("1015.KL", "Ambank"),
        ("5185.KL", "AFFIN Bank"),
        ("1163.KL", "Allianz Malaysia"),
        ("1818.KL", "Bursa Malaysia"),
    ],
    "CONSUMER": [
        ("4707.KL", "Nestle Malaysia"),
        ("7052.KL", "Padini"),
        ("6599.KL", "AEON Co"),
        ("5296.KL", "MR DIY"),
        ("4065.KL", "PPB Group"),
        ("3026.KL", "Dutch Lady"),
        ("3255.KL", "Heineken Malaysia"),
        ("3689.KL", "Fraser & Neave"),
        ("3182.KL", "Genting Bhd"),
        ("4715.KL", "Genting Malaysia"),
        ("7084.KL", "QL Resources"),
        ("1562.KL", "Sports Toto"),
        ("5248.KL", "Bermaz Auto"),
    ],
    "TRANSPORTATION": [
        ("3816.KL", "MISC"),
        ("5099.KL", "Capital A"),
        ("5246.KL", "Westports"),
        ("5983.KL", "MBM Resources"),
    ],
    "TELECOMMUNICATIONS": [
        ("4863.KL", "Telekom Malaysia"),
        ("6012.KL", "Maxis"),
        ("6947.KL", "CelcomDigi"),
        ("6888.KL", "Axiata"),
        ("0138.KL", "MyEG"),
    ],
    "IND-PROD": [
        ("8869.KL", "Press Metal"),
        ("4197.KL", "Sime Darby"),
        ("5168.KL", "Hartalega"),
        ("7113.KL", "Top Glove"),
        ("7153.KL", "Kossan Rubber"),
        ("3867.KL", "MPI"),
        ("5347.KL", "Tenaga Nasional"),
    ],
    "HEALTH": [
        ("5225.KL", "IHH Healthcare"),
        ("5878.KL", "KPJ Healthcare"),
        ("7081.KL", "Duopharma Biotech"),
    ],
    "CONSTRUCTN": [
        ("5398.KL", "Gamuda"),
        ("1171.KL", "Sunway Bhd"),
        ("3336.KL", "IJM Corp"),
        ("5263.KL", "Sunway Construction"),
        ("9679.KL", "WCT Holdings"),
    ],
    "PROPERTIES": [
        ("5235SS.KL", "KLCC Property"),
        ("1651.KL", "MRCB"),
        ("4677.KL", "YTL Corp"),
        ("5148.KL", "UEM Sunrise"),
        ("8664.KL", "SP Setia"),
        ("5053.KL", "OSK Holdings"),
        ("8583.KL", "Mah Sing"),
    ],
    "TECHNOLOGY": [
        ("0166.KL", "Inari Amertron"),
        ("0097.KL", "ViTrox"),
        ("0128.KL", "Frontken"),
        ("0208.KL", "Greatech"),
        ("5005.KL", "Unisem"),
    ],
    "PLANTATION": [
        ("2445.KL", "KLK"),
        ("5285.KL", "SD Guthrie"),
        ("1961.KL", "IOI Corp"),
        ("2291.KL", "Genting Plantations"),
        ("5126.KL", "Sarawak Oil Palms"),
        ("1899.KL", "Batu Kawan"),
        ("3034.KL", "Hap Seng"),
    ],
    "ENERGY": [
        ("5183.KL", "Petronas Chemicals"),
        ("5681.KL", "Petronas Dagangan"),
        ("6033.KL", "Petronas Gas"),
        ("5209.KL", "Gas Malaysia"),
    ],
    "UTILITIES": [
        ("6742.KL", "YTL Power"),
        ("5264.KL", "Malakoff"),
        ("3069.KL", "Mega First"),
    ],
    "REIT": [
        ("5176.KL", "Sunway REIT"),
        ("5227.KL", "IGB REIT"),
        ("5212.KL", "Pavilion REIT"),
        ("5106.KL", "Axis REIT"),
    ],
}


@router.get("/configuration")
def get_stock_configuration(db: Session = Depends(get_db)) -> dict[str, str]:
    """Return persisted selected stock configuration for the dashboard."""
    return {
        "symbol": _get_stock_pref_value(db, "selected_symbol") or "5248.KL",
        "period": _get_stock_pref_value(db, "selected_period") or "5y",
    }


@router.post("/configuration")
def save_stock_configuration(payload: StockConfigurationPayload, db: Session = Depends(get_db)) -> dict[str, str]:
    """Save selected stock configuration for the dashboard."""
    _upsert_stock_pref(db, "selected_symbol", payload.symbol.upper())
    _upsert_stock_pref(db, "selected_period", payload.period)
    db.commit()
    return {"status": "ok"}


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


# ── Sector Momentum Scanner (TradingView) ────────────────────────────

TRADINGVIEW_SCANNER_URL = "https://scanner.tradingview.com/malaysia/scan"

# Yahoo Finance code → TradingView ticker name
YF_TO_TV: dict[str, str] = {
    # FINANCE
    "1155.KL": "MAYBANK", "1295.KL": "PBBANK", "1023.KL": "CIMB",
    "5819.KL": "HLBANK", "1066.KL": "RHBBANK", "1082.KL": "HLFG",
    "1015.KL": "AMBANK", "5185.KL": "AFFIN", "1163.KL": "ALLIANZ",
    "1818.KL": "BURSA",
    # CONSUMER
    "4707.KL": "NESTLE", "7052.KL": "PADINI", "6599.KL": "AEON",
    "5296.KL": "MRDIY", "4065.KL": "PPB", "3026.KL": "DLADY",
    "3255.KL": "HEIM", "3689.KL": "F&N", "7084.KL": "QL",
    "3182.KL": "GENTING", "4715.KL": "GENM", "1562.KL": "SPTOTO",
    "5248.KL": "BAUTO",
    # TRANSPORTATION
    "3816.KL": "MISC", "5099.KL": "CAPITALA", "5246.KL": "WPRTS",
    "5983.KL": "MBMR",
    # TELECOMMUNICATIONS
    "4863.KL": "TM", "6012.KL": "MAXIS", "6947.KL": "CDB",
    "6888.KL": "AXIATA", "0138.KL": "MYEG",
    # IND-PROD
    "8869.KL": "PMETAL", "4197.KL": "SIME", "5168.KL": "HARTA",
    "7113.KL": "TOPGLOV", "7153.KL": "KOSSAN", "3867.KL": "MPI",
    "5347.KL": "TENAGA",
    # HEALTH
    "5225.KL": "IHH", "5878.KL": "KPJ", "7081.KL": "DPHARMA",
    # CONSTRUCTION
    "5398.KL": "GAMUDA", "1171.KL": "SUNWAY", "3336.KL": "IJM",
    "5263.KL": "SUNCON", "9679.KL": "WCT",
    # PROPERTIES
    "5235SS.KL": "KLCC", "1651.KL": "MRCB", "4677.KL": "YTL",
    "5148.KL": "UEMS", "8664.KL": "SPSETIA", "5053.KL": "OSK",
    "8583.KL": "MAHSING",
    # TECHNOLOGY
    "0166.KL": "INARI", "0097.KL": "VITROX", "0128.KL": "FRONTKN",
    "0208.KL": "GREATEC", "5005.KL": "UNISEM",
    # PLANTATION
    "2445.KL": "KLK", "5285.KL": "SDG", "1961.KL": "IOICORP",
    "2291.KL": "GENP", "5126.KL": "SOP", "1899.KL": "BKAWAN",
    "3034.KL": "HAPSENG",
    # ENERGY
    "5183.KL": "PCHEM", "5681.KL": "PETDAG", "6033.KL": "PETGAS",
    "5209.KL": "GASMSIA",
    # UTILITIES
    "6742.KL": "YTLPOWR", "5264.KL": "MALAKOF", "3069.KL": "MFCB",
    # REIT
    "5176.KL": "SUNREIT", "5227.KL": "IGBREIT", "5212.KL": "PAVREIT",
    "5106.KL": "AXREIT",
}

# Reverse lookup: TradingView ticker → Yahoo Finance code
TV_TO_YF: dict[str, str] = {v: k for k, v in YF_TO_TV.items()}


def _fetch_tv_sector_data() -> list[dict]:
    """Fetch our specific stocks from TradingView scanner API in a single request."""
    tv_tickers = [f"MYX:{tv}" for tv in YF_TO_TV.values()]
    payload = {
        "columns": [
            "close", "change", "Perf.W", "Perf.1M",
            "name", "description", "SMA5", "SMA20",
        ],
        "symbols": {"tickers": tv_tickers},
    }
    resp = http_requests.post(
        TRADINGVIEW_SCANNER_URL,
        json=payload,
        headers={"Content-Type": "application/json"},
        timeout=30,
    )
    resp.raise_for_status()
    return resp.json().get("data", [])


@router.get("/sectors")
async def sector_overview() -> dict:
    """Return sector-level momentum overview using TradingView scanner API."""

    # Build lookup: TV ticker -> (sector, yf_code, name) from our mapping
    tv_lookup: dict[str, tuple[str, str, str]] = {}
    for sector, stocks_list in BURSA_SECTORS.items():
        for yf_code, name in stocks_list:
            tv_ticker = YF_TO_TV.get(yf_code)
            if tv_ticker:
                tv_lookup[tv_ticker] = (sector, yf_code, name)

    def _scan() -> dict[str, list[dict]]:
        tv_rows = _fetch_tv_sector_data()

        sector_results: dict[str, list[dict]] = {s: [] for s in BURSA_SECTORS}

        for row in tv_rows:
            # TradingView symbol format: "MYX:MAYBANK"
            tv_sym = row.get("s", "")
            tv_ticker = tv_sym.split(":")[-1] if ":" in tv_sym else tv_sym

            if tv_ticker not in tv_lookup:
                continue

            sector, yf_code, stock_name = tv_lookup[tv_ticker]
            vals = row.get("d", [])
            if len(vals) < 8:
                continue

            close = vals[0] or 0
            change_1d = vals[1] or 0    # already in % (e.g. +1.72)
            perf_w = vals[2] or 0       # already in % (e.g. -2.05)
            perf_1m = vals[3] or 0      # already in % (e.g. +77.37)
            sma5 = vals[6] or 0
            sma20 = vals[7] or 0

            sector_results[sector].append({
                "symbol": yf_code,
                "name": stock_name,
                "price": round(close, 4),
                "change_1d": round(change_1d, 2),
                "change_5d": round(perf_w, 2),
                "change_20d": round(perf_1m, 2),
                "sma5_above_sma20": sma5 > sma20 if sma5 and sma20 else False,
            })

        return sector_results

    raw = await run_in_threadpool(_scan)

    sectors: list[dict] = []
    for sector_name, stock_results in raw.items():
        if not stock_results:
            continue

        n = len(stock_results)
        avg_1d = sum(s["change_1d"] for s in stock_results) / n
        avg_5d = sum(s["change_5d"] for s in stock_results) / n
        avg_20d = sum(s["change_20d"] for s in stock_results) / n
        bullish_count = sum(1 for s in stock_results if s["sma5_above_sma20"])
        bearish_count = n - bullish_count
        green_count = sum(1 for s in stock_results if s["change_1d"] >= 0)

        # Determine overall sentiment
        if bullish_count > bearish_count and avg_5d > 0:
            sentiment = "bullish"
        elif bearish_count > bullish_count and avg_5d < 0:
            sentiment = "bearish"
        else:
            sentiment = "neutral"

        sectors.append({
            "sector": sector_name,
            "sentiment": sentiment,
            "avg_change_1d": round(avg_1d, 2),
            "avg_change_5d": round(avg_5d, 2),
            "avg_change_20d": round(avg_20d, 2),
            "bullish_count": bullish_count,
            "bearish_count": bearish_count,
            "green_today": green_count,
            "total_stocks": n,
            "stocks": sorted(stock_results, key=lambda x: x["change_1d"], reverse=True),
        })

    # Sort: bullish first, then by 5d change
    sectors.sort(key=lambda x: (-1 if x["sentiment"] == "bullish" else 1 if x["sentiment"] == "bearish" else 0, -x["avg_change_5d"]))

    return {
        "count": len(sectors),
        "total_stocks_scanned": sum(s["total_stocks"] for s in sectors),
        "sectors": sectors,
    }


# ── Sector Candlestick Chart ────────────────────────────────────────

def _fetch_sector_ohlcv(code: str, period: str) -> pd.DataFrame | None:
    """Fetch OHLCV for a single stock and return normalized DataFrame."""
    try:
        ticker = yf.Ticker(code)
        hist = ticker.history(period=period, auto_adjust=False)
        if hist is None or hist.empty:
            return None

        cols = hist.columns
        if isinstance(cols[0], tuple):
            hist.columns = [c[0] if isinstance(c, tuple) else str(c) for c in cols]

        required = {"Open", "High", "Low", "Close", "Volume"}
        if not required.issubset(set(hist.columns)):
            return None

        hist.index = pd.to_datetime(hist.index)
        for col in ["Open", "High", "Low", "Close", "Volume"]:
            hist[col] = pd.to_numeric(hist[col], errors="coerce")

        # Normalize prices to percentage change from first day (so we can average across stocks)
        first_close = hist["Close"].dropna().iloc[0]
        if first_close <= 0:
            return None

        hist["Open_pct"] = (hist["Open"] / first_close - 1) * 100
        hist["High_pct"] = (hist["High"] / first_close - 1) * 100
        hist["Low_pct"] = (hist["Low"] / first_close - 1) * 100
        hist["Close_pct"] = (hist["Close"] / first_close - 1) * 100

        return hist[["Open_pct", "High_pct", "Low_pct", "Close_pct", "Volume"]].copy()
    except Exception:
        return None


@router.get("/sector-chart")
async def sector_chart(
    sector: str = Query(..., description="Sector name"),
    period: str = Query(default="6mo"),
) -> dict:
    """Return synthetic OHLCV candles for a sector by averaging constituent stocks."""
    import concurrent.futures

    if sector not in BURSA_SECTORS:
        raise HTTPException(status_code=404, detail=f"Sector '{sector}' not found")

    stocks_list = BURSA_SECTORS[sector]

    def _collect() -> list[pd.DataFrame]:
        frames: list[pd.DataFrame] = []
        with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
            futures = {
                pool.submit(_fetch_sector_ohlcv, code, period): code
                for code, _ in stocks_list
            }
            for fut in concurrent.futures.as_completed(futures):
                df = fut.result()
                if df is not None and not df.empty:
                    frames.append(df)
        return frames

    frames = await run_in_threadpool(_collect)

    if not frames:
        raise HTTPException(status_code=404, detail="No data available for this sector")

    # Align all frames to the same date index and average
    combined = pd.concat(frames, axis=0)
    averaged = combined.groupby(combined.index).mean()
    averaged = averaged.sort_index()
    averaged = averaged.dropna()

    rows: list[dict] = []
    for ts, row in averaged.iterrows():
        rows.append({
            "time": str(ts.date()) if hasattr(ts, "date") else str(ts),
            "price": round(float(row["Close_pct"]), 4),
            "open": round(float(row["Open_pct"]), 4),
            "high": round(float(row["High_pct"]), 4),
            "low": round(float(row["Low_pct"]), 4),
            "ema": round(float(row["Close_pct"]), 4),
            "ht": None,
            "ht_trend": None,
            "volume": int(row["Volume"]),
        })

    return {
        "data": rows,
        "stock_name": f"{sector} (Sector Index)",
        "sector": sector,
        "constituents": len(frames),
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


# ── Daily Opportunity Scanner ─────────────────────────────────────────

def _compute_scan_ema(vals: list[float], n: int) -> list[float]:
    import math as _math
    out = [_math.nan] * len(vals)
    if len(vals) < n:
        return out
    k = 2 / (n + 1)
    out[n - 1] = sum(vals[:n]) / n
    for i in range(n, len(vals)):
        out[i] = vals[i] * k + out[i - 1] * (1 - k)
    return out


def _compute_scan_rsi(vals: list[float], n: int = 14) -> list[float]:
    out = [50.0] * len(vals)
    if len(vals) < n + 1:
        return out
    g, lo2 = 0.0, 0.0
    for i in range(1, n + 1):
        d = vals[i] - vals[i - 1]
        g += max(d, 0)
        lo2 += max(-d, 0)
    ag, al = g / n, lo2 / n
    out[n] = 100 - 100 / (1 + ag / al) if al else 100.0
    for i in range(n + 1, len(vals)):
        d = vals[i] - vals[i - 1]
        ag = (ag * (n - 1) + max(d, 0)) / n
        al = (al * (n - 1) + max(-d, 0)) / n
        out[i] = 100 - 100 / (1 + ag / al) if al else 100.0
    return out


def _compute_scan_atr(hv: list[float], lv: list[float], cv: list[float], n: int = 14) -> list[float]:
    import math as _math
    tr = [hv[0] - lv[0]] + [
        max(hv[i] - lv[i], abs(hv[i] - cv[i - 1]), abs(lv[i] - cv[i - 1]))
        for i in range(1, len(cv))
    ]
    out = [_math.nan] * len(cv)
    if len(cv) < n:
        return out
    out[n - 1] = sum(tr[:n]) / n
    for i in range(n, len(cv)):
        out[i] = (out[i - 1] * (n - 1) + tr[i]) / n
    return out


def _scan_daily_setup(code: str, name: str) -> dict | None:
    import math as _math
    try:
        tkr = yf.Ticker(code)
        hist = tkr.history(period="6mo", auto_adjust=True)
        if hist is None or hist.empty or len(hist) < 60:
            return None
        cols = hist.columns
        if isinstance(cols[0], tuple):
            hist.columns = [c[0] if isinstance(c, tuple) else str(c) for c in cols]
        for col in ("Open", "High", "Low", "Close", "Volume"):
            if col not in hist.columns:
                return None
            hist[col] = pd.to_numeric(hist[col], errors="coerce")
        hist = hist.dropna(subset=["Close"])
        cv = hist["Close"].tolist()
        hv = hist["High"].tolist()
        lv = hist["Low"].tolist()
        vv = hist["Volume"].tolist()

        e20 = _compute_scan_ema(cv, 20)
        e50 = _compute_scan_ema(cv, 50)
        e200 = _compute_scan_ema(cv, 200)
        rsi_vals = _compute_scan_rsi(cv)
        a14 = _compute_scan_atr(hv, lv, cv)

        ef = _compute_scan_ema(cv, 12)
        es2 = _compute_scan_ema(cv, 26)
        ml = [
            ef[i] - es2[i] if not (_math.isnan(ef[i]) or _math.isnan(es2[i])) else _math.nan
            for i in range(len(cv))
        ]
        clean = [x for x in ml if not _math.isnan(x)]
        hist_macd = [_math.nan] * len(cv)
        if len(clean) >= 9:
            start = next(i for i, x in enumerate(ml) if not _math.isnan(x))
            sl2 = [_math.nan] * len(cv)
            sl2[start + 8] = sum(clean[:9]) / 9
            k2 = 2 / 10
            for i in range(start + 9, len(cv)):
                sl2[i] = ml[i] * k2 + sl2[i - 1] * (1 - k2)
            hist_macd = [
                ml[i] - sl2[i] if not (_math.isnan(ml[i]) or _math.isnan(sl2[i])) else _math.nan
                for i in range(len(cv))
            ]

        st_dirs = [1] * len(cv)
        up_band = [
            ((hv[i] + lv[i]) / 2 - 3.0 * a14[i]) if not _math.isnan(a14[i]) else _math.nan
            for i in range(len(cv))
        ]
        dn_band = [
            ((hv[i] + lv[i]) / 2 + 3.0 * a14[i]) if not _math.isnan(a14[i]) else _math.nan
            for i in range(len(cv))
        ]
        for i in range(1, len(cv)):
            if _math.isnan(up_band[i]) or _math.isnan(dn_band[i]):
                continue
            up_band[i] = max(up_band[i], up_band[i - 1]) if cv[i - 1] > up_band[i - 1] else up_band[i]
            dn_band[i] = min(dn_band[i], dn_band[i - 1]) if cv[i - 1] < dn_band[i - 1] else dn_band[i]
            if st_dirs[i - 1] == 1 and cv[i] < up_band[i]:
                st_dirs[i] = -1
            elif st_dirs[i - 1] == -1 and cv[i] > dn_band[i]:
                st_dirs[i] = 1
            else:
                st_dirs[i] = st_dirs[i - 1]

        vol_window = vv[-21:-1]
        avg_vol = sum(vol_window) / len(vol_window) if vol_window else 0
        vr = round(vv[-1] / avg_vol, 2) if avg_vol > 0 else 0.0
        price = cv[-1]

        if any(_math.isnan(x) for x in [e20[-1], e50[-1], rsi_vals[-1], a14[-1]]):
            return None

        score = 0
        reasons: list[str] = []
        trend_up = price > e20[-1] and price > e50[-1]
        if trend_up:
            score += 1
            reasons.append("Price above EMA20 & EMA50")
        if e20[-1] > e50[-1]:
            score += 1
            reasons.append("EMA20 > EMA50 (aligned uptrend)")
        if not _math.isnan(e200[-1]) and price > e200[-1]:
            score += 1
            reasons.append("Above EMA200 (macro bull)")
        if st_dirs[-1] == 1:
            score += 2
            reasons.append("Supertrend bullish")
        if st_dirs[-1] == 1 and st_dirs[-2] == -1:
            score += 2
            reasons.append("Supertrend just flipped bullish \u26a1")
        rsi_cur = rsi_vals[-1]
        rsi_prev = rsi_vals[-2]
        if 45 < rsi_cur < 70:
            score += 1
            reasons.append(f"RSI {rsi_cur:.0f} (momentum zone)")
        if rsi_cur > 50 and rsi_prev <= 50:
            score += 1
            reasons.append("RSI crossed above 50 \u2191")
        if rsi_cur > rsi_prev and rsi_cur < 68:
            score += 1
            reasons.append("RSI rising")
        if not _math.isnan(hist_macd[-1]) and not _math.isnan(hist_macd[-2]):
            if hist_macd[-1] > 0:
                score += 1
                reasons.append("MACD histogram positive")
            if hist_macd[-1] > hist_macd[-2]:
                score += 1
                reasons.append("MACD histogram expanding")
        if vr >= 1.5:
            score += 1
            reasons.append(f"Volume {vr:.1f}x above average")
        if vr >= 2.5:
            score += 1
            reasons.append("Strong volume surge")
        pullback = e20[-1] <= price <= e20[-1] * 1.025
        if pullback:
            score += 2
            reasons.append("Pullback to EMA20 (dip-buy zone)")
        if cv[-1] > cv[-2] > cv[-4]:
            score += 1
            reasons.append("Higher lows forming")
        recent_high = max(hv[-21:-1])
        breakout = price > recent_high
        if breakout:
            score += 2
            reasons.append("Breakout above 20-day high \U0001f680")

        if score < 6 or not trend_up:
            return None

        if breakout:
            setup = "BREAKOUT"
            entry = round(price * 1.001, 3)
            sl_price = round(recent_high * 0.985, 3)
        elif pullback:
            setup = "PULLBACK"
            entry = round(e20[-1] * 1.002, 3)
            sl_price = round(e20[-1] - a14[-1] * 1.5, 3)
        else:
            setup = "TREND"
            support = lv[-1] * 0.97
            for i in range(len(lv) - 2, 10, -1):
                if lv[i] == min(lv[max(0, i - 10): i + 11]):
                    support = lv[i]
                    break
            sl_price = round(max(support, price - a14[-1] * 2.0), 3)
            entry = round(price, 3)

        risk = entry - sl_price
        if risk <= 0:
            return None
        tp1 = round(entry + risk * 1.5, 3)
        tp2 = round(entry + risk * 2.5, 3)
        chg_pct = round((cv[-1] - cv[-2]) / cv[-2] * 100, 2) if cv[-2] else 0.0
        return {
            "ticker": code, "name": name, "price": round(price, 3),
            "change_pct": chg_pct, "score": score, "setup": setup,
            "entry": entry, "sl": sl_price, "tp1": tp1, "tp2": tp2,
            "rr": round((tp1 - entry) / risk, 1),
            "rsi": round(rsi_cur, 1), "vol_ratio": vr,
            "reasons": reasons,
        }
    except Exception:
        return None


@router.get("/daily-scan")
async def daily_scan(top: int = Query(default=6, ge=1, le=20)) -> dict:
    """Scan all KLSE stocks and return today's highest-probability trade setups."""
    import concurrent.futures
    from datetime import datetime as _dt

    def _run() -> list[dict]:
        out: list[dict] = []
        with concurrent.futures.ThreadPoolExecutor(max_workers=10) as pool:
            futs = {
                pool.submit(_scan_daily_setup, code, nm): code
                for code, nm in BURSA_STOCKS.items()
            }
            for fut in concurrent.futures.as_completed(futs):
                res = fut.result()
                if res:
                    out.append(res)
        out.sort(key=lambda x: x["score"], reverse=True)
        return out

    setups = await run_in_threadpool(_run)
    return {
        "timestamp": _dt.now().strftime("%Y-%m-%d %H:%M"),
        "scanned": len(BURSA_STOCKS),
        "qualified": len(setups),
        "setups": setups[:top],
    }


