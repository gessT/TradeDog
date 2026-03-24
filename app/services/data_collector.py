import json
import csv
import io
import time
import urllib.parse
import urllib.request
from pathlib import Path

import pandas as pd
import yfinance as yf


SAMPLE_DATA_PATH = Path(__file__).resolve().parents[2] / "apple_stock.json"


def _load_sample_stock() -> pd.DataFrame | None:
    if not SAMPLE_DATA_PATH.exists():
        return None

    payload = json.loads(SAMPLE_DATA_PATH.read_text(encoding="utf-8"))
    frame = pd.DataFrame(payload.get("data", []))
    if frame.empty:
        return None

    frame["Date"] = pd.to_datetime(frame["Date"], errors="coerce")
    for column in ("Open", "High", "Low", "Close", "Volume"):
        frame[column] = pd.to_numeric(frame[column], errors="coerce")

    return frame.dropna(subset=["Date"])


def _normalize_frame(frame: pd.DataFrame) -> pd.DataFrame:
    normalized = frame.copy()
    normalized.columns = [str(col) if not isinstance(col, tuple) else str(col[0]) for col in normalized.columns]

    if "Date" not in normalized.columns and normalized.index.name:
        normalized = normalized.reset_index()

    if "Date" in normalized.columns:
        normalized["Date"] = pd.to_datetime(normalized["Date"], errors="coerce")
        if hasattr(normalized["Date"].dt, "tz") and normalized["Date"].dt.tz is not None:
            normalized["Date"] = normalized["Date"].dt.tz_localize(None)

    for column in ("Open", "High", "Low", "Close", "Volume"):
        if column in normalized.columns:
            normalized[column] = pd.to_numeric(normalized[column], errors="coerce")

    keep_cols = [col for col in ["Date", "Open", "High", "Low", "Close", "Volume"] if col in normalized.columns]
    cleaned = normalized[keep_cols].dropna(subset=["Close"]) if "Close" in normalized.columns else normalized
    return cleaned


def _fetch_from_yfinance(symbol: str, retries: int = 3) -> pd.DataFrame | None:
    for attempt in range(retries):
        try:
            ticker = yf.Ticker(symbol)
            data = ticker.history(period="5y", auto_adjust=False)
        except Exception:
            if attempt < retries - 1:
                time.sleep(2 ** attempt)
                continue
            return None

        if data is not None and not data.empty:
            normalized = _normalize_frame(data)
            return normalized if not normalized.empty else None

        if attempt < retries - 1:
            time.sleep(2 ** attempt)

    return None


def _is_us_symbol(symbol: str) -> bool:
    return "." not in symbol


def _fetch_from_stooq(symbol: str) -> pd.DataFrame | None:
    if not _is_us_symbol(symbol):
        return None
    ticker = f"{symbol.lower()}.us"
    url = f"https://stooq.com/q/d/l/?s={urllib.parse.quote(ticker)}&i=d"

    try:
        raw = urllib.request.urlopen(url, timeout=15).read().decode("utf-8")
    except Exception:
        return None

    rows = list(csv.DictReader(io.StringIO(raw)))
    if not rows:
        return None

    frame = pd.DataFrame(rows)
    normalized = _normalize_frame(frame)
    return normalized if not normalized.empty else None


def fetch_stock(symbol: str) -> pd.DataFrame:
    normalized_symbol = symbol.upper().strip()

    # Prefer local sample data for AAPL (full history, not limited to 1 month)
    if normalized_symbol == "AAPL":
        sample = _load_sample_stock()
        if sample is not None:
            return sample

    yfinance_data = _fetch_from_yfinance(normalized_symbol)
    if yfinance_data is not None:
        return yfinance_data

    stooq_data = _fetch_from_stooq(normalized_symbol)
    if stooq_data is not None:
        return stooq_data

    raise ValueError(f"No market data available for {normalized_symbol}")