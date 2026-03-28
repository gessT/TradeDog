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
from app.utils.indicators import ema, rsi as compute_rsi, atr as compute_atr

logger = logging.getLogger(__name__)

router = APIRouter()
settings = get_settings()
SMOOTHING_WINDOW = 20


class StockConfigurationPayload(BaseModel):
    symbol: str = Field(default="5248.KL", min_length=1, max_length=16)
    period: str = Field(default="6mo", min_length=1, max_length=16)


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
    # FINANCE (15 — TradingView: Finance sector, Banks + Insurance)
    "1155.KL": "Maybank",
    "1295.KL": "Public Bank",
    "1023.KL": "CIMB",
    "5819.KL": "Hong Leong Bank",
    "1066.KL": "RHB Bank",
    "1015.KL": "Ambank",
    "1082.KL": "Hong Leong Financial",
    "2488.KL": "Alliance Bank",
    "1818.KL": "Bursa Malaysia",
    "5185.KL": "AFFIN Bank",
    "8621.KL": "LPI Capital",
    "1171.KL": "MBSB",
    "5258.KL": "Bank Islam",
    "TAKAFUL.KL": "Takaful Malaysia",
    "6459.KL": "MNRB Holdings",
    # CONSUMER (16 — TradingView: Consumer Non-Durables + Services + Retail)
    "5326.KL": "99 Speed Mart",
    "4707.KL": "Nestle Malaysia",
    "7084.KL": "QL Resources",
    "5296.KL": "MR DIY",
    "3689.KL": "Fraser & Neave",
    "4715.KL": "Genting Malaysia",
    "3182.KL": "Genting Bhd",
    "5337.KL": "Eco-Shop",
    "3255.KL": "Heineken Malaysia",
    "2836.KL": "Carlsberg",
    "5306.KL": "Farm Fresh",
    "4065.KL": "PPB Group",
    "5102.KL": "Guan Chong",
    "3026.KL": "Dutch Lady",
    "1562.KL": "Sports Toto",
    "7052.KL": "Padini",
    # TRANSPORTATION (15 — TradingView: Transportation)
    "3816.KL": "MISC",
    "5246.KL": "Westports",
    "5238.KL": "AirAsia X",
    "5032.KL": "Bintulu Port",
    "5099.KL": "Capital A",
    "5335.KL": "Hi Mobility",
    "5348.KL": "Orkim",
    "5908.KL": "DKSH Holdings",
    "5173.KL": "Shin Yang Group",
    "0078.KL": "GDEX",
    "2062.KL": "Harbour-Link",
    "SURIA.KL": "Suria Capital",
    "8397.KL": "Tiong Nam Logistics",
    "5303.KL": "Swift Haulage",
    "5983.KL": "MBM Resources",
    # TELECOMMUNICATIONS (14 — TradingView: Communications — full exchange coverage)
    "6947.KL": "CelcomDigi",
    "4863.KL": "Telekom Malaysia",
    "6012.KL": "Maxis",
    "6888.KL": "Axiata",
    "0138.KL": "Zetrix AI",
    "5332.KL": "Reach Ten",
    "REDTONE.KL": "REDtone Digital",
    "0129.KL": "Silver Ridge",
    "OCK.KL": "OCK Group",
    "0195.KL": "Binasat Communications",
    "0178.KL": "Sedania Innovator",
    "0165.KL": "XOX",
    "MNC.KL": "MNC Wireless",
    "0082.KL": "Green Packet",
    # IND-PROD (15 — TradingView: Producer Manufacturing)
    "8869.KL": "Press Metal",
    "0208.KL": "Greatech",
    "5292.KL": "UWC",
    "5168.KL": "Hartalega",
    "7153.KL": "Kossan Rubber",
    "5286.KL": "Mi Technovation",
    "7172.KL": "PMB Technology",
    "3565.KL": "WCE Holdings",
    "0225.KL": "Southern Cable",
    "7160.KL": "Pentamaster",
    "9822.KL": "SAM Engineering",
    "MSC.KL": "Malaysia Smelting",
    "6963.KL": "VS Industry",
    "0233.KL": "Pekat Group",
    "3867.KL": "MPI",
    # HEALTH (15 — TradingView: Health Services + Health Technology)
    "5225.KL": "IHH Healthcare",
    "5555.KL": "Sunway Healthcare",
    "5878.KL": "KPJ Healthcare",
    "7113.KL": "Top Glove",
    "5318.KL": "DXN Holdings",
    "7148.KL": "Duopharma Biotech",
    "0101.KL": "TMC Life Sciences",
    "0002.KL": "Kotra Industries",
    "7178.KL": "YSP Southeast Asia",
    "0222.KL": "Optimax Holdings",
    "0363.KL": "PMCK",
    "0329.KL": "Metro Healthcare",
    "0148.KL": "Sunzen Group",
    "0243.KL": "Cengild Medical",
    "0283.KL": "DC Healthcare",
    # CONSTRUCTN (15 — TradingView: Industrial Services, Engineering & Construction)
    "5211.KL": "Sunway Bhd",
    "5398.KL": "Gamuda",
    "5263.KL": "Sunway Construction",
    "3336.KL": "IJM Corp",
    "0151.KL": "Kelington Group",
    "7161.KL": "Kerjaya Prospek",
    "0215.KL": "Solarvest",
    "1651.KL": "MRCB",
    "0245.KL": "MN Holdings",
    "5320.KL": "Prolintas Infra",
    "0375.KL": "THMY Holdings",
    "0193.KL": "Kinergy Advancement",
    "5827.KL": "Oriental Interest",
    "8877.KL": "Ekovest",
    "9679.KL": "WCT Holdings",
    # PROPERTIES (15 — TradingView: Finance > Real Estate Development)
    "5249.KL": "IOI Properties",
    "5288.KL": "Sime Darby Property",
    "2429.KL": "Tanco Holdings",
    "8206.KL": "Eco World Development",
    "5053.KL": "OSK Holdings",
    "5200.KL": "UOA Development",
    "5606.KL": "IGB Bhd",
    "8664.KL": "SP Setia",
    "5038.KL": "KSL Holdings",
    "5401.KL": "Tropicana Corp",
    "8583.KL": "Mah Sing",
    "5236.KL": "Matrix Concepts",
    "5148.KL": "UEM Sunrise",
    "3417.KL": "Eastern & Oriental",
    "7179.KL": "Lagenda Properties",
    # TECHNOLOGY (15 — TradingView: Electronic Technology + Technology Services)
    "5031.KL": "TIME dotCom",
    "0097.KL": "ViTrox",
    "0128.KL": "Frontken",
    "0166.KL": "Inari Amertron",
    "5005.KL": "Unisem",
    "5340.KL": "UMS Integration",
    "7195.KL": "Binastra Corp",
    "5162.KL": "VSTECS",
    "0270.KL": "Nationgate",
    "7100.KL": "Uchi Technologies",
    "4456.KL": "DNEX",
    "5216.KL": "NEXG",
    "5302.KL": "Aurelius Technologies",
    "7233.KL": "Dufu Technology",
    "0045.KL": "Southern Score Builders",
    # PLANTATION (15 — TradingView: Process Industries, Agricultural Commodities)
    "5183.KL": "Petronas Chemicals",
    "5285.KL": "SD Guthrie",
    "1961.KL": "IOI Corp",
    "2445.KL": "KLK",
    "2089.KL": "United Plantations",
    "2291.KL": "Genting Plantations",
    "4731.KL": "Scientex",
    "5126.KL": "Sarawak Oil Palms",
    "1899.KL": "Batu Kawan",
    "3034.KL": "Hap Seng",
    "5323.KL": "Johor Plantations",
    "HEXTAR.KL": "Hextar Global",
    "LHI.KL": "Leong Hup International",
    "5027.KL": "Kim Loong Resources",
    "5029.KL": "Far East Holdings",
    # ENERGY (15 — TradingView: Energy Minerals + Industrial Services/Oilfield)
    "7277.KL": "Dialog Group",
    "5243.KL": "Velesto Energy",
    "5141.KL": "Dayang Enterprise",
    "5255.KL": "Lianson Fleet Group",
    "5210.KL": "Bumi Armada",
    "5199.KL": "Hibiscus Petroleum",
    "3042.KL": "Petron Malaysia",
    "4324.KL": "Hengyuan Refining",
    "5218.KL": "Vantris Energy",
    "5186.KL": "Malaysia Marine & Heavy Eng",
    "7228.KL": "T7 Global",
    "UZMA.KL": "Uzma",
    "5133.KL": "Petra Energy",
    "7293.KL": "Yinson Holdings",
    "0320.KL": "Steel Hawk",
    # UTILITIES (15 — TradingView: Utilities)
    "5347.KL": "Tenaga Nasional",
    "6033.KL": "Petronas Gas",
    "6742.KL": "YTL Power",
    "4677.KL": "YTL Corp",
    "5209.KL": "Gas Malaysia",
    "5264.KL": "Malakoff",
    "3069.KL": "Mega First",
    "5272.KL": "Ranhill Utilities",
    "8524.KL": "Taliworks",
    "5041.KL": "PBA Holdings",
    "5184.KL": "Cypark Resources",
    "5843.KL": "KP Selangor",
    "5614.KL": "NuEnergy Holdings",
    "6807.KL": "Puncak Niaga",
    "7471.KL": "Eden Inc",
    # REIT (15 — TradingView: Finance > Real Estate Investment Trusts)
    "5235SS.KL": "KLCC Property",
    "5227.KL": "IGB REIT",
    "5176.KL": "Sunway REIT",
    "5212.KL": "Pavilion REIT",
    "5106.KL": "Axis REIT",
    "5180.KL": "CapitaLand MY Trust",
    "5109.KL": "YTL REIT",
    "5338.KL": "Paradigm REIT",
    "5299.KL": "IGB Commercial REIT",
    "5116.KL": "Al-Aqar REIT",
    "5123.KL": "Sentral REIT",
    "5307.KL": "AME REIT",
    "5280.KL": "KIP REIT",
    "5110.KL": "UOA REIT",
    "5130.KL": "Atrium REIT",
}

# ── Bursa Malaysia Official Sector Mapping (Yahoo Finance 2026) ──────
BURSA_SECTORS: dict[str, list[tuple[str, str]]] = {
    "FINANCE": [
        ("1155.KL", "Maybank"),
        ("1295.KL", "Public Bank"),
        ("1023.KL", "CIMB"),
        ("5819.KL", "Hong Leong Bank"),
        ("1066.KL", "RHB Bank"),
        ("1015.KL", "Ambank"),
        ("1082.KL", "Hong Leong Financial"),
        ("2488.KL", "Alliance Bank"),
        ("1818.KL", "Bursa Malaysia"),
        ("5185.KL", "AFFIN Bank"),
        ("8621.KL", "LPI Capital"),
        ("1171.KL", "MBSB"),
        ("5258.KL", "Bank Islam"),
        ("TAKAFUL.KL", "Takaful Malaysia"),
        ("6459.KL", "MNRB Holdings"),
    ],
    "CONSUMER": [
        ("5326.KL", "99 Speed Mart"),
        ("4707.KL", "Nestle Malaysia"),
        ("7084.KL", "QL Resources"),
        ("5296.KL", "MR DIY"),
        ("3689.KL", "Fraser & Neave"),
        ("4715.KL", "Genting Malaysia"),
        ("3182.KL", "Genting Bhd"),
        ("5337.KL", "Eco-Shop"),
        ("3255.KL", "Heineken Malaysia"),
        ("2836.KL", "Carlsberg"),
        ("5306.KL", "Farm Fresh"),
        ("4065.KL", "PPB Group"),
        ("5102.KL", "Guan Chong"),
        ("3026.KL", "Dutch Lady"),
        ("1562.KL", "Sports Toto"),
        ("7052.KL", "Padini"),
    ],
    "TRANSPORTATION": [
        ("3816.KL", "MISC"),
        ("5246.KL", "Westports"),
        ("5238.KL", "AirAsia X"),
        ("5032.KL", "Bintulu Port"),
        ("5099.KL", "Capital A"),
        ("5335.KL", "Hi Mobility"),
        ("5348.KL", "Orkim"),
        ("5908.KL", "DKSH Holdings"),
        ("5173.KL", "Shin Yang Group"),
        ("0078.KL", "GDEX"),
        ("2062.KL", "Harbour-Link"),
        ("SURIA.KL", "Suria Capital"),
        ("8397.KL", "Tiong Nam Logistics"),
        ("5303.KL", "Swift Haulage"),
        ("5983.KL", "MBM Resources"),
    ],
    "TELECOMMUNICATIONS": [
        ("6947.KL", "CelcomDigi"),
        ("4863.KL", "Telekom Malaysia"),
        ("6012.KL", "Maxis"),
        ("6888.KL", "Axiata"),
        ("0138.KL", "Zetrix AI"),
        ("5332.KL", "Reach Ten"),
        ("REDTONE.KL", "REDtone Digital"),
        ("0129.KL", "Silver Ridge"),
        ("OCK.KL", "OCK Group"),
        ("0195.KL", "Binasat Communications"),
        ("0178.KL", "Sedania Innovator"),
        ("0165.KL", "XOX"),
        ("MNC.KL", "MNC Wireless"),
        ("0082.KL", "Green Packet"),
    ],
    "IND-PROD": [
        ("8869.KL", "Press Metal"),
        ("0208.KL", "Greatech"),
        ("5292.KL", "UWC"),
        ("5168.KL", "Hartalega"),
        ("7153.KL", "Kossan Rubber"),
        ("5286.KL", "Mi Technovation"),
        ("7172.KL", "PMB Technology"),
        ("3565.KL", "WCE Holdings"),
        ("0225.KL", "Southern Cable"),
        ("7160.KL", "Pentamaster"),
        ("9822.KL", "SAM Engineering"),
        ("MSC.KL", "Malaysia Smelting"),
        ("6963.KL", "VS Industry"),
        ("0233.KL", "Pekat Group"),
        ("3867.KL", "MPI"),
    ],
    "HEALTH": [
        ("5225.KL", "IHH Healthcare"),
        ("5555.KL", "Sunway Healthcare"),
        ("5878.KL", "KPJ Healthcare"),
        ("7113.KL", "Top Glove"),
        ("5318.KL", "DXN Holdings"),
        ("7148.KL", "Duopharma Biotech"),
        ("0101.KL", "TMC Life Sciences"),
        ("0002.KL", "Kotra Industries"),
        ("7178.KL", "YSP Southeast Asia"),
        ("0222.KL", "Optimax Holdings"),
        ("0363.KL", "PMCK"),
        ("0329.KL", "Metro Healthcare"),
        ("0148.KL", "Sunzen Group"),
        ("0243.KL", "Cengild Medical"),
        ("0283.KL", "DC Healthcare"),
    ],
    "CONSTRUCTN": [
        ("5211.KL", "Sunway Bhd"),
        ("5398.KL", "Gamuda"),
        ("5263.KL", "Sunway Construction"),
        ("3336.KL", "IJM Corp"),
        ("0151.KL", "Kelington Group"),
        ("7161.KL", "Kerjaya Prospek"),
        ("0215.KL", "Solarvest"),
        ("1651.KL", "MRCB"),
        ("0245.KL", "MN Holdings"),
        ("5320.KL", "Prolintas Infra"),
        ("0375.KL", "THMY Holdings"),
        ("0193.KL", "Kinergy Advancement"),
        ("5827.KL", "Oriental Interest"),
        ("8877.KL", "Ekovest"),
        ("9679.KL", "WCT Holdings"),
    ],
    "PROPERTIES": [
        ("5249.KL", "IOI Properties"),
        ("5288.KL", "Sime Darby Property"),
        ("2429.KL", "Tanco Holdings"),
        ("8206.KL", "Eco World Development"),
        ("5053.KL", "OSK Holdings"),
        ("5200.KL", "UOA Development"),
        ("5606.KL", "IGB Bhd"),
        ("8664.KL", "SP Setia"),
        ("5038.KL", "KSL Holdings"),
        ("5401.KL", "Tropicana Corp"),
        ("8583.KL", "Mah Sing"),
        ("5236.KL", "Matrix Concepts"),
        ("5148.KL", "UEM Sunrise"),
        ("3417.KL", "Eastern & Oriental"),
        ("7179.KL", "Lagenda Properties"),
    ],
    "TECHNOLOGY": [
        ("5031.KL", "TIME dotCom"),
        ("0097.KL", "ViTrox"),
        ("0128.KL", "Frontken"),
        ("0166.KL", "Inari Amertron"),
        ("5005.KL", "Unisem"),
        ("5340.KL", "UMS Integration"),
        ("7195.KL", "Binastra Corp"),
        ("5162.KL", "VSTECS"),
        ("0270.KL", "Nationgate"),
        ("7100.KL", "Uchi Technologies"),
        ("4456.KL", "DNEX"),
        ("5216.KL", "NEXG"),
        ("5302.KL", "Aurelius Technologies"),
        ("7233.KL", "Dufu Technology"),
        ("0045.KL", "Southern Score Builders"),
    ],
    "PLANTATION": [
        ("5183.KL", "Petronas Chemicals"),
        ("5285.KL", "SD Guthrie"),
        ("1961.KL", "IOI Corp"),
        ("2445.KL", "KLK"),
        ("2089.KL", "United Plantations"),
        ("2291.KL", "Genting Plantations"),
        ("4731.KL", "Scientex"),
        ("5126.KL", "Sarawak Oil Palms"),
        ("1899.KL", "Batu Kawan"),
        ("3034.KL", "Hap Seng"),
        ("5323.KL", "Johor Plantations"),
        ("HEXTAR.KL", "Hextar Global"),
        ("LHI.KL", "Leong Hup International"),
        ("5027.KL", "Kim Loong Resources"),
        ("5029.KL", "Far East Holdings"),
    ],
    "ENERGY": [
        ("7277.KL", "Dialog Group"),
        ("5243.KL", "Velesto Energy"),
        ("5141.KL", "Dayang Enterprise"),
        ("5255.KL", "Lianson Fleet Group"),
        ("5210.KL", "Bumi Armada"),
        ("5199.KL", "Hibiscus Petroleum"),
        ("3042.KL", "Petron Malaysia"),
        ("4324.KL", "Hengyuan Refining"),
        ("5218.KL", "Vantris Energy"),
        ("5186.KL", "Malaysia Marine & Heavy Eng"),
        ("7228.KL", "T7 Global"),
        ("UZMA.KL", "Uzma"),
        ("5133.KL", "Petra Energy"),
        ("7293.KL", "Yinson Holdings"),
        ("0320.KL", "Steel Hawk"),
    ],
    "UTILITIES": [
        ("5347.KL", "Tenaga Nasional"),
        ("6033.KL", "Petronas Gas"),
        ("6742.KL", "YTL Power"),
        ("4677.KL", "YTL Corp"),
        ("5209.KL", "Gas Malaysia"),
        ("5264.KL", "Malakoff"),
        ("3069.KL", "Mega First"),
        ("5272.KL", "Ranhill Utilities"),
        ("8524.KL", "Taliworks"),
        ("5041.KL", "PBA Holdings"),
        ("5184.KL", "Cypark Resources"),
        ("5843.KL", "KP Selangor"),
        ("5614.KL", "NuEnergy Holdings"),
        ("6807.KL", "Puncak Niaga"),
        ("7471.KL", "Eden Inc"),
    ],
    "REIT": [
        ("5235SS.KL", "KLCC Property"),
        ("5227.KL", "IGB REIT"),
        ("5176.KL", "Sunway REIT"),
        ("5212.KL", "Pavilion REIT"),
        ("5106.KL", "Axis REIT"),
        ("5180.KL", "CapitaLand MY Trust"),
        ("5109.KL", "YTL REIT"),
        ("5338.KL", "Paradigm REIT"),
        ("5299.KL", "IGB Commercial REIT"),
        ("5116.KL", "Al-Aqar REIT"),
        ("5123.KL", "Sentral REIT"),
        ("5307.KL", "AME REIT"),
        ("5280.KL", "KIP REIT"),
        ("5110.KL", "UOA REIT"),
        ("5130.KL", "Atrium REIT"),
    ],
}


@router.get("/configuration")
def get_stock_configuration(db: Session = Depends(get_db)) -> dict[str, str]:
    """Return persisted selected stock configuration for the dashboard."""
    return {
        "symbol": _get_stock_pref_value(db, "selected_symbol") or "5248.KL",
        "period": _get_stock_pref_value(db, "selected_period") or "6mo",
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
    "5819.KL": "HLBANK", "1066.KL": "RHBBANK", "1015.KL": "AMBANK",
    "1082.KL": "HLFG", "2488.KL": "ABMB", "1818.KL": "BURSA",
    "5185.KL": "AFFIN", "8621.KL": "LPI", "1171.KL": "MBSB",
    "5258.KL": "BIMB", "TAKAFUL.KL": "TAKAFUL", "6459.KL": "MNRB",
    # CONSUMER
    "5326.KL": "99SMART", "4707.KL": "NESTLE", "7084.KL": "QL",
    "5296.KL": "MRDIY", "3689.KL": "F&N", "4715.KL": "GENM",
    "3182.KL": "GENTING", "5337.KL": "ECOSHOP", "3255.KL": "HEIM",
    "2836.KL": "CARLSBG", "5306.KL": "FFB", "4065.KL": "PPB",
    "5102.KL": "GCB", "3026.KL": "DLADY", "1562.KL": "SPTOTO",
    "7052.KL": "PADINI",
    # TRANSPORTATION
    "3816.KL": "MISC", "5246.KL": "WPRTS", "5238.KL": "AAX",
    "5032.KL": "BIPORT", "5099.KL": "CAPITALA", "5335.KL": "HI",
    "5348.KL": "ORKIM", "5908.KL": "DKSH", "5173.KL": "SYGROUP",
    "0078.KL": "GDEX", "2062.KL": "HARBOUR", "SURIA.KL": "SURIA",
    "8397.KL": "TNLOGIS", "5303.KL": "SWIFT", "5983.KL": "MBMR",
    # TELECOMMUNICATIONS
    "6947.KL": "CDB", "4863.KL": "TM", "6012.KL": "MAXIS",
    "6888.KL": "AXIATA", "0138.KL": "ZETRIX", "5332.KL": "REACHTEN",
    "REDTONE.KL": "REDTONE", "0129.KL": "SRIDGE", "OCK.KL": "OCK",
    "0195.KL": "BINACOM", "0178.KL": "SEDANIA", "0165.KL": "XOX",
    "MNC.KL": "MNC", "0082.KL": "GPACKET",
    # IND-PROD
    "8869.KL": "PMETAL", "0208.KL": "GREATEC", "5292.KL": "UWC",
    "5168.KL": "HARTA", "7153.KL": "KOSSAN", "5286.KL": "MI",
    "7172.KL": "PMBTECH", "3565.KL": "WCEHB", "0225.KL": "SCGBHD",
    "7160.KL": "PENTA", "9822.KL": "SAM", "MSC.KL": "MSC",
    "6963.KL": "VS", "0233.KL": "PEKAT", "3867.KL": "MPI",
    # HEALTH
    "5225.KL": "IHH", "5555.KL": "SUNMED", "5878.KL": "KPJ",
    "7113.KL": "TOPGLOV", "5318.KL": "DXN", "7148.KL": "DPHARMA",
    "0101.KL": "TMCLIFE", "0002.KL": "KOTRA", "7178.KL": "YSPSAH",
    "0222.KL": "OPTIMAX", "0363.KL": "PMCK", "0329.KL": "METRO",
    "0148.KL": "SUNZEN", "0243.KL": "CENGILD", "0283.KL": "DCHCARE",
    # CONSTRUCTN
    "5211.KL": "SUNWAY", "5398.KL": "GAMUDA", "5263.KL": "SUNCON",
    "3336.KL": "IJM", "0151.KL": "KGB", "7161.KL": "KERJAYA",
    "0215.KL": "SLVEST", "1651.KL": "MRCB", "0245.KL": "MNHLDG",
    "5320.KL": "PLINTAS", "0375.KL": "THMY", "0193.KL": "KINERGY",
    "5827.KL": "OIB", "8877.KL": "EKOVEST", "9679.KL": "WCT",
    # PROPERTIES
    "5249.KL": "IOIPG", "5288.KL": "SIMEPROP", "2429.KL": "TANCO",
    "8206.KL": "ECOWLD", "5053.KL": "OSK", "5200.KL": "UOADEV",
    "5606.KL": "IGBB", "8664.KL": "SPSETIA", "5038.KL": "KSL",
    "5401.KL": "TROP", "8583.KL": "MAHSING", "5236.KL": "MATRIX",
    "5148.KL": "UEMS", "3417.KL": "E&O", "7179.KL": "LAGENDA",
    # TECHNOLOGY
    "5031.KL": "TIMECOM", "0097.KL": "VITROX", "0128.KL": "FRONTKN",
    "0166.KL": "INARI", "5005.KL": "UNISEM", "5340.KL": "UMSINT",
    "7195.KL": "BNASTRA", "5162.KL": "VSTECS", "0270.KL": "NATGATE",
    "7100.KL": "UCHITEC", "4456.KL": "DNEX", "5216.KL": "NEXG",
    "5302.KL": "ATECH", "7233.KL": "DUFU", "0045.KL": "SSB8",
    # PLANTATION
    "5183.KL": "PCHEM", "5285.KL": "SDG", "1961.KL": "IOICORP",
    "2445.KL": "KLK", "2089.KL": "UTDPLT", "2291.KL": "GENP",
    "4731.KL": "SCIENTX", "5126.KL": "SOP", "1899.KL": "BKAWAN",
    "3034.KL": "HAPSENG", "5323.KL": "JPG", "HEXTAR.KL": "HEXTAR",
    "LHI.KL": "LHI", "5027.KL": "KMLOONG", "5029.KL": "FAREAST",
    # ENERGY
    "7277.KL": "DIALOG", "5243.KL": "VELESTO", "5141.KL": "DAYANG",
    "5255.KL": "LFG", "5210.KL": "ARMADA", "5199.KL": "HIBISCS",
    "3042.KL": "PETRONM", "4324.KL": "HENGYUAN", "5218.KL": "VANTNRG",
    "5186.KL": "MHB", "7228.KL": "T7GLOBAL", "UZMA.KL": "UZMA",
    "5133.KL": "PENERGY", "7293.KL": "YINSON", "0320.KL": "HAWK",
    # UTILITIES
    "5347.KL": "TENAGA", "6033.KL": "PETGAS", "6742.KL": "YTLPOWR",
    "4677.KL": "YTL", "5209.KL": "GASMSIA", "5264.KL": "MALAKOF",
    "3069.KL": "MFCB", "5272.KL": "RANHILL", "8524.KL": "TALIWRK",
    "5041.KL": "PBA", "5184.KL": "CYPARK", "5843.KL": "KPS",
    "5614.KL": "NHB", "6807.KL": "PUNCAK", "7471.KL": "EDEN",
    # REIT
    "5235SS.KL": "KLCC", "5227.KL": "IGBREIT", "5176.KL": "SUNREIT",
    "5212.KL": "PAVREIT", "5106.KL": "AXREIT", "5180.KL": "CLMT",
    "5109.KL": "YTLREIT", "5338.KL": "PARADIGM", "5299.KL": "IGBCR",
    "5116.KL": "ALAQAR", "5123.KL": "SENTRAL", "5307.KL": "AMEREIT",
    "5280.KL": "KIPREIT", "5110.KL": "UOAREIT", "5130.KL": "ATRIUM",
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
                "change_30d": round(perf_1m, 2),
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
        avg_30d = sum(s["change_30d"] for s in stock_results) / n
        bullish_count = sum(1 for s in stock_results if s["sma5_above_sma20"])
        bearish_count = n - bullish_count
        green_count = sum(1 for s in stock_results if s["change_1d"] >= 0)

        bullish_balance = (bullish_count - bearish_count) / n  # -1.0 (fully bearish) to +1.0 (fully bullish)
        trend_30d_score = (avg_30d * 0.7) + (bullish_balance * 10.0)

        # Determine overall sentiment using 30-day direction + breadth
        if avg_30d > 0 and bullish_count >= bearish_count:
            sentiment = "bullish"
        elif avg_30d < 0 and bearish_count > bullish_count:
            sentiment = "bearish"
        else:
            sentiment = "neutral"

        sectors.append({
            "sector": sector_name,
            "sentiment": sentiment,
            "avg_change_1d": round(avg_1d, 2),
            "avg_change_5d": round(avg_5d, 2),
            "avg_change_30d": round(avg_30d, 2),
            "trend_30d_score": round(trend_30d_score, 2),
            "bullish_count": bullish_count,
            "bearish_count": bearish_count,
            "green_today": green_count,
            "total_stocks": n,
            "stocks": sorted(stock_results, key=lambda x: x["change_1d"], reverse=True),
        })

    # Sort by 30-day overall trend strength: strongest bullish first, strongest bearish last.
    sectors.sort(key=lambda x: x["trend_30d_score"], reverse=True)

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

# Use shared indicator functions from app.utils.indicators
_compute_scan_ema = ema
_compute_scan_rsi = compute_rsi
_compute_scan_atr = compute_atr


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
        "timestamp": _dt.now().strftime("%d/%m/%Y %H:%M"),
        "scanned": len(BURSA_STOCKS),
        "qualified": len(setups),
        "setups": setups[:top],
    }


