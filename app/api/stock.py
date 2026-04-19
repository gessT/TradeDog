from __future__ import annotations

from datetime import datetime, timedelta, timezone
import logging
from pathlib import Path

SGT = timezone(timedelta(hours=8))

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.concurrency import run_in_threadpool
import pandas as pd
from pydantic import BaseModel, Field
import requests as http_requests
from sqlalchemy.orm import Session
from sqlalchemy.sql import func
import yfinance as yf

from app.core.config import get_settings
from app.db.database import get_db
from app.models.stock import StockPreference
from app.models.starred_stock import StarredStock
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

# ── Major US stocks (Yahoo Finance tickers) ──────────────────────────
US_STOCKS: dict[str, str] = {
    # TECHNOLOGY (15)
    "AAPL": "Apple", "MSFT": "Microsoft", "GOOGL": "Alphabet",
    "AMZN": "Amazon", "NVDA": "NVIDIA", "META": "Meta Platforms",
    "TSLA": "Tesla", "AVGO": "Broadcom", "ORCL": "Oracle",
    "CRM": "Salesforce", "AMD": "AMD", "INTC": "Intel",
    "ADBE": "Adobe", "NFLX": "Netflix", "CSCO": "Cisco",
    # FINANCE (10)
    "JPM": "JPMorgan Chase", "BAC": "Bank of America", "WFC": "Wells Fargo",
    "GS": "Goldman Sachs", "MS": "Morgan Stanley", "C": "Citigroup",
    "BLK": "BlackRock", "SCHW": "Charles Schwab", "AXP": "American Express",
    "V": "Visa",
    # HEALTHCARE (10)
    "UNH": "UnitedHealth", "JNJ": "Johnson & Johnson", "LLY": "Eli Lilly",
    "PFE": "Pfizer", "ABBV": "AbbVie", "MRK": "Merck",
    "TMO": "Thermo Fisher", "ABT": "Abbott Labs", "BMY": "Bristol-Myers",
    "AMGN": "Amgen",
    # CONSUMER (10)
    "WMT": "Walmart", "PG": "Procter & Gamble", "KO": "Coca-Cola",
    "PEP": "PepsiCo", "COST": "Costco", "NKE": "Nike",
    "MCD": "McDonald's", "SBUX": "Starbucks", "HD": "Home Depot",
    "TGT": "Target",
    # ENERGY (5)
    "XOM": "Exxon Mobil", "CVX": "Chevron", "COP": "ConocoPhillips",
    "SLB": "Schlumberger", "EOG": "EOG Resources",
    # INDUSTRIALS (5)
    "BA": "Boeing", "CAT": "Caterpillar", "HON": "Honeywell",
    "UPS": "UPS", "GE": "GE Aerospace",
    # COMMUNICATION (5)
    "DIS": "Walt Disney", "CMCSA": "Comcast", "T": "AT&T",
    "VZ": "Verizon", "TMUS": "T-Mobile",
}

US_SECTORS: dict[str, list[tuple[str, str]]] = {
    "TECHNOLOGY": [
        ("AAPL", "Apple"), ("MSFT", "Microsoft"), ("GOOGL", "Alphabet"),
        ("AMZN", "Amazon"), ("NVDA", "NVIDIA"), ("META", "Meta Platforms"),
        ("TSLA", "Tesla"), ("AVGO", "Broadcom"), ("ORCL", "Oracle"),
        ("CRM", "Salesforce"), ("AMD", "AMD"), ("INTC", "Intel"),
        ("ADBE", "Adobe"), ("NFLX", "Netflix"), ("CSCO", "Cisco"),
    ],
    "FINANCE": [
        ("JPM", "JPMorgan Chase"), ("BAC", "Bank of America"), ("WFC", "Wells Fargo"),
        ("GS", "Goldman Sachs"), ("MS", "Morgan Stanley"), ("C", "Citigroup"),
        ("BLK", "BlackRock"), ("SCHW", "Charles Schwab"), ("AXP", "American Express"),
        ("V", "Visa"),
    ],
    "HEALTHCARE": [
        ("UNH", "UnitedHealth"), ("JNJ", "Johnson & Johnson"), ("LLY", "Eli Lilly"),
        ("PFE", "Pfizer"), ("ABBV", "AbbVie"), ("MRK", "Merck"),
        ("TMO", "Thermo Fisher"), ("ABT", "Abbott Labs"), ("BMY", "Bristol-Myers"),
        ("AMGN", "Amgen"),
    ],
    "CONSUMER": [
        ("WMT", "Walmart"), ("PG", "Procter & Gamble"), ("KO", "Coca-Cola"),
        ("PEP", "PepsiCo"), ("COST", "Costco"), ("NKE", "Nike"),
        ("MCD", "McDonald's"), ("SBUX", "Starbucks"), ("HD", "Home Depot"),
        ("TGT", "Target"),
    ],
    "ENERGY": [
        ("XOM", "Exxon Mobil"), ("CVX", "Chevron"), ("COP", "ConocoPhillips"),
        ("SLB", "Schlumberger"), ("EOG", "EOG Resources"),
    ],
    "INDUSTRIALS": [
        ("BA", "Boeing"), ("CAT", "Caterpillar"), ("HON", "Honeywell"),
        ("UPS", "UPS"), ("GE", "GE Aerospace"),
    ],
    "COMMUNICATION": [
        ("DIS", "Walt Disney"), ("CMCSA", "Comcast"), ("T", "AT&T"),
        ("VZ", "Verizon"), ("TMUS", "T-Mobile"),
    ],
}


def _get_stock_universe(market: str) -> tuple[dict[str, str], dict[str, list[tuple[str, str]]]]:
    """Return (stocks_dict, sectors_dict) for the given market."""
    if market == "US":
        return US_STOCKS, US_SECTORS
    return BURSA_STOCKS, BURSA_SECTORS


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


# ── KLSE TPC Strategy Config (per-symbol, persisted) ─────────────────

class KLSEStrategyConfigPayload(BaseModel):
    disabled_conditions: list[str] | None = None
    atr_sl_mult: float | None = None
    tp1_r_mult: float | None = None
    tp2_r_mult: float | None = None
    capital: float | None = None
    period: str | None = None


@router.get("/klse_strategy_config")
def get_klse_strategy_config(
    strategy: str = Query("tpc"),
) -> dict:
    """Load persisted KLSE strategy config (per-strategy, global)."""
    import json
    from sqlalchemy import text
    from app.db.database import engine

    sym = f"KLSE_{strategy.upper()}"
    with engine.connect() as conn:
        row = conn.execute(
            text("SELECT config_json FROM strategy_configs WHERE symbol = :sym"),
            {"sym": sym},
        ).fetchone()
    if row:
        try:
            return json.loads(row[0])
        except Exception:
            pass
    return {}


@router.post("/klse_strategy_config")
def save_klse_strategy_config(
    payload: KLSEStrategyConfigPayload,
    strategy: str = Query("tpc"),
) -> dict[str, str]:
    """Save KLSE strategy config (per-strategy, global — merge with existing)."""
    import json
    from sqlalchemy import text
    from app.db.database import engine

    sym = f"KLSE_{strategy.upper()}"
    new_fields = {k: v for k, v in {
        "disabled_conditions": payload.disabled_conditions,
        "atr_sl_mult": payload.atr_sl_mult,
        "tp1_r_mult": payload.tp1_r_mult,
        "tp2_r_mult": payload.tp2_r_mult,
        "capital": payload.capital,
        "period": payload.period,
    }.items() if v is not None}

    existing = {}
    with engine.connect() as conn:
        row = conn.execute(
            text("SELECT config_json FROM strategy_configs WHERE symbol = :sym"),
            {"sym": sym},
        ).fetchone()
    if row:
        try:
            existing = json.loads(row[0])
        except Exception:
            pass
    merged = {**existing, **new_fields}
    config = json.dumps(merged)

    with engine.begin() as conn:
        conn.execute(
            text("""
                INSERT INTO strategy_configs (symbol, config_json, updated_at)
                VALUES (:sym, :cfg, CURRENT_TIMESTAMP)
                ON CONFLICT (symbol) DO UPDATE SET
                    config_json = EXCLUDED.config_json,
                    updated_at = CURRENT_TIMESTAMP
            """),
            {"sym": sym, "cfg": config},
        )
    return {"status": "ok"}


@router.get("/pine_scripts")
def list_pine_scripts() -> dict[str, list[dict[str, str]]]:
    """List Pine Script files from ./pine_scripts.

    File name stem is treated as strategy key (for example, psniper.pine -> psniper).
    """
    scripts_dir = Path(__file__).resolve().parents[2] / "pine_scripts"
    if not scripts_dir.exists() or not scripts_dir.is_dir():
        return {"scripts": []}

    scripts = [
        {
            "file_name": f.name,
            "strategy_key": f.stem,
        }
        for f in sorted(scripts_dir.glob("*.pine"))
        if f.is_file()
    ]
    return {"scripts": scripts}


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
async def near_ath(top: int = 10, market: str = Query(default="MY")) -> dict:
    """Return top N stocks nearest to their All-Time High."""
    import concurrent.futures

    stocks_dict, _ = _get_stock_universe(market)
    top = min(max(top, 1), 50)

    def _scan_all() -> list[dict]:
        results: list[dict] = []
        with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
            futures = {
                pool.submit(_scan_single_stock, code, name): code
                for code, name in stocks_dict.items()
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
        "scanned": len(stocks_dict),
        "stocks": stocks,
    }


# ── Volume Breakout Scanner ─────────────────────────────────────────

def _scan_vol_breakout(code: str, name: str, lookback: int = 10, vol_mult: float = 2.0) -> dict | None:
    """
    Find stocks with big-volume day(s) in last `lookback` bars,
    then classify current price vs the big-volume day's price range.
    Returns: breakout / range / breakdown status, or None on failure.
    """
    try:
        ticker = yf.Ticker(code)
        hist = ticker.history(period="3mo", auto_adjust=False)
        if hist is None or hist.empty or len(hist) < lookback + 20:
            return None

        cols = hist.columns
        if isinstance(cols[0], tuple):
            hist.columns = [c[0] if isinstance(c, tuple) else str(c) for c in cols]

        for col in ("Close", "High", "Low", "Volume"):
            if col not in hist.columns:
                return None

        close = pd.to_numeric(hist["Close"], errors="coerce").dropna()
        high = pd.to_numeric(hist["High"], errors="coerce").dropna()
        low = pd.to_numeric(hist["Low"], errors="coerce").dropna()
        vol = pd.to_numeric(hist["Volume"], errors="coerce").dropna()

        if len(vol) < lookback + 20:
            return None

        # Average volume over 20 days BEFORE the lookback window
        avg_vol = float(vol.iloc[-(lookback + 20):-(lookback)].mean())
        if avg_vol <= 0:
            return None

        # Scan last `lookback` bars for big-volume days (>= vol_mult × avg)
        recent = hist.iloc[-lookback:]
        big_vol_mask = pd.to_numeric(recent["Volume"], errors="coerce") >= avg_vol * vol_mult
        big_vol_days = recent[big_vol_mask]

        if big_vol_days.empty:
            return None

        # Build price range from all big-volume days
        bv_highs = pd.to_numeric(big_vol_days["High"], errors="coerce").dropna()
        bv_lows = pd.to_numeric(big_vol_days["Low"], errors="coerce").dropna()
        if bv_highs.empty or bv_lows.empty:
            return None

        range_high = float(bv_highs.max())
        range_low = float(bv_lows.min())
        if range_high <= 0 or range_low <= 0:
            return None

        current_price = float(close.iloc[-1])
        max_vol_ratio = float((pd.to_numeric(big_vol_days["Volume"], errors="coerce") / avg_vol).max())
        days_ago = len(hist) - hist.index.get_loc(big_vol_days.index[-1]) - 1
        if isinstance(days_ago, slice):
            days_ago = 1

        # Classify
        if current_price > range_high:
            status = "breakout"
        elif current_price < range_low:
            status = "breakdown"
        else:
            status = "range"

        pct_from_high = ((current_price - range_high) / range_high) * 100
        pct_from_low = ((current_price - range_low) / range_low) * 100

        return {
            "symbol": code,
            "name": name,
            "current_price": round(current_price, 4),
            "range_high": round(range_high, 4),
            "range_low": round(range_low, 4),
            "status": status,
            "pct_from_high": round(pct_from_high, 2),
            "pct_from_low": round(pct_from_low, 2),
            "big_vol_days": int(big_vol_mask.sum()),
            "max_vol_ratio": round(max_vol_ratio, 1),
            "last_big_vol_days_ago": int(days_ago),
        }
    except Exception as exc:
        logger.debug("Vol-breakout scan failed for %s: %s", code, exc)
        return None


@router.get("/vol-breakout")
async def vol_breakout_scan(
    top: int = 30,
    market: str = Query(default="MY"),
    lookback: int = Query(default=10, ge=3, le=30),
    vol_mult: float = Query(default=2.0, ge=1.2, le=5.0),
) -> dict:
    """Scan stocks for big-volume days in last N bars and classify breakout/range/breakdown."""
    import concurrent.futures

    stocks_dict, _ = _get_stock_universe(market)
    top = min(max(top, 1), 100)

    def _scan_all() -> list[dict]:
        results: list[dict] = []
        with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
            futures = {
                pool.submit(_scan_vol_breakout, code, name, lookback, vol_mult): code
                for code, name in stocks_dict.items()
            }
            for fut in concurrent.futures.as_completed(futures):
                res = fut.result()
                if res is not None:
                    results.append(res)
        # Sort: breakouts first, then range, then breakdown; within each group by vol ratio desc
        status_order = {"breakout": 0, "range": 1, "breakdown": 2}
        results.sort(key=lambda x: (status_order.get(x["status"], 9), -x["max_vol_ratio"]))
        return results[:top]

    stocks = await run_in_threadpool(_scan_all)

    return {
        "count": len(stocks),
        "scanned": len(stocks_dict),
        "lookback": lookback,
        "vol_mult": vol_mult,
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
async def top_volume(top: int = 10, market: str = Query(default="MY")) -> dict:
    """Return top N stocks with highest volume ratio (today vs 20-day avg)."""
    import concurrent.futures

    stocks_dict, _ = _get_stock_universe(market)
    top = min(max(top, 1), 50)

    def _scan_all() -> list[dict]:
        results: list[dict] = []
        with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
            futures = {
                pool.submit(_scan_volume, code, name): code
                for code, name in stocks_dict.items()
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
        "scanned": len(stocks_dict),
        "stocks": stocks,
    }


# ── Sector Momentum Scanner (TradingView) ────────────────────────────

TRADINGVIEW_SCANNER_URL_MY = "https://scanner.tradingview.com/malaysia/scan"
TRADINGVIEW_SCANNER_URL_US = "https://scanner.tradingview.com/america/scan"

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

# US stocks: TradingView exchange mapping (ticker → exchange prefix for TV API)
US_TV_EXCHANGE: dict[str, str] = {
    "AAPL": "NASDAQ", "MSFT": "NASDAQ", "GOOGL": "NASDAQ", "AMZN": "NASDAQ",
    "NVDA": "NASDAQ", "META": "NASDAQ", "TSLA": "NASDAQ", "AVGO": "NASDAQ",
    "ORCL": "NYSE", "CRM": "NYSE", "AMD": "NASDAQ", "INTC": "NASDAQ",
    "ADBE": "NASDAQ", "NFLX": "NASDAQ", "CSCO": "NASDAQ",
    "JPM": "NYSE", "BAC": "NYSE", "WFC": "NYSE", "GS": "NYSE",
    "MS": "NYSE", "C": "NYSE", "BLK": "NYSE", "SCHW": "NYSE",
    "AXP": "NYSE", "V": "NYSE",
    "UNH": "NYSE", "JNJ": "NYSE", "LLY": "NYSE", "PFE": "NYSE",
    "ABBV": "NYSE", "MRK": "NYSE", "TMO": "NYSE", "ABT": "NYSE",
    "BMY": "NYSE", "AMGN": "NASDAQ",
    "WMT": "NYSE", "PG": "NYSE", "KO": "NYSE", "PEP": "NASDAQ",
    "COST": "NASDAQ", "NKE": "NYSE", "MCD": "NYSE", "SBUX": "NASDAQ",
    "HD": "NYSE", "TGT": "NYSE",
    "XOM": "NYSE", "CVX": "NYSE", "COP": "NYSE", "SLB": "NYSE", "EOG": "NYSE",
    "BA": "NYSE", "CAT": "NYSE", "HON": "NASDAQ", "UPS": "NYSE", "GE": "NYSE",
    "DIS": "NYSE", "CMCSA": "NASDAQ", "T": "NYSE", "VZ": "NYSE", "TMUS": "NASDAQ",
}


def _fetch_tv_sector_data(market: str = "MY") -> list[dict]:
    """Fetch our specific stocks from TradingView scanner API in a single request."""
    if market == "US":
        tv_tickers = [f"{US_TV_EXCHANGE.get(t, 'NYSE')}:{t}" for t in US_STOCKS]
        scanner_url = TRADINGVIEW_SCANNER_URL_US
    else:
        tv_tickers = [f"MYX:{tv}" for tv in YF_TO_TV.values()]
        scanner_url = TRADINGVIEW_SCANNER_URL_MY
    payload = {
        "columns": [
            "close", "change", "Perf.W", "Perf.1M",
            "name", "description", "SMA5", "SMA20",
        ],
        "symbols": {"tickers": tv_tickers},
    }
    resp = http_requests.post(
        scanner_url,
        json=payload,
        headers={"Content-Type": "application/json"},
        timeout=30,
    )
    resp.raise_for_status()
    return resp.json().get("data", [])


@router.get("/sectors")
async def sector_overview(market: str = Query(default="MY")) -> dict:
    """Return sector-level momentum overview using TradingView scanner API."""
    _, sectors_dict = _get_stock_universe(market)

    # Build lookup: TV ticker -> (sector, yf_code, name) from our mapping
    tv_lookup: dict[str, tuple[str, str, str]] = {}
    for sector, stocks_list in sectors_dict.items():
        for yf_code, name in stocks_list:
            if market == "US":
                tv_lookup[yf_code] = (sector, yf_code, name)
            else:
                tv_ticker = YF_TO_TV.get(yf_code)
                if tv_ticker:
                    tv_lookup[tv_ticker] = (sector, yf_code, name)

    def _scan() -> dict[str, list[dict]]:
        tv_rows = _fetch_tv_sector_data(market)

        sector_results: dict[str, list[dict]] = {s: [] for s in sectors_dict}

        for row in tv_rows:
            # TradingView symbol format: "MYX:MAYBANK" or "NASDAQ:AAPL"
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
    market: str = Query(default="MY"),
) -> dict:
    """Return synthetic OHLCV candles for a sector by averaging constituent stocks."""
    import concurrent.futures

    _, sectors_dict = _get_stock_universe(market)

    if sector not in sectors_dict:
        raise HTTPException(status_code=404, detail=f"Sector '{sector}' not found")

    stocks_list = sectors_dict[sector]

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
        "timestamp": datetime.now(SGT).isoformat(),
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
async def daily_scan(top: int = Query(default=6, ge=1, le=20), market: str = Query(default="MY")) -> dict:
    """Scan all stocks and return today's highest-probability trade setups."""
    import concurrent.futures
    from datetime import datetime as _dt

    stocks_dict, _ = _get_stock_universe(market)

    def _run() -> list[dict]:
        out: list[dict] = []
        with concurrent.futures.ThreadPoolExecutor(max_workers=10) as pool:
            futs = {
                pool.submit(_scan_daily_setup, code, nm): code
                for code, nm in stocks_dict.items()
            }
            for fut in concurrent.futures.as_completed(futs):
                res = fut.result()
                if res:
                    out.append(res)
        out.sort(key=lambda x: x["score"], reverse=True)
        return out

    setups = await run_in_threadpool(_run)
    return {
        "timestamp": datetime.now(SGT).strftime("%d/%m/%Y %H:%M SGT"),
        "scanned": len(stocks_dict),
        "qualified": len(setups),
        "setups": setups[:top],
    }


# ── Search Bursa Stocks (dynamic Yahoo Finance lookup) ───────────────

@router.get("/search-bursa")
async def search_bursa(q: str = Query(min_length=1, max_length=32)):
    """Search for any Bursa Malaysia stock by code or name via Yahoo Finance."""
    q = q.strip()

    def _search():
        results = []
        # If query looks like a stock code (digits, possibly with .KL)
        code = q.upper().replace(".KL", "")
        candidates = []
        if code.isdigit():
            candidates.append(f"{code}.KL")
            # Also try with leading zeros (4-digit Bursa codes)
            if len(code) < 4:
                candidates.append(f"{code.zfill(4)}.KL")
        else:
            # Try as-is with .KL suffix
            candidates.append(f"{code}.KL")

        for sym in candidates:
            try:
                t = yf.Ticker(sym)
                info = t.info
                name = info.get("shortName") or info.get("longName")
                if not name:
                    continue
                price = info.get("currentPrice") or info.get("regularMarketPrice") or 0
                sector = info.get("sector", "Other")
                mcap = info.get("marketCap", 0)
                cap_tier = "L" if mcap and mcap > 5_000_000_000 else "M" if mcap and mcap > 1_000_000_000 else "S"
                results.append({
                    "symbol": sym,
                    "name": name,
                    "sector": sector,
                    "refPrice": round(price, 2),
                    "cap": cap_tier,
                    "price": round(price, 2),
                    "change_pct": info.get("regularMarketChangePercent", 0) or 0,
                })
            except Exception:
                continue
        return results

    results = await run_in_threadpool(_search)
    return {"results": results}


# ── Starred Stocks ───────────────────────────────────────────────────


class StarPayload(BaseModel):
    symbol: str = Field(min_length=1, max_length=16)
    name: str = Field(default="", max_length=64)
    market: str = Field(default="MY", max_length=8)


@router.get("/starred")
def list_starred(market: str = Query(default="MY"), db: Session = Depends(get_db)) -> list[dict]:
    rows = db.query(StarredStock).filter(StarredStock.market == market).order_by(StarredStock.created_at.desc()).all()
    return [{"symbol": r.symbol, "name": r.name, "market": r.market} for r in rows]


@router.post("/starred")
def add_starred(payload: StarPayload, db: Session = Depends(get_db)) -> dict:
    existing = db.query(StarredStock).filter(StarredStock.symbol == payload.symbol).first()
    if existing:
        return {"symbol": existing.symbol, "name": existing.name, "market": existing.market}
    row = StarredStock(symbol=payload.symbol, name=payload.name, market=payload.market)
    db.add(row)
    db.commit()
    db.refresh(row)
    return {"symbol": row.symbol, "name": row.name, "market": row.market}


@router.delete("/starred")
def remove_starred(symbol: str = Query(min_length=1), db: Session = Depends(get_db)) -> dict:
    row = db.query(StarredStock).filter(StarredStock.symbol == symbol).first()
    if not row:
        raise HTTPException(status_code=404, detail="Not starred")
    db.delete(row)
    db.commit()
    return {"ok": True}


# ── Stock Color Labels (TradingView-style) ───────────────────────────

from app.models.condition_preference import StockColorLabel


class ColorLabelPayload(BaseModel):
    symbol: str = Field(min_length=1, max_length=16)
    color: str = Field(min_length=1, max_length=16)
    market: str = Field(default="MY", max_length=8)


@router.get("/color-labels")
def list_color_labels(market: str = Query(default="MY"), db: Session = Depends(get_db)) -> list[dict]:
    rows = db.query(StockColorLabel).filter(StockColorLabel.market == market).all()
    return [{"id": r.id, "symbol": r.symbol, "color": r.color, "market": r.market} for r in rows]


@router.put("/color-labels")
def set_color_label(payload: ColorLabelPayload, db: Session = Depends(get_db)) -> dict:
    existing = db.query(StockColorLabel).filter(
        StockColorLabel.symbol == payload.symbol,
        StockColorLabel.market == payload.market,
    ).first()
    if existing:
        existing.color = payload.color
    else:
        existing = StockColorLabel(symbol=payload.symbol, color=payload.color, market=payload.market)
        db.add(existing)
    db.commit()
    db.refresh(existing)
    return {"id": existing.id, "symbol": existing.symbol, "color": existing.color, "market": existing.market}


@router.delete("/color-labels")
def remove_color_label(symbol: str = Query(min_length=1), market: str = Query(default="MY"), db: Session = Depends(get_db)) -> dict:
    row = db.query(StockColorLabel).filter(
        StockColorLabel.symbol == symbol,
        StockColorLabel.market == market,
    ).first()
    if not row:
        raise HTTPException(status_code=404, detail="No color label found")
    db.delete(row)
    db.commit()
    return {"ok": True}


# ═══════════════════════════════════════════════════════════════════════
# US Stock Quotes (for USStockCards)
# ═══════════════════════════════════════════════════════════════════════

# Tiger hot-pick 明星股票 — default watchlist
_US_HOT_STOCKS: dict[str, str] = {
    "NVDA": "Nvidia",
    "TSLA": "Tesla",
    "AAPL": "Apple",
    "MSFT": "Microsoft",
    "META": "Meta",
    "AMZN": "Amazon",
    "GOOGL": "Alphabet",
    "AMD": "AMD",
    "PLTR": "Palantir",
    "COIN": "Coinbase",
}


@router.get("/us-quotes")
async def us_stock_quotes(
    symbols: str = Query(default="", description="Comma-separated symbols. Empty = default hot list"),
):
    """Fetch latest quotes for US stocks via yfinance."""

    if symbols.strip():
        sym_list = [s.strip().upper() for s in symbols.split(",") if s.strip()]
    else:
        sym_list = list(_US_HOT_STOCKS.keys())

    def _run():
        quotes = []
        tickers = yf.Tickers(" ".join(sym_list))
        for sym in sym_list:
            name = _US_HOT_STOCKS.get(sym, sym)
            try:
                info = tickers.tickers[sym].fast_info
                price = float(info.last_price or 0)
                prev = float(info.previous_close or 0)
                change = price - prev
                change_pct = (change / prev * 100) if prev else 0.0
                quotes.append({
                    "symbol": sym,
                    "name": name,
                    "price": round(price, 2),
                    "prev_close": round(prev, 2),
                    "change": round(change, 2),
                    "change_pct": round(change_pct, 2),
                })
            except Exception:
                quotes.append({
                    "symbol": sym, "name": name,
                    "price": 0, "prev_close": 0, "change": 0, "change_pct": 0,
                })
        return quotes

    quotes = await run_in_threadpool(_run)
    return {"quotes": quotes, "timestamp": datetime.now(SGT).strftime("%H:%M:%S SGT")}


@router.get("/us-fear-greed")
async def us_fear_greed_index(
    date: str | None = Query(default=None, description="UTC date in YYYY-MM-DD format"),
) -> dict:
    """Return latest or selected-date US Fear & Greed index via Alternative.me API."""

    requested_date = None
    if date:
        try:
            requested_date = datetime.strptime(date, "%Y-%m-%d").date()
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid date format. Use YYYY-MM-DD")

    def _row_to_payload(row: dict, selected_date: str | None = None) -> dict:
        value_raw = row.get("value")
        value = int(value_raw) if value_raw is not None else None
        classification = (row.get("value_classification") or "Unknown").strip() or "Unknown"
        ts_raw = row.get("timestamp")
        updated_at = None
        date_utc = None
        if ts_raw:
            try:
                dt_utc = datetime.fromtimestamp(int(ts_raw), tz=timezone.utc)
                date_utc = dt_utc.date().isoformat()
                updated_at = dt_utc.astimezone(SGT).isoformat()
            except Exception:
                updated_at = None
                date_utc = None

        return {
            "value": value,
            "classification": classification,
            "updated_at": updated_at,
            "date_utc": date_utc,
            "selected_date": selected_date,
            "source": "alternative.me",
        }

    def _fetch() -> dict:
        url = "https://api.alternative.me/fng/?limit=1&format=json"
        if requested_date:
            # Need history to locate exact requested day.
            url = "https://api.alternative.me/fng/?limit=0&format=json"
        try:
            res = http_requests.get(url, timeout=8)
            res.raise_for_status()
            payload = res.json() if res.content else {}
            data = payload.get("data") or []

            if requested_date:
                found = None
                for row in data:
                    ts_raw = row.get("timestamp")
                    if not ts_raw:
                        continue
                    try:
                        day = datetime.fromtimestamp(int(ts_raw), tz=timezone.utc).date()
                    except Exception:
                        continue
                    if day == requested_date:
                        found = row
                        break
                if found is None:
                    return {
                        "value": None,
                        "classification": "Not Found",
                        "updated_at": None,
                        "date_utc": requested_date.isoformat(),
                        "selected_date": requested_date.isoformat(),
                        "source": "alternative.me",
                    }
                return _row_to_payload(found, requested_date.isoformat())

            row = data[0] if data else {}
            return _row_to_payload(row)
        except Exception as exc:
            logger.warning("FearGreed fetch failed: %s", exc)
            return {
                "value": None,
                "classification": "Unavailable",
                "updated_at": None,
                "date_utc": requested_date.isoformat() if requested_date else None,
                "selected_date": requested_date.isoformat() if requested_date else None,
                "source": "alternative.me",
            }

    return await run_in_threadpool(_fetch)


@router.get("/us-fear-greed-history")
async def us_fear_greed_history(
    days: int = Query(default=5, ge=1, le=30, description="Number of latest days to return"),
) -> dict:
    """Return latest Fear & Greed daily history (newest first)."""

    def _fetch() -> dict:
        url = "https://api.alternative.me/fng/?limit=0&format=json"
        try:
            res = http_requests.get(url, timeout=8)
            res.raise_for_status()
            payload = res.json() if res.content else {}
            data = payload.get("data") or []

            items = []
            for row in data[:days]:
                ts_raw = row.get("timestamp")
                date_utc = None
                updated_at = None
                if ts_raw:
                    try:
                        dt_utc = datetime.fromtimestamp(int(ts_raw), tz=timezone.utc)
                        date_utc = dt_utc.date().isoformat()
                        updated_at = dt_utc.astimezone(SGT).isoformat()
                    except Exception:
                        date_utc = None
                        updated_at = None

                value_raw = row.get("value")
                items.append({
                    "value": int(value_raw) if value_raw is not None else None,
                    "classification": (row.get("value_classification") or "Unknown").strip() or "Unknown",
                    "date_utc": date_utc,
                    "updated_at": updated_at,
                })

            return {
                "days": days,
                "items": items,
                "source": "alternative.me",
            }
        except Exception as exc:
            logger.warning("FearGreed history fetch failed: %s", exc)
            return {
                "days": days,
                "items": [],
                "source": "alternative.me",
            }

    return await run_in_threadpool(_fetch)


# ═══════════════════════════════════════════════════════════════════════
# US Stock 1-Hour Strategy Backtest
# ═══════════════════════════════════════════════════════════════════════

import math as _math
from typing import Optional as _Opt, Annotated as _Ann


def _isnan(v) -> bool:
    try:
        return _math.isnan(float(v))
    except (TypeError, ValueError):
        return True


class US1HCandle(BaseModel):
    time: str
    open: float
    high: float
    low: float
    close: float
    volume: float
    ema_fast: _Opt[float] = None
    ema_slow: _Opt[float] = None
    rsi: _Opt[float] = None
    macd_hist: _Opt[float] = None
    st_dir: _Opt[int] = None
    st_line: _Opt[float] = None
    ht_line: _Opt[float] = None
    ht_dir: _Opt[int] = None
    ht_high: _Opt[float] = None
    ht_low: _Opt[float] = None
    signal: int = 0


class US1HTrade(BaseModel):
    entry_time: str
    exit_time: str
    entry_price: float
    exit_price: float
    qty: int
    pnl: float
    pnl_pct: float
    reason: str
    signal_type: str = ""
    direction: str = "CALL"
    mae: float = 0.0
    mkt_structure: int = 0
    sl_price: float = 0.0


class US1HMetrics(BaseModel):
    initial_capital: float
    final_equity: float
    total_return_pct: float
    max_drawdown_pct: float
    sharpe_ratio: float
    total_trades: int
    winners: int
    losers: int
    win_rate: float
    avg_win: float
    avg_loss: float
    profit_factor: float
    risk_reward_ratio: float
    oos_win_rate: float = 0.0
    oos_total_trades: int = 0
    oos_return_pct: float = 0.0


class US1HBacktestResponse(BaseModel):
    symbol: str
    interval: str
    period: str
    candles: list[US1HCandle]
    trades: list[US1HTrade]
    equity_curve: list[float]
    metrics: US1HMetrics
    daily_pnl: list[dict] = []
    params: dict
    timestamp: str


# ═══════════════════════════════════════════════════════════════════════
# US Strategy Presets — save / load / delete
# ═══════════════════════════════════════════════════════════════════════
import json as _json
from app.models.condition_preference import USStrategyPreset, USStockStrategyTag, MYStrategyPreset, MYStockStrategyTag


class StrategyPresetPayload(BaseModel):
    name: str = Field(min_length=1, max_length=64)
    conditions: dict[str, bool]
    atr_sl_mult: float = 3.0
    atr_tp_mult: float = 2.5
    period: str = "1y"
    skip_flat: bool = False
    strategy_type: str = "breakout_1h"  # breakout_1h | vpb_v2
    capital: float = 5000.0


@router.get("/us-strategy-presets")
def list_strategy_presets(db: Session = Depends(get_db)):
    rows = db.query(USStrategyPreset).order_by(USStrategyPreset.name).all()
    return [
        {
            "id": r.id,
            "name": r.name,
            "conditions": _json.loads(r.conditions_json),
            "atr_sl_mult": r.atr_sl_mult,
            "atr_tp_mult": r.atr_tp_mult,
            "period": r.period,
            "skip_flat": r.skip_flat,
            "capital": getattr(r, "capital", 5000.0) or 5000.0,
            "bt_symbol": r.bt_symbol,
            "bt_win_rate": r.bt_win_rate,
            "bt_return_pct": r.bt_return_pct,
            "bt_max_dd_pct": r.bt_max_dd_pct,
            "bt_profit_factor": r.bt_profit_factor,
            "bt_sharpe": r.bt_sharpe,
            "bt_total_trades": r.bt_total_trades,
            "bt_tested_at": r.bt_tested_at.isoformat() if r.bt_tested_at else None,
            "strategy_type": getattr(r, "strategy_type", "breakout_1h") or "breakout_1h",
            "is_favorite": getattr(r, "is_favorite", False) or False,
        }
        for r in rows
    ]


@router.post("/us-strategy-presets")
def save_strategy_preset(payload: StrategyPresetPayload, db: Session = Depends(get_db)):
    existing = db.query(USStrategyPreset).filter(USStrategyPreset.name == payload.name).first()
    if existing:
        existing.conditions_json = _json.dumps(payload.conditions)
        existing.atr_sl_mult = payload.atr_sl_mult
        existing.atr_tp_mult = payload.atr_tp_mult
        existing.period = payload.period
        existing.skip_flat = payload.skip_flat
        existing.strategy_type = payload.strategy_type
        existing.capital = payload.capital
    else:
        db.add(USStrategyPreset(
            name=payload.name,
            conditions_json=_json.dumps(payload.conditions),
            atr_sl_mult=payload.atr_sl_mult,
            atr_tp_mult=payload.atr_tp_mult,
            period=payload.period,
            skip_flat=payload.skip_flat,
            strategy_type=payload.strategy_type,
            capital=payload.capital,
        ))
    db.commit()
    return {"status": "ok", "name": payload.name}


class PresetMetricsPayload(BaseModel):
    symbol: str
    win_rate: float
    total_return_pct: float
    max_drawdown_pct: float
    profit_factor: float
    sharpe_ratio: float
    total_trades: int


@router.put("/us-strategy-presets/{preset_id}/metrics")
def update_preset_metrics(preset_id: int, payload: PresetMetricsPayload, db: Session = Depends(get_db)):
    preset = db.query(USStrategyPreset).filter(USStrategyPreset.id == preset_id).first()
    if not preset:
        raise HTTPException(status_code=404, detail="Preset not found")
    preset.bt_symbol = payload.symbol
    preset.bt_win_rate = payload.win_rate
    preset.bt_return_pct = payload.total_return_pct
    preset.bt_max_dd_pct = payload.max_drawdown_pct
    preset.bt_profit_factor = payload.profit_factor
    preset.bt_sharpe = payload.sharpe_ratio
    preset.bt_total_trades = payload.total_trades
    preset.bt_tested_at = func.now()
    db.commit()
    return {"status": "ok", "id": preset_id}


@router.delete("/us-strategy-presets/{preset_id}")
def delete_strategy_preset(preset_id: int, db: Session = Depends(get_db)):
    row = db.query(USStrategyPreset).filter(USStrategyPreset.id == preset_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Preset not found")
    db.delete(row)
    db.commit()
    return {"status": "deleted", "id": preset_id}


@router.put("/us-strategy-presets/{preset_id}/favorite")
def toggle_preset_favorite(preset_id: int, db: Session = Depends(get_db)):
    preset = db.query(USStrategyPreset).filter(USStrategyPreset.id == preset_id).first()
    if not preset:
        raise HTTPException(status_code=404, detail="Preset not found")
    preset.is_favorite = not (preset.is_favorite or False)
    db.commit()
    return {"status": "ok", "id": preset_id, "is_favorite": preset.is_favorite}


# ═══════════════════════════════════════════════════════════════════════
# US Stock Strategy Tags — tag stocks with strategies (1:many)
# ═══════════════════════════════════════════════════════════════════════

class StrategyTagPayload(BaseModel):
    symbol: str = Field(min_length=1, max_length=16)
    strategy_type: str = "breakout_1h"
    strategy_name: _Opt[str] = None
    period: str = "2y"
    capital: float = 5000.0
    win_rate: _Opt[float] = None
    return_pct: _Opt[float] = None
    profit_factor: _Opt[float] = None
    max_dd_pct: _Opt[float] = None
    sharpe: _Opt[float] = None
    total_trades: _Opt[int] = None


@router.get("/us-stock-tags")
def list_stock_tags(
    symbol: _Opt[str] = None,
    strategy_type: _Opt[str] = None,
    db: Session = Depends(get_db),
):
    """List all strategy tags, optionally filtered by symbol or strategy_type."""
    q = db.query(USStockStrategyTag)
    if symbol:
        q = q.filter(USStockStrategyTag.symbol == symbol.upper())
    if strategy_type:
        q = q.filter(USStockStrategyTag.strategy_type == strategy_type)
    rows = q.order_by(USStockStrategyTag.symbol, USStockStrategyTag.tagged_at.desc()).all()
    return [
        {
            "id": r.id,
            "symbol": r.symbol,
            "strategy_type": r.strategy_type,
            "strategy_name": r.strategy_name,
            "period": r.period,
            "capital": r.capital,
            "win_rate": r.win_rate,
            "return_pct": r.return_pct,
            "profit_factor": r.profit_factor,
            "max_dd_pct": r.max_dd_pct,
            "sharpe": r.sharpe,
            "total_trades": r.total_trades,
            "tagged_at": r.tagged_at.isoformat() if r.tagged_at else None,
        }
        for r in rows
    ]


@router.post("/us-stock-tags")
def save_stock_tag(payload: StrategyTagPayload, db: Session = Depends(get_db)):
    """Tag a stock with a strategy. Upserts by symbol+strategy_type."""
    sym = payload.symbol.upper()
    existing = db.query(USStockStrategyTag).filter(
        USStockStrategyTag.symbol == sym,
        USStockStrategyTag.strategy_type == payload.strategy_type,
    ).first()
    if existing:
        existing.strategy_name = payload.strategy_name
        existing.period = payload.period
        existing.capital = payload.capital
        existing.win_rate = payload.win_rate
        existing.return_pct = payload.return_pct
        existing.profit_factor = payload.profit_factor
        existing.max_dd_pct = payload.max_dd_pct
        existing.sharpe = payload.sharpe
        existing.total_trades = payload.total_trades
        existing.tagged_at = func.now()
    else:
        db.add(USStockStrategyTag(
            symbol=sym,
            strategy_type=payload.strategy_type,
            strategy_name=payload.strategy_name,
            period=payload.period,
            capital=payload.capital,
            win_rate=payload.win_rate,
            return_pct=payload.return_pct,
            profit_factor=payload.profit_factor,
            max_dd_pct=payload.max_dd_pct,
            sharpe=payload.sharpe,
            total_trades=payload.total_trades,
        ))
    db.commit()
    return {"status": "ok", "symbol": sym, "strategy_type": payload.strategy_type}


@router.delete("/us-stock-tags/{tag_id}")
def delete_stock_tag(tag_id: int, db: Session = Depends(get_db)):
    row = db.query(USStockStrategyTag).filter(USStockStrategyTag.id == tag_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Tag not found")
    db.delete(row)
    db.commit()
    return {"status": "deleted", "id": tag_id}


# ═══════════════════════════════════════════════════════════════════════
# MY (Bursa) Strategy Presets — separate from US presets
# ═══════════════════════════════════════════════════════════════════════

@router.get("/my-strategy-presets")
def list_my_strategy_presets(db: Session = Depends(get_db)):
    rows = db.query(MYStrategyPreset).order_by(MYStrategyPreset.name).all()
    return [
        {
            "id": r.id,
            "name": r.name,
            "conditions": _json.loads(r.conditions_json),
            "atr_sl_mult": r.atr_sl_mult,
            "atr_tp_mult": r.atr_tp_mult,
            "period": r.period,
            "skip_flat": r.skip_flat,
            "capital": getattr(r, "capital", 5000.0) or 5000.0,
            "bt_symbol": r.bt_symbol,
            "bt_win_rate": r.bt_win_rate,
            "bt_return_pct": r.bt_return_pct,
            "bt_max_dd_pct": r.bt_max_dd_pct,
            "bt_profit_factor": r.bt_profit_factor,
            "bt_sharpe": r.bt_sharpe,
            "bt_total_trades": r.bt_total_trades,
            "bt_tested_at": r.bt_tested_at.isoformat() if r.bt_tested_at else None,
            "strategy_type": getattr(r, "strategy_type", "breakout_1h") or "breakout_1h",
            "is_favorite": getattr(r, "is_favorite", False) or False,
        }
        for r in rows
    ]


@router.post("/my-strategy-presets")
def save_my_strategy_preset(payload: StrategyPresetPayload, db: Session = Depends(get_db)):
    existing = db.query(MYStrategyPreset).filter(MYStrategyPreset.name == payload.name).first()
    if existing:
        existing.conditions_json = _json.dumps(payload.conditions)
        existing.atr_sl_mult = payload.atr_sl_mult
        existing.atr_tp_mult = payload.atr_tp_mult
        existing.period = payload.period
        existing.skip_flat = payload.skip_flat
        existing.strategy_type = payload.strategy_type
        existing.capital = payload.capital
    else:
        db.add(MYStrategyPreset(
            name=payload.name,
            conditions_json=_json.dumps(payload.conditions),
            atr_sl_mult=payload.atr_sl_mult,
            atr_tp_mult=payload.atr_tp_mult,
            period=payload.period,
            skip_flat=payload.skip_flat,
            strategy_type=payload.strategy_type,
            capital=payload.capital,
        ))
    db.commit()
    return {"status": "ok", "name": payload.name}


@router.put("/my-strategy-presets/{preset_id}/metrics")
def update_my_preset_metrics(preset_id: int, payload: PresetMetricsPayload, db: Session = Depends(get_db)):
    preset = db.query(MYStrategyPreset).filter(MYStrategyPreset.id == preset_id).first()
    if not preset:
        raise HTTPException(status_code=404, detail="Preset not found")
    preset.bt_symbol = payload.symbol
    preset.bt_win_rate = payload.win_rate
    preset.bt_return_pct = payload.total_return_pct
    preset.bt_max_dd_pct = payload.max_drawdown_pct
    preset.bt_profit_factor = payload.profit_factor
    preset.bt_sharpe = payload.sharpe_ratio
    preset.bt_total_trades = payload.total_trades
    preset.bt_tested_at = func.now()
    db.commit()
    return {"status": "ok", "id": preset_id}


@router.delete("/my-strategy-presets/{preset_id}")
def delete_my_strategy_preset(preset_id: int, db: Session = Depends(get_db)):
    row = db.query(MYStrategyPreset).filter(MYStrategyPreset.id == preset_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Preset not found")
    db.delete(row)
    db.commit()
    return {"status": "deleted", "id": preset_id}


@router.put("/my-strategy-presets/{preset_id}/favorite")
def toggle_my_preset_favorite(preset_id: int, db: Session = Depends(get_db)):
    preset = db.query(MYStrategyPreset).filter(MYStrategyPreset.id == preset_id).first()
    if not preset:
        raise HTTPException(status_code=404, detail="Preset not found")
    preset.is_favorite = not (preset.is_favorite or False)
    db.commit()
    return {"status": "ok", "id": preset_id, "is_favorite": preset.is_favorite}


# ═══════════════════════════════════════════════════════════════════════
# MY (Bursa) Stock Strategy Tags
# ═══════════════════════════════════════════════════════════════════════

@router.get("/my-stock-tags")
def list_my_stock_tags(
    symbol: _Opt[str] = None,
    strategy_type: _Opt[str] = None,
    db: Session = Depends(get_db),
):
    q = db.query(MYStockStrategyTag)
    if symbol:
        q = q.filter(MYStockStrategyTag.symbol == symbol.upper())
    if strategy_type:
        q = q.filter(MYStockStrategyTag.strategy_type == strategy_type)
    rows = q.order_by(MYStockStrategyTag.symbol, MYStockStrategyTag.tagged_at.desc()).all()
    return [
        {
            "id": r.id,
            "symbol": r.symbol,
            "strategy_type": r.strategy_type,
            "strategy_name": r.strategy_name,
            "period": r.period,
            "capital": r.capital,
            "win_rate": r.win_rate,
            "return_pct": r.return_pct,
            "profit_factor": r.profit_factor,
            "max_dd_pct": r.max_dd_pct,
            "sharpe": r.sharpe,
            "total_trades": r.total_trades,
            "tagged_at": r.tagged_at.isoformat() if r.tagged_at else None,
        }
        for r in rows
    ]


@router.post("/my-stock-tags")
def save_my_stock_tag(payload: StrategyTagPayload, db: Session = Depends(get_db)):
    sym = payload.symbol.upper()
    existing = db.query(MYStockStrategyTag).filter(
        MYStockStrategyTag.symbol == sym,
        MYStockStrategyTag.strategy_type == payload.strategy_type,
    ).first()
    if existing:
        existing.strategy_name = payload.strategy_name
        existing.period = payload.period
        existing.capital = payload.capital
        existing.win_rate = payload.win_rate
        existing.return_pct = payload.return_pct
        existing.profit_factor = payload.profit_factor
        existing.max_dd_pct = payload.max_dd_pct
        existing.sharpe = payload.sharpe
        existing.total_trades = payload.total_trades
        existing.tagged_at = func.now()
    else:
        db.add(MYStockStrategyTag(
            symbol=sym,
            strategy_type=payload.strategy_type,
            strategy_name=payload.strategy_name,
            period=payload.period,
            capital=payload.capital,
            win_rate=payload.win_rate,
            return_pct=payload.return_pct,
            profit_factor=payload.profit_factor,
            max_dd_pct=payload.max_dd_pct,
            sharpe=payload.sharpe,
            total_trades=payload.total_trades,
        ))
    db.commit()
    return {"status": "ok", "symbol": sym, "strategy_type": payload.strategy_type}


@router.delete("/my-stock-tags/{tag_id}")
def delete_my_stock_tag(tag_id: int, db: Session = Depends(get_db)):
    row = db.query(MYStockStrategyTag).filter(MYStockStrategyTag.id == tag_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Tag not found")
    db.delete(row)
    db.commit()
    return {"status": "deleted", "id": tag_id}


@router.get("/backtest_1h")
async def us_stock_backtest_1h(
    symbol: _Ann[str, Query()] = "AAPL",
    period: _Ann[str, Query()] = "1y",
    capital: _Ann[float, Query()] = 5000.0,
    oos_split: _Ann[float, Query(ge=0, le=0.5)] = 0.3,
    atr_sl_mult: _Ann[float, Query(ge=0.5, le=10.0)] = 3.0,
    atr_tp_mult: _Ann[float, Query(ge=0.5, le=10.0)] = 2.5,
    date_from: _Ann[_Opt[str], Query()] = None,
    date_to: _Ann[_Opt[str], Query()] = None,
    disabled_conditions: _Ann[_Opt[str], Query()] = None,
    skip_flat: _Ann[bool, Query()] = False,
) -> US1HBacktestResponse:
    """Run 1-hour strategy backtest on a US stock."""

    _disabled: set[str] = set()
    if disabled_conditions:
        _valid = {"ema_trend", "ema_slope", "pullback", "breakout", "supertrend",
                  "macd_momentum", "rsi_momentum", "volume_spike", "atr_range", "session_ok", "adx_ok", "ht_trend"}
        _disabled = {c.strip() for c in disabled_conditions.split(",") if c.strip() in _valid}

    def _run():
        from strategies.futures.data_loader import load_yfinance
        from strategies.us_stock.backtest_1h import Backtester1H
        from strategies.us_stock.strategy_1h import USStrategy1H, DEFAULT_1H_PARAMS

        _period_days_map = {"1mo": 30, "3mo": 90, "6mo": 180, "1y": 365, "2y": 730}

        df = load_yfinance(symbol=symbol, interval="1h", period=period)
        if df.empty or len(df) < 20:
            raise ValueError(f"Not enough 1h data for {symbol}.")

        if date_to:
            trade_end = pd.Timestamp(date_to, tz=df.index.tz) + pd.Timedelta(days=1)
            df = df[df.index < trade_end]

        custom_params = {"atr_sl_mult": atr_sl_mult, "atr_tp_mult": atr_tp_mult}
        bt = Backtester1H(capital=capital)
        result = bt.run(df, params=custom_params, oos_split=oos_split,
                        disabled_conditions=_disabled or None, skip_flat=skip_flat)

        # Display window
        display_start: str | None = None
        if date_from:
            display_start = date_from
        elif period not in ("2y", "max"):
            _days = _period_days_map.get(period, 730)
            if _days < 730:
                cutoff = df.index[-1] - pd.Timedelta(days=_days)
                display_start = cutoff.strftime("%Y-%m-%d")

        filtered_trades = result.trades
        if display_start:
            filtered_trades = [t for t in result.trades if str(t.exit_time)[:10] >= display_start]

        filtered_daily = result.daily_pnl
        if display_start:
            filtered_daily = [d for d in result.daily_pnl if d["date"] >= display_start]

        # Recompute display-window metrics
        display_wins = [t for t in filtered_trades if t.pnl > 0]
        display_losses = [t for t in filtered_trades if t.pnl <= 0]
        n_trades = len(filtered_trades)
        display_total_pnl = sum(t.pnl for t in filtered_trades)

        metrics = US1HMetrics(
            initial_capital=result.initial_capital,
            final_equity=round(result.initial_capital + display_total_pnl, 2),
            total_return_pct=round(display_total_pnl / result.initial_capital * 100, 2) if result.initial_capital else 0,
            max_drawdown_pct=result.max_drawdown_pct,
            sharpe_ratio=result.sharpe_ratio,
            total_trades=n_trades,
            winners=len(display_wins),
            losers=len(display_losses),
            win_rate=round(len(display_wins) / n_trades * 100, 1) if n_trades else 0,
            avg_win=round(sum(t.pnl for t in display_wins) / len(display_wins), 2) if display_wins else 0,
            avg_loss=round(sum(t.pnl for t in display_losses) / len(display_losses), 2) if display_losses else 0,
            profit_factor=round(
                abs(sum(t.pnl for t in display_wins) / sum(t.pnl for t in display_losses)), 2
            ) if display_losses and sum(t.pnl for t in display_losses) != 0 else 999.0,
            risk_reward_ratio=result.risk_reward_ratio,
            oos_win_rate=result.oos_win_rate,
            oos_total_trades=result.oos_total_trades,
            oos_return_pct=result.oos_return_pct,
        )

        # Build candles
        strategy = USStrategy1H({**DEFAULT_1H_PARAMS, **custom_params})
        df_ind = strategy.compute_indicators(
            df[["open", "high", "low", "close", "volume"]].copy()
        )

        # Compute daily HalfTrend and merge into 1H bars
        df_daily = load_yfinance(symbol=symbol, interval="1d", period="5y")
        if not df_daily.empty:
            df_daily_ht = strategy.compute_daily_ht(df_daily[["open", "high", "low", "close", "volume"]].copy())
            df_ind = strategy.merge_daily_ht(df_ind, df_daily_ht)

        signals = strategy.generate_signals(df_ind)
        if display_start:
            ts = pd.Timestamp(display_start, tz=df_ind.index.tz)
            df_ind = df_ind[df_ind.index >= ts]
            signals = signals[df_ind.index]
        df_ind["signal"] = signals

        candles = []
        for ts_val, row in df_ind.iterrows():
            candles.append(US1HCandle(
                time=ts_val.isoformat(),
                open=round(float(row["open"]), 2),
                high=round(float(row["high"]), 2),
                low=round(float(row["low"]), 2),
                close=round(float(row["close"]), 2),
                volume=float(row.get("volume", 0)),
                ema_fast=round(float(row["ema_fast"]), 2) if not _isnan(row.get("ema_fast")) else None,
                ema_slow=round(float(row["ema_slow"]), 2) if not _isnan(row.get("ema_slow")) else None,
                rsi=round(float(row["rsi"]), 1) if not _isnan(row.get("rsi")) else None,
                macd_hist=round(float(row["macd_hist"]), 4) if not _isnan(row.get("macd_hist")) else None,
                st_dir=int(row["st_dir"]) if not _isnan(row.get("st_dir")) else None,
                st_line=round(float(row["st_line"]), 2) if not _isnan(row.get("st_line")) else None,
                ht_line=round(float(row["ht_line"]), 2) if not _isnan(row.get("ht_line")) else None,
                ht_dir=int(row["ht_dir"]) if not _isnan(row.get("ht_dir")) else None,
                ht_high=round(float(row["ht_high"]), 2) if not _isnan(row.get("ht_high")) else None,
                ht_low=round(float(row["ht_low"]), 2) if not _isnan(row.get("ht_low")) else None,
                signal=int(row.get("signal", 0)),
            ))

        trades = [
            US1HTrade(
                entry_time=t.entry_time.isoformat() if hasattr(t.entry_time, 'isoformat') else str(t.entry_time),
                exit_time=t.exit_time.isoformat() if hasattr(t.exit_time, 'isoformat') else str(t.exit_time),
                entry_price=round(t.entry_price, 2),
                exit_price=round(t.exit_price, 2),
                qty=t.qty,
                pnl=round(t.pnl, 2),
                pnl_pct=round(t.pnl_pct, 2),
                reason=t.reason,
                signal_type=t.signal_type,
                direction=t.direction,
                mae=round(t.mae, 2),
                mkt_structure=getattr(t, "mkt_structure", 0),
            )
            for t in filtered_trades
        ]

        return candles, trades, result.equity_curve, metrics, result.params, filtered_daily

    try:
        candles, trades, eq_curve, metrics, params, daily_pnl = await run_in_threadpool(_run)
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as exc:
        logger.exception("1h backtest failed for %s", symbol)
        raise HTTPException(status_code=500, detail=str(exc))

    return US1HBacktestResponse(
        symbol=symbol,
        interval="1h",
        period=period,
        candles=candles,
        trades=trades,
        equity_curve=eq_curve,
        metrics=metrics,
        daily_pnl=daily_pnl,
        params=params,
        timestamp=datetime.now(SGT).strftime("%d/%m/%Y %H:%M SGT"),
    )


# ═══════════════════════════════════════════════════════════════════════
# VPB Strategy Backtest (v1 and v2)
# ═══════════════════════════════════════════════════════════════════════


@router.get("/backtest_vpb")
async def us_stock_backtest_vpb(
    symbol: _Ann[str, Query()] = "AAPL",
    period: _Ann[str, Query()] = "1y",
    version: _Ann[str, Query()] = "v2",
    capital: _Ann[float, Query()] = 5000.0,
    disabled_conditions: _Ann[_Opt[str], Query()] = None,
    # VPB params overrides
    atr_sl_mult: _Ann[_Opt[float], Query()] = None,
    tp_r_multiple: _Ann[_Opt[float], Query()] = None,
    vol_multiplier: _Ann[_Opt[float], Query()] = None,
    body_ratio_min: _Ann[_Opt[float], Query()] = None,
    consol_range_atr_mult: _Ann[_Opt[float], Query()] = None,
    ema_slope_min: _Ann[_Opt[float], Query()] = None,
    require_retest: _Ann[_Opt[bool], Query()] = None,
    date_from: _Ann[_Opt[str], Query()] = None,
    date_to: _Ann[_Opt[str], Query()] = None,
) -> US1HBacktestResponse:
    """Run VPB strategy backtest (v1 or v2) on a US stock."""

    _disabled: set[str] = set()
    if disabled_conditions:
        _valid = {"ema_trend", "ema_slope", "ema_alignment", "vol_spike", "vol_ramp",
                  "body_strength", "close_near_high", "bullish_candle", "session",
                  # v3 conditions
                  "daily_trend", "accum", "breakout", "vol_surge", "rsi",
                  "h_ema_trend", "candle_quality"}
        _disabled = {c.strip() for c in disabled_conditions.split(",") if c.strip() in _valid}

    def _run():
        from strategies.futures.data_loader import load_yfinance

        df = load_yfinance(symbol=symbol, interval="1h", period=period)
        if df.empty or len(df) < 20:
            raise ValueError(f"Not enough 1h data for {symbol}.")

        if date_to:
            trade_end = pd.Timestamp(date_to, tz=df.index.tz) + pd.Timedelta(days=1)
            df = df[df.index < trade_end]

        # Build param overrides
        param_overrides: dict = {}
        if atr_sl_mult is not None:
            param_overrides["atr_sl_mult"] = atr_sl_mult
        if tp_r_multiple is not None:
            param_overrides["tp_r_multiple"] = tp_r_multiple
        if vol_multiplier is not None:
            param_overrides["vol_multiplier"] = vol_multiplier
        if body_ratio_min is not None:
            param_overrides["body_ratio_min"] = body_ratio_min
        if consol_range_atr_mult is not None:
            param_overrides["consol_range_atr_mult"] = consol_range_atr_mult
        if ema_slope_min is not None:
            param_overrides["ema_slope_min"] = ema_slope_min
        if require_retest is not None:
            param_overrides["require_retest"] = require_retest

        if version == "v2":
            from strategies.us_stock.vpb_v2_backtest import VPB2Backtester
            from strategies.us_stock.vpb_v2_strategy import VPBv2Strategy, DEFAULT_VPB2_PARAMS
            bt = VPB2Backtester(capital=capital)
            result = bt.run(df, params=param_overrides, disabled_conditions=_disabled or None)
            full_params = {**DEFAULT_VPB2_PARAMS, **param_overrides}
            strategy = VPBv2Strategy(full_params)
        elif version == "v3":
            from strategies.us_stock.vpb_v3_backtest import VPB3Backtester
            from strategies.us_stock.vpb_v3_strategy import VPBv3Strategy, DEFAULT_VPB3_PARAMS
            from strategies.us_stock.config import VPB3_RISK_PER_TRADE

            # Load daily data for multi-TF context
            df_daily = load_yfinance(symbol=symbol, interval="1d", period="5y")
            bt = VPB3Backtester(capital=capital, risk_per_trade=VPB3_RISK_PER_TRADE)
            result = bt.run(
                symbol=symbol, period=period,
                params=param_overrides,
                disabled_conditions=_disabled or None,
                df_daily=df_daily, df_1h=df,
            )
            full_params = {**DEFAULT_VPB3_PARAMS, **param_overrides}
            strategy = VPBv3Strategy(full_params)
        else:
            raise ValueError("Supported versions: v2, v3")

        # Build candles with indicators
        if version == "v3":
            # v3 uses different indicator columns
            df_ctx = strategy.compute_daily_context(
                load_yfinance(symbol=symbol, interval="1d", period="5y")[["open", "high", "low", "close", "volume"]].copy()
            ) if "d_trend_up" not in df.columns else None
            df_ind = strategy.compute_1h_indicators(
                df[["open", "high", "low", "close", "volume"]].copy()
            )
            if df_ctx is not None:
                df_ind = strategy.map_daily_to_1h(df_ctx, df_ind)
            signals = strategy.generate_signals(df_ind, disabled=_disabled or None)
        else:
            df_ind = strategy.compute_indicators(
                df[["open", "high", "low", "close", "volume"]].copy()
            )
            signals = strategy.generate_signals(df_ind, disabled=_disabled or None)

        # Apply date filter
        display_start: str | None = None
        if date_from:
            display_start = date_from
        elif period not in ("2y", "max"):
            _period_days = {"1mo": 30, "3mo": 90, "6mo": 180, "1y": 365}
            _days = _period_days.get(period, 730)
            if _days < 730:
                cutoff = df_ind.index[-1] - pd.Timedelta(days=_days)
                display_start = cutoff.strftime("%Y-%m-%d")

        if display_start:
            ts = pd.Timestamp(display_start, tz=df_ind.index.tz)
            df_ind = df_ind[df_ind.index >= ts]
            signals = signals[df_ind.index]
        df_ind["signal"] = signals

        candles = []
        for ts_val, row in df_ind.iterrows():
            if version == "v3":
                ema_f = round(float(row.get("h_ema", 0)), 2) if not _isnan(row.get("h_ema")) else None
                ema_s = round(float(row.get("d_ema_fast", 0)), 2) if not _isnan(row.get("d_ema_fast")) else None
                rsi_val = round(float(row.get("h_rsi", 0)), 2) if not _isnan(row.get("h_rsi")) else None
            else:
                ema_f = round(float(row.get("ema_fast", 0)), 2) if not _isnan(row.get("ema_fast")) else None
                if version == "v2":
                    ema_s = round(float(row.get("ema_mid", 0)), 2) if not _isnan(row.get("ema_mid")) else None
                else:
                    ema_s = None
                rsi_val = None
            candles.append(US1HCandle(
                time=ts_val.isoformat(),
                open=round(float(row["open"]), 2),
                high=round(float(row["high"]), 2),
                low=round(float(row["low"]), 2),
                close=round(float(row["close"]), 2),
                volume=float(row.get("volume", 0)),
                ema_fast=ema_f,
                ema_slow=ema_s,
                rsi=rsi_val if version == "v3" else None,
                macd_hist=None,
                st_dir=None,
                signal=int(row.get("signal", 0)),
            ))

        # Filter trades by date
        filtered_trades = result.trades
        if display_start:
            filtered_trades = [t for t in result.trades if str(t.exit_time)[:10] >= display_start]

        filtered_daily = result.daily_pnl if hasattr(result, "daily_pnl") else []
        if display_start and filtered_daily:
            filtered_daily = [d for d in filtered_daily if d["date"] >= display_start]

        # Compute display metrics
        wins = [t for t in filtered_trades if t.pnl > 0]
        losses = [t for t in filtered_trades if t.pnl <= 0]
        n_trades = len(filtered_trades)
        total_pnl = sum(t.pnl for t in filtered_trades)

        metrics = US1HMetrics(
            initial_capital=result.initial_capital,
            final_equity=round(result.initial_capital + total_pnl, 2),
            total_return_pct=round(total_pnl / result.initial_capital * 100, 2) if result.initial_capital else 0,
            max_drawdown_pct=result.max_drawdown_pct,
            sharpe_ratio=result.sharpe_ratio,
            total_trades=n_trades,
            winners=len(wins),
            losers=len(losses),
            win_rate=round(len(wins) / n_trades * 100, 1) if n_trades else 0,
            avg_win=round(sum(t.pnl for t in wins) / len(wins), 2) if wins else 0,
            avg_loss=round(sum(t.pnl for t in losses) / len(losses), 2) if losses else 0,
            profit_factor=round(
                abs(sum(t.pnl for t in wins) / sum(t.pnl for t in losses)), 2
            ) if losses and sum(t.pnl for t in losses) != 0 else 999.0,
            risk_reward_ratio=result.risk_reward_ratio,
        )

        trades_out = [
            US1HTrade(
                entry_time=t.entry_time.isoformat() if hasattr(t.entry_time, "isoformat") else str(t.entry_time),
                exit_time=t.exit_time.isoformat() if hasattr(t.exit_time, "isoformat") else str(t.exit_time),
                entry_price=round(t.entry_price, 2),
                exit_price=round(t.exit_price, 2),
                qty=t.qty,
                pnl=round(t.pnl, 2),
                pnl_pct=round(t.pnl_pct, 2),
                reason=t.reason,
                signal_type=getattr(t, "signal_type", "VPB"),
                direction="CALL" if t.direction == "LONG" else "PUT",
                mae=round(t.mae, 2),
            )
            for t in filtered_trades
        ]

        return candles, trades_out, result.equity_curve, metrics, full_params, filtered_daily

    try:
        candles, trades, eq_curve, metrics, params, daily_pnl = await run_in_threadpool(_run)
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as exc:
        logger.exception("VPB %s backtest failed for %s", version, symbol)
        raise HTTPException(status_code=500, detail=str(exc))

    return US1HBacktestResponse(
        symbol=symbol,
        interval="1h",
        period=period,
        candles=candles,
        trades=trades,
        equity_curve=eq_curve,
        metrics=metrics,
        daily_pnl=daily_pnl,
        params=params,
        timestamp=datetime.now(SGT).strftime("%d/%m/%Y %H:%M SGT"),
    )


# ═══════════════════════════════════════════════════════════════════════
# VPR Strategy Backtest (Volume Profile + VWAP + RSI)
# ═══════════════════════════════════════════════════════════════════════

@router.get("/backtest_vpr")
async def us_stock_backtest_vpr(
    symbol: _Ann[str, Query()] = "AAPL",
    period: _Ann[str, Query()] = "1y",
    capital: _Ann[float, Query()] = 5000.0,
    disabled_conditions: _Ann[_Opt[str], Query()] = None,
    atr_sl_mult: _Ann[_Opt[float], Query()] = None,
    rsi_low: _Ann[_Opt[int], Query()] = None,
    rsi_high: _Ann[_Opt[int], Query()] = None,
    tp2_r_mult: _Ann[_Opt[float], Query()] = None,
    date_from: _Ann[_Opt[str], Query()] = None,
    date_to: _Ann[_Opt[str], Query()] = None,
) -> US1HBacktestResponse:
    """Run VPR strategy backtest (Volume Profile + VWAP + RSI) on a US stock."""

    _disabled: set[str] = set()
    if disabled_conditions:
        _valid = {"vwap_bias", "vol_profile", "rsi_momentum", "bullish_candle", "session"}
        _disabled = {c.strip() for c in disabled_conditions.split(",") if c.strip() in _valid}

    def _run():
        from strategies.futures.data_loader import load_yfinance
        from strategies.us_stock.vpr.backtest import VPRBacktester
        from strategies.us_stock.vpr.strategy import VPRStrategy
        from strategies.us_stock.vpr.config import DEFAULT_VPR_PARAMS

        df = load_yfinance(symbol=symbol, interval="1h", period=period)
        if df.empty or len(df) < 120:
            raise ValueError(f"Not enough 1h data for {symbol}.")

        if date_to:
            trade_end = pd.Timestamp(date_to, tz=df.index.tz) + pd.Timedelta(days=1)
            df = df[df.index < trade_end]

        param_overrides: dict = {}
        if atr_sl_mult is not None:
            param_overrides["atr_sl_mult"] = atr_sl_mult
        if rsi_low is not None:
            param_overrides["rsi_low"] = rsi_low
        if rsi_high is not None:
            param_overrides["rsi_high"] = rsi_high
        if tp2_r_mult is not None:
            param_overrides["tp2_r_mult"] = tp2_r_mult

        bt = VPRBacktester(capital=capital)
        result = bt.run(df, params=param_overrides, disabled_conditions=_disabled or None)
        full_params = {**DEFAULT_VPR_PARAMS, **param_overrides}

        # Build candles with VWAP + POC + RSI
        strategy = VPRStrategy(full_params)
        df_ind = strategy.compute_indicators(
            df[["open", "high", "low", "close", "volume"]].copy()
        )
        signals = strategy.generate_signals(df_ind, disabled=_disabled or None)

        display_start: _Opt[str] = None
        if date_from:
            display_start = date_from
        elif period not in ("2y", "max"):
            _period_days = {"1mo": 30, "3mo": 90, "6mo": 180, "1y": 365}
            _days = _period_days.get(period, 730)
            if _days < 730:
                cutoff = df_ind.index[-1] - pd.Timedelta(days=_days)
                display_start = cutoff.strftime("%Y-%m-%d")

        if display_start:
            ts = pd.Timestamp(display_start, tz=df_ind.index.tz)
            df_ind = df_ind[df_ind.index >= ts]
            signals = signals[df_ind.index]
        df_ind["signal"] = signals

        candles = []
        for ts_val, row in df_ind.iterrows():
            candles.append(US1HCandle(
                time=ts_val.isoformat(),
                open=round(float(row["open"]), 2),
                high=round(float(row["high"]), 2),
                low=round(float(row["low"]), 2),
                close=round(float(row["close"]), 2),
                volume=float(row.get("volume", 0)),
                ema_fast=round(float(row["vwap"]), 2) if not _isnan(row.get("vwap")) else None,
                ema_slow=round(float(row["poc"]), 2) if not _isnan(row.get("poc")) else None,
                rsi=round(float(row["rsi"]), 1) if not _isnan(row.get("rsi")) else None,
                macd_hist=None,
                st_dir=None,
                signal=int(row.get("signal", 0)),
            ))

        filtered_trades = result.trades
        if display_start:
            filtered_trades = [t for t in result.trades if str(t.exit_time)[:10] >= display_start]

        filtered_daily = result.daily_pnl if hasattr(result, "daily_pnl") else []
        if display_start and filtered_daily:
            filtered_daily = [d for d in filtered_daily if d["date"] >= display_start]

        wins = [t for t in filtered_trades if t.pnl > 0]
        losses = [t for t in filtered_trades if t.pnl <= 0]
        n_trades = len(filtered_trades)
        total_pnl = sum(t.pnl for t in filtered_trades)

        metrics = US1HMetrics(
            initial_capital=result.initial_capital,
            final_equity=round(result.initial_capital + total_pnl, 2),
            total_return_pct=round(total_pnl / result.initial_capital * 100, 2) if result.initial_capital else 0,
            max_drawdown_pct=result.max_drawdown_pct,
            sharpe_ratio=result.sharpe_ratio,
            total_trades=n_trades,
            winners=len(wins),
            losers=len(losses),
            win_rate=round(len(wins) / n_trades * 100, 1) if n_trades else 0,
            avg_win=round(sum(t.pnl for t in wins) / len(wins), 2) if wins else 0,
            avg_loss=round(sum(t.pnl for t in losses) / len(losses), 2) if losses else 0,
            profit_factor=round(
                abs(sum(t.pnl for t in wins) / sum(t.pnl for t in losses)), 2
            ) if losses and sum(t.pnl for t in losses) != 0 else 999.0,
            risk_reward_ratio=round(abs(result.avg_win / result.avg_loss), 2) if result.avg_loss != 0 else 999.0,
        )

        trades_out = [
            US1HTrade(
                entry_time=t.entry_time.isoformat() if hasattr(t.entry_time, "isoformat") else str(t.entry_time),
                exit_time=t.exit_time.isoformat() if hasattr(t.exit_time, "isoformat") else str(t.exit_time),
                entry_price=round(t.entry_price, 2),
                exit_price=round(t.exit_price, 2),
                qty=t.qty,
                pnl=round(t.pnl, 2),
                pnl_pct=round(t.pnl_pct, 2),
                reason=t.reason,
                signal_type="VPR",
                direction="CALL",
                mae=0.0,
            )
            for t in filtered_trades
        ]

        return candles, trades_out, result.equity_curve, metrics, full_params, filtered_daily

    try:
        candles, trades, eq_curve, metrics, params, daily_pnl = await run_in_threadpool(_run)
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as exc:
        logger.exception("VPR backtest failed for %s", symbol)
        raise HTTPException(status_code=500, detail=str(exc))

    return US1HBacktestResponse(
        symbol=symbol,
        interval="1h",
        period=period,
        candles=candles,
        trades=trades,
        equity_curve=eq_curve,
        metrics=metrics,
        daily_pnl=daily_pnl,
        params=params,
        timestamp=datetime.now(SGT).strftime("%d/%m/%Y %H:%M SGT"),
    )


# ═══════════════════════════════════════════════════════════════════════
# MTF Strategy Backtest (Daily SuperTrend+HalfTrend + 4H Entry)
# ═══════════════════════════════════════════════════════════════════════

@router.get("/backtest_mtf")
async def us_stock_backtest_mtf(
    symbol: _Ann[str, Query()] = "AAPL",
    period: _Ann[str, Query()] = "1y",
    capital: _Ann[float, Query()] = 5000.0,
    disabled_conditions: _Ann[_Opt[str], Query()] = None,
    atr_sl_mult: _Ann[_Opt[float], Query()] = None,
    tp1_r_mult: _Ann[_Opt[float], Query()] = None,
    tp2_r_mult: _Ann[_Opt[float], Query()] = None,
    st_period: _Ann[_Opt[int], Query()] = None,
    st_mult: _Ann[_Opt[float], Query()] = None,
    sma_slow: _Ann[_Opt[int], Query()] = None,
    date_from: _Ann[_Opt[str], Query()] = None,
    date_to: _Ann[_Opt[str], Query()] = None,
) -> US1HBacktestResponse:
    """Run MTF strategy backtest (Daily trend + 4H entry) on a US stock."""

    _disabled: set[str] = set()
    if disabled_conditions:
        _valid = {"st_trend", "ht_trend", "ht_reconfirm", "sma_trend", "ema_alignment", "rsi_filter", "bullish_candle"}
        _disabled = {c.strip() for c in disabled_conditions.split(",") if c.strip() in _valid}

    def _run():
        from strategies.futures.data_loader import load_yfinance
        from strategies.us_stock.mtf.backtest import MTFBacktester
        from strategies.us_stock.mtf.strategy import MTFStrategy
        from strategies.us_stock.mtf.config import DEFAULT_MTF_PARAMS

        # Load daily + 1H (resample to 4H)
        df_daily = load_yfinance(symbol=symbol, interval="1d", period=period)
        df_1h = load_yfinance(symbol=symbol, interval="1h", period=period)

        if df_daily.empty or len(df_daily) < 60:
            raise ValueError(f"Not enough daily data for {symbol}.")
        if df_1h.empty or len(df_1h) < 120:
            raise ValueError(f"Not enough 1H data for {symbol}.")

        # Resample 1H → 4H
        df_4h = df_1h.resample("4h").agg({
            "open": "first", "high": "max", "low": "min",
            "close": "last", "volume": "sum",
        }).dropna(subset=["close"])

        param_overrides: dict = {}
        if atr_sl_mult is not None:
            param_overrides["atr_sl_mult"] = atr_sl_mult
        if tp1_r_mult is not None:
            param_overrides["tp1_r_mult"] = tp1_r_mult
        if tp2_r_mult is not None:
            param_overrides["tp2_r_mult"] = tp2_r_mult
        if st_period is not None:
            param_overrides["st_period"] = st_period
        if st_mult is not None:
            param_overrides["st_mult"] = st_mult
        if sma_slow is not None:
            param_overrides["sma_slow"] = sma_slow

        bt = MTFBacktester(capital=capital)
        result = bt.run(
            df_4h, df_daily, params=param_overrides,
            date_from=date_from, date_to=date_to,
            disabled_conditions=_disabled or None,
        )
        full_params = {**DEFAULT_MTF_PARAMS, **param_overrides}

        # Build candles from 4H data with indicators
        strategy = MTFStrategy(full_params)
        df_d = strategy.compute_daily(df_daily[["open", "high", "low", "close", "volume"]].copy())
        df_4h_ind = strategy.compute_4h(df_4h[["open", "high", "low", "close", "volume"]].copy())
        df_4h_ind = strategy.merge_daily_into_4h(df_4h_ind, df_d)
        signals = strategy.generate_signals(df_4h_ind, disabled=_disabled or None)

        display_start: _Opt[str] = None
        if date_from:
            display_start = date_from
        elif period not in ("2y", "max"):
            _period_days = {"1mo": 30, "3mo": 90, "6mo": 180, "1y": 365}
            _days = _period_days.get(period, 730)
            if _days < 730:
                cutoff = df_4h_ind.index[-1] - pd.Timedelta(days=_days)
                display_start = cutoff.strftime("%Y-%m-%d")

        if display_start:
            ts = pd.Timestamp(display_start, tz=df_4h_ind.index.tz)
            df_4h_ind = df_4h_ind[df_4h_ind.index >= ts]
            signals = signals[df_4h_ind.index]
        df_4h_ind["signal"] = signals

        candles = []
        for ts_val, row in df_4h_ind.iterrows():
            candles.append(US1HCandle(
                time=ts_val.isoformat(),
                open=round(float(row["open"]), 2),
                high=round(float(row["high"]), 2),
                low=round(float(row["low"]), 2),
                close=round(float(row["close"]), 2),
                volume=float(row.get("volume", 0)),
                ema_fast=round(float(row["ema_fast"]), 2) if not _isnan(row.get("ema_fast")) else None,
                ema_slow=round(float(row["ema_slow"]), 2) if not _isnan(row.get("ema_slow")) else None,
                rsi=round(float(row["rsi"]), 1) if not _isnan(row.get("rsi")) else None,
                macd_hist=None,
                st_dir=int(row["d_st_dir"]) if not _isnan(row.get("d_st_dir")) else None,
                signal=int(row.get("signal", 0)),
            ))

        filtered_trades = result.trades
        if display_start:
            filtered_trades = [t for t in result.trades if str(t.exit_time)[:10] >= display_start]

        filtered_daily = result.daily_pnl
        if display_start and filtered_daily:
            filtered_daily = [d for d in filtered_daily if d["date"] >= display_start]

        wins = [t for t in filtered_trades if t.pnl > 0]
        losses = [t for t in filtered_trades if t.pnl <= 0]
        n_trades = len(filtered_trades)
        total_pnl = sum(t.pnl for t in filtered_trades)

        metrics = US1HMetrics(
            initial_capital=result.initial_capital,
            final_equity=round(result.initial_capital + total_pnl, 2),
            total_return_pct=round(total_pnl / result.initial_capital * 100, 2) if result.initial_capital else 0,
            max_drawdown_pct=result.max_drawdown_pct,
            sharpe_ratio=result.sharpe_ratio,
            total_trades=n_trades,
            winners=len(wins),
            losers=len(losses),
            win_rate=round(len(wins) / n_trades * 100, 1) if n_trades else 0,
            avg_win=round(sum(t.pnl for t in wins) / len(wins), 2) if wins else 0,
            avg_loss=round(sum(t.pnl for t in losses) / len(losses), 2) if losses else 0,
            profit_factor=round(
                abs(sum(t.pnl for t in wins) / sum(t.pnl for t in losses)), 2
            ) if losses and sum(t.pnl for t in losses) != 0 else 999.0,
            risk_reward_ratio=round(abs(result.avg_win / result.avg_loss), 2) if result.avg_loss != 0 else 999.0,
        )

        trades_out = [
            US1HTrade(
                entry_time=t.entry_time.isoformat() if hasattr(t.entry_time, "isoformat") else str(t.entry_time),
                exit_time=t.exit_time.isoformat() if hasattr(t.exit_time, "isoformat") else str(t.exit_time),
                entry_price=round(t.entry_price, 2),
                exit_price=round(t.exit_price, 2),
                qty=t.qty,
                pnl=round(t.pnl, 2),
                pnl_pct=round(t.pnl_pct, 2),
                reason=t.reason,
                signal_type="MTF",
                direction="CALL",
                mae=0.0,
            )
            for t in filtered_trades
        ]

        return candles, trades_out, result.equity_curve, metrics, full_params, filtered_daily

    try:
        candles, trades, eq_curve, metrics, params, daily_pnl = await run_in_threadpool(_run)
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as exc:
        logger.exception("MTF backtest failed for %s", symbol)
        raise HTTPException(status_code=500, detail=str(exc))

    return US1HBacktestResponse(
        symbol=symbol,
        interval="4h",
        period=period,
        candles=candles,
        trades=trades,
        equity_curve=eq_curve,
        metrics=metrics,
        daily_pnl=daily_pnl,
        params=params,
        timestamp=datetime.now(SGT).strftime("%d/%m/%Y %H:%M SGT"),
    )


# ═══════════════════════════════════════════════════════════════════════
# TPC — Trend-Pullback-Continuation Strategy Backtest
# ═══════════════════════════════════════════════════════════════════════

@router.get("/backtest_tpc")
async def us_stock_backtest_tpc(
    symbol: _Ann[str, Query()] = "AAPL",
    period: _Ann[str, Query()] = "1y",
    capital: _Ann[float, Query()] = 5000.0,
    disabled_conditions: _Ann[_Opt[str], Query()] = None,
    # TPC param overrides
    w_st_mult: _Ann[_Opt[float], Query()] = None,
    d_adx_min: _Ann[_Opt[int], Query()] = None,
    pullback_atr_dist: _Ann[_Opt[float], Query()] = None,
    tp1_r_mult: _Ann[_Opt[float], Query()] = None,
    tp2_r_mult: _Ann[_Opt[float], Query()] = None,
    atr_sl_mult: _Ann[_Opt[float], Query()] = None,
    trailing_atr_mult: _Ann[_Opt[float], Query()] = None,
    date_from: _Ann[_Opt[str], Query()] = None,
    date_to: _Ann[_Opt[str], Query()] = None,
) -> US1HBacktestResponse:
    """Run TPC strategy backtest (Weekly trend + 1H pullback entry) on a US stock."""

    _disabled: set[str] = set()
    if disabled_conditions:
        _valid = {"w_st_trend", "ht_trend",
                  "sl_exit", "tp1_exit", "tp2_exit", "trail_exit",
                  "wst_flip_exit", "ema28_break_exit", "ht_flip_exit"}
        _disabled = {c.strip() for c in disabled_conditions.split(",") if c.strip() in _valid}

    def _run():
        from strategies.futures.data_loader import load_yfinance
        from strategies.us_stock.tpc.backtest import TPCBacktester
        from strategies.us_stock.tpc.strategy import TPCStrategy
        from strategies.us_stock.tpc.config import DEFAULT_TPC_PARAMS, RISK_PER_TRADE as TPC_RISK

        # Load weekly + daily + 1H data
        # Yahoo Finance limits 1h data to ~730 days; for longer periods use daily as trade timeframe
        _period_days_map = {"1mo": 30, "3mo": 90, "6mo": 180, "1y": 365, "2y": 730, "4y": 1460, "5y": 1825}
        _req_days = _period_days_map.get(period, 730)
        _use_daily = _req_days > 730

        df_weekly = load_yfinance(symbol=symbol, interval="1wk", period="10y" if _use_daily else "5y")
        df_daily = load_yfinance(symbol=symbol, interval="1d", period=period if _use_daily else "5y")
        if _use_daily:
            df_1h = df_daily.copy()  # use daily bars as the trade timeframe
        else:
            df_1h = load_yfinance(symbol=symbol, interval="1h", period=period)

        if df_1h.empty or len(df_1h) < 50:
            raise ValueError(f"Not enough 1H data for {symbol}.")

        if date_to:
            trade_end = pd.Timestamp(date_to, tz=df_1h.index.tz) + pd.Timedelta(days=1)
            df_1h = df_1h[df_1h.index < trade_end]

        param_overrides: dict = {}
        if w_st_mult is not None:
            param_overrides["w_st_mult"] = w_st_mult
        if tp1_r_mult is not None:
            param_overrides["tp1_r_mult"] = tp1_r_mult
        if tp2_r_mult is not None:
            param_overrides["tp2_r_mult"] = tp2_r_mult
        if atr_sl_mult is not None:
            param_overrides["atr_sl_mult"] = atr_sl_mult
        if trailing_atr_mult is not None:
            param_overrides["trailing_atr_mult"] = trailing_atr_mult

        full_params = {**DEFAULT_TPC_PARAMS, **param_overrides}
        bt = TPCBacktester(capital=capital, risk_per_trade=TPC_RISK)
        result = bt.run(
            symbol=symbol, period=period,
            params=param_overrides,
            disabled_conditions=_disabled or None,
            df_weekly=df_weekly, df_daily=df_daily, df_1h=df_1h,
        )

        # Build candles with indicators for chart
        strategy = TPCStrategy(full_params)
        df_w = strategy.compute_weekly(df_weekly[["open", "high", "low", "close", "volume"]].copy())
        df_d = strategy.compute_daily(df_daily[["open", "high", "low", "close", "volume"]].copy())
        df_h = strategy.compute_1h(df_1h[["open", "high", "low", "close", "volume"]].copy())
        df_h = strategy.merge_weekly_into_1h(df_h, df_w)
        df_h = strategy.merge_daily_into_1h(df_h, df_d)
        signals = strategy.generate_signals(df_h, disabled=_disabled or None)

        display_start: _Opt[str] = None
        if date_from:
            display_start = date_from
        elif period not in ("2y", "4y", "5y", "max"):
            _period_days = {"1mo": 30, "3mo": 90, "6mo": 180, "1y": 365}
            _days = _period_days.get(period, 730)
            if _days < 730:
                cutoff = df_h.index[-1] - pd.Timedelta(days=_days)
                display_start = cutoff.strftime("%Y-%m-%d")

        if display_start:
            ts = pd.Timestamp(display_start, tz=df_h.index.tz)
            df_h = df_h[df_h.index >= ts]
            signals = signals[df_h.index]
        df_h["signal"] = signals

        candles = []
        for ts_val, row in df_h.iterrows():
            candles.append(US1HCandle(
                time=ts_val.isoformat(),
                open=round(float(row["open"]), 2),
                high=round(float(row["high"]), 2),
                low=round(float(row["low"]), 2),
                close=round(float(row["close"]), 2),
                volume=float(row.get("volume", 0)),
                ema_fast=round(float(row["h_ema_fast"]), 2) if not _isnan(row.get("h_ema_fast")) else None,
                ema_slow=round(float(row["h_ema_slow"]), 2) if not _isnan(row.get("h_ema_slow")) else None,
                rsi=round(float(row["h_rsi"]), 1) if not _isnan(row.get("h_rsi")) else None,
                macd_hist=None,
                st_dir=int(row["w_st_dir"]) if not _isnan(row.get("w_st_dir")) else None,
                st_line=round(float(row["w_st_line"]), 2) if not _isnan(row.get("w_st_line")) else None,
                ht_line=round(float(row["ht_line"]), 2) if not _isnan(row.get("ht_line")) else None,
                ht_dir=int(row["ht_dir"]) if not _isnan(row.get("ht_dir")) else None,
                ht_high=round(float(row["ht_high"]), 2) if not _isnan(row.get("ht_high")) else None,
                ht_low=round(float(row["ht_low"]), 2) if not _isnan(row.get("ht_low")) else None,
                signal=int(row.get("signal", 0)),
            ))

        filtered_trades = result.trades
        if display_start:
            filtered_trades = [t for t in result.trades if str(t.exit_time)[:10] >= display_start]

        filtered_daily = result.daily_pnl
        if display_start and filtered_daily:
            filtered_daily = [d for d in filtered_daily if d["date"] >= display_start]

        wins = [t for t in filtered_trades if t.pnl > 0]
        losses = [t for t in filtered_trades if t.pnl <= 0]
        n_trades = len(filtered_trades)
        total_pnl = sum(t.pnl for t in filtered_trades)

        metrics = US1HMetrics(
            initial_capital=result.initial_capital,
            final_equity=round(result.initial_capital + total_pnl, 2),
            total_return_pct=round(total_pnl / result.initial_capital * 100, 2) if result.initial_capital else 0,
            max_drawdown_pct=result.max_drawdown_pct,
            sharpe_ratio=result.sharpe_ratio,
            total_trades=n_trades,
            winners=len(wins),
            losers=len(losses),
            win_rate=round(len(wins) / n_trades * 100, 1) if n_trades else 0,
            avg_win=round(sum(t.pnl for t in wins) / len(wins), 2) if wins else 0,
            avg_loss=round(sum(t.pnl for t in losses) / len(losses), 2) if losses else 0,
            profit_factor=round(
                abs(sum(t.pnl for t in wins) / sum(t.pnl for t in losses)), 2
            ) if losses and sum(t.pnl for t in losses) != 0 else 999.0,
            risk_reward_ratio=round(
                abs(result.avg_win / result.avg_loss), 2
            ) if result.avg_loss != 0 else 999.0,
        )

        trades_out = [
            US1HTrade(
                entry_time=t.entry_time.isoformat() if hasattr(t.entry_time, "isoformat") else str(t.entry_time),
                exit_time=t.exit_time.isoformat() if hasattr(t.exit_time, "isoformat") else str(t.exit_time),
                entry_price=round(t.entry_price, 2),
                exit_price=round(t.exit_price, 2),
                qty=t.qty,
                pnl=round(t.pnl, 2),
                pnl_pct=round(t.pnl_pct, 2),
                reason=t.reason,
                signal_type="TPC",
                direction="CALL",
                mae=round(t.mae, 2),
                sl_price=round(t.sl_price, 2),
            )
            for t in filtered_trades
        ]

        return candles, trades_out, result.equity_curve, metrics, full_params, filtered_daily

    try:
        candles, trades, eq_curve, metrics, params, daily_pnl = await run_in_threadpool(_run)
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as exc:
        logger.exception("TPC backtest failed for %s", symbol)
        raise HTTPException(status_code=500, detail=str(exc))

    return US1HBacktestResponse(
        symbol=symbol,
        interval="1h",
        period=period,
        candles=candles,
        trades=trades,
        equity_curve=eq_curve,
        metrics=metrics,
        daily_pnl=daily_pnl,
        params=params,
        timestamp=datetime.now(SGT).strftime("%d/%m/%Y %H:%M SGT"),
    )


# ═══════════════════════════════════════════════════════════════════════
# HPB — HeatPulse Breakout Strategy (KLSE Daily)
# ═══════════════════════════════════════════════════════════════════════

@router.get("/backtest_hpb")
async def klse_backtest_hpb(
    symbol: _Ann[str, Query()] = "0208.KL",
    period: _Ann[str, Query()] = "2y",
    capital: _Ann[float, Query()] = 10000.0,
    disabled_conditions: _Ann[_Opt[str], Query()] = None,
    heat_threshold: _Ann[_Opt[float], Query()] = None,
    sl_atr_mult: _Ann[_Opt[float], Query(ge=0.5, le=5.0)] = None,
    tp_atr_mult: _Ann[_Opt[float], Query(ge=0.5, le=10.0)] = None,
    trailing_atr_mult: _Ann[_Opt[float], Query(ge=0.5, le=5.0)] = None,
    vol_mult: _Ann[_Opt[float], Query(ge=0.5, le=5.0)] = None,
    risk_pct: _Ann[_Opt[float], Query(ge=1.0, le=20.0)] = None,
    cooldown_bars: _Ann[_Opt[int], Query(ge=0, le=20)] = None,
) -> US1HBacktestResponse:
    """Run HeatPulse Breakout backtest on a KLSE stock (daily timeframe)."""

    _disabled: set[str] = set()
    if disabled_conditions:
        _valid = {"heat_filter", "ema_filter", "breakout_filter", "volume_filter",
                  "atr_filter", "sl_exit", "tp_exit", "trail_exit"}
        _disabled = {c.strip() for c in disabled_conditions.split(",") if c.strip() in _valid}

    def _run():
        from strategies.futures.data_loader import load_yfinance
        from strategies.klse.hpb.config import HPBParams
        from strategies.klse.hpb.backtest import run_backtest as hpb_backtest
        from strategies.klse.hpb.signals import build_indicators

        params = HPBParams()
        if heat_threshold is not None:
            params.heat_threshold = heat_threshold
        if sl_atr_mult is not None:
            params.sl_atr_mult = sl_atr_mult
        if tp_atr_mult is not None:
            params.tp_atr_mult = tp_atr_mult
        if trailing_atr_mult is not None:
            params.trailing_atr_mult = trailing_atr_mult
        if vol_mult is not None:
            params.vol_mult = vol_mult
        if risk_pct is not None:
            params.risk_pct = risk_pct
        if cooldown_bars is not None:
            params.cooldown_bars = cooldown_bars

        df = load_yfinance(symbol=symbol, interval="1d", period=period)
        if df.empty or len(df) < 200:
            raise ValueError(f"Not enough daily data for {symbol} (need 200+ bars for EMA200).")

        result = hpb_backtest(df, params, capital=capital, disabled_conditions=_disabled or None)

        # Build candles with indicators for chart
        df_ind = build_indicators(df.copy(), params)

        candles = []
        for ts_val, row in df_ind.iterrows():
            candles.append(US1HCandle(
                time=ts_val.isoformat() if hasattr(ts_val, "isoformat") else str(ts_val),
                open=round(float(row["open"]), 4),
                high=round(float(row["high"]), 4),
                low=round(float(row["low"]), 4),
                close=round(float(row["close"]), 4),
                volume=float(row.get("volume", 0)),
                ema_fast=round(float(row["ema50"]), 4) if not _isnan(row.get("ema50")) else None,
                ema_slow=round(float(row["ema200"]), 4) if not _isnan(row.get("ema200")) else None,
                rsi=round(float(row["rsi"]), 1) if not _isnan(row.get("rsi")) else None,
                signal=0,
            ))

        wins = [t for t in result.trades if t.win]
        losses = [t for t in result.trades if not t.win]
        n_trades = len(result.trades)
        total_pnl = sum(t.pnl for t in result.trades)

        metrics = US1HMetrics(
            initial_capital=capital,
            final_equity=round(capital + total_pnl, 2),
            total_return_pct=round(total_pnl / capital * 100, 2) if capital else 0,
            max_drawdown_pct=result.max_drawdown_pct,
            sharpe_ratio=result.sharpe_ratio,
            total_trades=n_trades,
            winners=len(wins),
            losers=len(losses),
            win_rate=round(len(wins) / n_trades * 100, 1) if n_trades else 0,
            avg_win=round(sum(t.pnl for t in wins) / len(wins), 2) if wins else 0,
            avg_loss=round(sum(t.pnl for t in losses) / len(losses), 2) if losses else 0,
            profit_factor=round(
                abs(sum(t.pnl for t in wins) / sum(t.pnl for t in losses)), 2
            ) if losses and sum(t.pnl for t in losses) != 0 else 999.0,
            risk_reward_ratio=result.risk_reward,
        )

        trades_out = [
            US1HTrade(
                entry_time=t.entry_date,
                exit_time=t.exit_date,
                entry_price=t.entry_price,
                exit_price=t.exit_price,
                qty=0,
                pnl=t.pnl,
                pnl_pct=t.return_pct,
                reason=t.exit_reason,
                signal_type="HPB",
                direction="CALL",
                sl_price=t.sl_price,
            )
            for t in result.trades
        ]

        out_params = {
            "heat_threshold": params.heat_threshold,
            "sl_atr_mult": params.sl_atr_mult,
            "tp_atr_mult": params.tp_atr_mult,
            "trailing_atr_mult": params.trailing_atr_mult,
            "vol_mult": params.vol_mult,
            "risk_pct": params.risk_pct,
            "cooldown_bars": params.cooldown_bars,
        }

        return candles, trades_out, result.equity_curve, metrics, out_params

    try:
        candles, trades, eq_curve, metrics, params_out = await run_in_threadpool(_run)
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as exc:
        logger.exception("HPB backtest failed for %s", symbol)
        raise HTTPException(status_code=500, detail=str(exc))

    return US1HBacktestResponse(
        symbol=symbol,
        interval="1d",
        period=period,
        candles=candles,
        trades=trades,
        equity_curve=eq_curve,
        metrics=metrics,
        params=params_out,
        timestamp=datetime.now(SGT).strftime("%d/%m/%Y %H:%M SGT"),
    )


# ═══════════════════════════════════════════════════════════════════════
# Momentum Guard - KLSE EMA20/EMA50 + RSI + Capital Protection
# ═══════════════════════════════════════════════════════════════════════

@router.get("/backtest_momentum_guard")
async def klse_backtest_momentum_guard(
    symbol: _Ann[str, Query()] = "0208.KL",
    period: _Ann[str, Query()] = "2y",
    capital: _Ann[float, Query()] = 10000.0,
    disabled_conditions: _Ann[_Opt[str], Query()] = None,
    stop_loss_pct: _Ann[_Opt[float], Query(ge=0.01, le=0.30)] = None,
    trailing_stop_pct: _Ann[_Opt[float], Query(ge=0.01, le=0.50)] = None,
    rsi_min: _Ann[_Opt[float], Query(ge=5.0, le=80.0)] = None,
    rsi_max: _Ann[_Opt[float], Query(ge=20.0, le=95.0)] = None,
    ema_fast: _Ann[_Opt[int], Query(ge=5, le=100)] = None,
    ema_slow: _Ann[_Opt[int], Query(ge=10, le=200)] = None,
) -> US1HBacktestResponse:
    """Run Momentum Guard backtest on KLSE daily bars."""

    from strategies.klse.momentum_guard import VALID_CONDITIONS

    _disabled: set[str] = set()
    if disabled_conditions:
        _disabled = {c.strip() for c in disabled_conditions.split(",") if c.strip() in VALID_CONDITIONS}

    def _run():
        from strategies.futures.data_loader import load_yfinance
        from strategies.klse.momentum_guard import DEFAULT_PARAMS, build_indicators
        from strategies.klse.momentum_guard import run_backtest as mg_backtest

        param_overrides: dict = {}
        if stop_loss_pct is not None:
            param_overrides["stop_loss_pct"] = stop_loss_pct
        if trailing_stop_pct is not None:
            param_overrides["trailing_stop_pct"] = trailing_stop_pct
        if rsi_min is not None:
            param_overrides["rsi_min"] = rsi_min
        if rsi_max is not None:
            param_overrides["rsi_max"] = rsi_max
        if ema_fast is not None:
            param_overrides["ema_fast"] = ema_fast
        if ema_slow is not None:
            param_overrides["ema_slow"] = ema_slow

        full_params = {**DEFAULT_PARAMS, **param_overrides}

        df = load_yfinance(symbol=symbol, interval="1d", period=period)
        if df.empty or len(df) < 80:
            raise ValueError(f"Not enough daily data for {symbol} (need 80+ bars).")

        result = mg_backtest(df, params=full_params, capital=capital, disabled_conditions=_disabled or None)

        df_ind = build_indicators(df.copy(), full_params, _disabled or None)
        candles: list[US1HCandle] = []
        for ts_val, row in df_ind.iterrows():
            candles.append(
                US1HCandle(
                    time=ts_val.isoformat() if hasattr(ts_val, "isoformat") else str(ts_val),
                    open=round(float(row["open"]), 4),
                    high=round(float(row["high"]), 4),
                    low=round(float(row["low"]), 4),
                    close=round(float(row["close"]), 4),
                    volume=float(row.get("volume", 0)),
                    ema_fast=round(float(row.get("ema_fast", 0)), 4) if not _isnan(row.get("ema_fast")) else None,
                    ema_slow=round(float(row.get("ema_slow", 0)), 4) if not _isnan(row.get("ema_slow")) else None,
                    rsi=round(float(row.get("rsi", 0)), 1) if not _isnan(row.get("rsi")) else None,
                    signal=int(row.get("signal", 0)),
                )
            )

        metrics = US1HMetrics(
            initial_capital=result.initial_capital,
            final_equity=result.final_equity,
            total_return_pct=result.total_return_pct,
            max_drawdown_pct=result.max_drawdown_pct,
            sharpe_ratio=result.sharpe_ratio,
            total_trades=result.total_trades,
            winners=result.winners,
            losers=result.losers,
            win_rate=result.win_rate,
            avg_win=result.avg_win_pct,
            avg_loss=result.avg_loss_pct,
            profit_factor=result.profit_factor,
            risk_reward_ratio=result.risk_reward,
        )

        trades_out = [
            US1HTrade(
                entry_time=t.entry_date,
                exit_time=t.exit_date,
                entry_price=t.entry_price,
                exit_price=t.exit_price,
                qty=0,
                pnl=t.pnl,
                pnl_pct=t.return_pct,
                reason=t.exit_reason,
                signal_type="MOMENTUM_GUARD",
                direction="CALL",
                sl_price=t.sl_price,
            )
            for t in result.trades
        ]

        out_params = {
            "ema_fast": full_params["ema_fast"],
            "ema_slow": full_params["ema_slow"],
            "rsi_period": full_params["rsi_period"],
            "rsi_min": full_params["rsi_min"],
            "rsi_max": full_params["rsi_max"],
            "stop_loss_pct": full_params["stop_loss_pct"],
            "trailing_stop_pct": full_params["trailing_stop_pct"],
        }

        return candles, trades_out, result.equity_curve, metrics, out_params

    try:
        candles, trades, eq_curve, metrics, params_out = await run_in_threadpool(_run)
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as exc:
        logger.exception("Momentum Guard backtest failed for %s", symbol)
        raise HTTPException(status_code=500, detail=str(exc))

    return US1HBacktestResponse(
        symbol=symbol,
        interval="1d",
        period=period,
        candles=candles,
        trades=trades,
        equity_curve=eq_curve,
        metrics=metrics,
        params=params_out,
        timestamp=datetime.now(SGT).strftime("%d/%m/%Y %H:%M SGT"),
    )


# ═══════════════════════════════════════════════════════════
# KLSE VPB3 Malaysia — 量价突破 Daily Volume-Price Breakout
# ═══════════════════════════════════════════════════════════


@router.get("/backtest_vpb3")
async def klse_backtest_vpb3(
    symbol: _Ann[str, Query()] = "0208.KL",
    period: _Ann[str, Query()] = "2y",
    capital: _Ann[float, Query()] = 5000.0,
    disabled_conditions: _Ann[_Opt[str], Query()] = None,
    tp_r_multiple: _Ann[_Opt[float], Query(ge=0.3, le=5.0)] = None,
    vol_multiplier: _Ann[_Opt[float], Query(ge=0.5, le=5.0)] = None,
    sl_lookback: _Ann[_Opt[int], Query(ge=1, le=20)] = None,
    rsi_min: _Ann[_Opt[float], Query(ge=10, le=60)] = None,
    rsi_max: _Ann[_Opt[float], Query(ge=50, le=90)] = None,
    cooldown_bars: _Ann[_Opt[int], Query(ge=0, le=20)] = None,
    risk_pct: _Ann[_Opt[float], Query(ge=1.0, le=20.0)] = None,
    breakout_lookback: _Ann[_Opt[int], Query(ge=3, le=30)] = None,
) -> US1HBacktestResponse:
    """Run VPB3 Malaysia (量价突破) backtest on a KLSE stock — daily bars."""

    from strategies.klse.vpb3.strategy import VALID_CONDITIONS

    _disabled: set[str] = set()
    if disabled_conditions:
        _disabled = {c.strip() for c in disabled_conditions.split(",") if c.strip() in VALID_CONDITIONS}

    def _run():
        from strategies.futures.data_loader import load_yfinance
        from strategies.klse.vpb3.strategy import DEFAULT_PARAMS, build_indicators
        from strategies.klse.vpb3.backtest import run_backtest as vpb3_backtest

        # Build param overrides
        param_overrides: dict = {}
        if tp_r_multiple is not None:
            param_overrides["tp_r_multiple"] = tp_r_multiple
        if vol_multiplier is not None:
            param_overrides["vol_multiplier"] = vol_multiplier
        if sl_lookback is not None:
            param_overrides["sl_lookback"] = sl_lookback
        if rsi_min is not None:
            param_overrides["rsi_min"] = rsi_min
        if rsi_max is not None:
            param_overrides["rsi_max"] = rsi_max
        if cooldown_bars is not None:
            param_overrides["cooldown_bars"] = cooldown_bars
        if risk_pct is not None:
            param_overrides["risk_pct"] = risk_pct
        if breakout_lookback is not None:
            param_overrides["breakout_lookback"] = breakout_lookback

        full_params = {**DEFAULT_PARAMS, **param_overrides}

        df = load_yfinance(symbol=symbol, interval="1d", period=period)
        if df.empty or len(df) < 60:
            raise ValueError(f"Not enough daily data for {symbol} (need 60+ bars).")

        result = vpb3_backtest(df, params=full_params, capital=capital,
                               disabled_conditions=_disabled or None)

        # Build candles with indicators
        df_ind = build_indicators(df.copy(), full_params)

        candles = []
        for ts_val, row in df_ind.iterrows():
            candles.append(US1HCandle(
                time=ts_val.isoformat() if hasattr(ts_val, "isoformat") else str(ts_val),
                open=round(float(row["open"]), 4),
                high=round(float(row["high"]), 4),
                low=round(float(row["low"]), 4),
                close=round(float(row["close"]), 4),
                volume=float(row.get("volume", 0)),
                ema_fast=round(float(row.get("ema_fast", 0)), 4) if not _isnan(row.get("ema_fast")) else None,
                ema_slow=round(float(row.get("ema_slow", 0)), 4) if not _isnan(row.get("ema_slow")) else None,
                rsi=round(float(row.get("rsi", 0)), 1) if not _isnan(row.get("rsi")) else None,
                signal=0,
            ))

        wins = [t for t in result.trades if t.win]
        losses = [t for t in result.trades if not t.win]
        n_trades = len(result.trades)

        metrics = US1HMetrics(
            initial_capital=capital,
            final_equity=result.final_equity,
            total_return_pct=result.total_return_pct,
            max_drawdown_pct=result.max_drawdown_pct,
            sharpe_ratio=result.sharpe_ratio,
            total_trades=n_trades,
            winners=result.winners,
            losers=result.losers,
            win_rate=result.win_rate,
            avg_win=result.avg_win_pct,
            avg_loss=result.avg_loss_pct,
            profit_factor=result.profit_factor,
            risk_reward_ratio=result.risk_reward,
        )

        trades_out = [
            US1HTrade(
                entry_time=t.entry_date,
                exit_time=t.exit_date,
                entry_price=t.entry_price,
                exit_price=t.exit_price,
                qty=0,
                pnl=t.pnl,
                pnl_pct=t.return_pct,
                reason=t.exit_reason,
                signal_type="VPB3MY",
                direction="CALL",
                sl_price=t.sl_price,
            )
            for t in result.trades
        ]

        out_params = {
            "tp_r_multiple": full_params["tp_r_multiple"],
            "vol_multiplier": full_params["vol_multiplier"],
            "sl_lookback": full_params["sl_lookback"],
            "rsi_min": full_params["rsi_min"],
            "rsi_max": full_params["rsi_max"],
            "breakout_lookback": full_params["breakout_lookback"],
            "cooldown_bars": full_params["cooldown_bars"],
            "risk_pct": full_params["risk_pct"],
        }

        return candles, trades_out, result.equity_curve, metrics, out_params

    try:
        candles, trades, eq_curve, metrics, params_out = await run_in_threadpool(_run)
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as exc:
        logger.exception("VPB3 Malaysia backtest failed for %s", symbol)
        raise HTTPException(status_code=500, detail=str(exc))

    return US1HBacktestResponse(
        symbol=symbol,
        interval="1d",
        period=period,
        candles=candles,
        trades=trades,
        equity_curve=eq_curve,
        metrics=metrics,
        params=params_out,
        timestamp=datetime.now(SGT).strftime("%d/%m/%Y %H:%M SGT"),
    )


# ═══════════════════════════════════════════════════════════════════════
# SMP — Smart Money Pivot Strategy (KLSE Daily)
# ═══════════════════════════════════════════════════════════════════════

@router.get("/backtest_smp")
async def klse_backtest_smp(
    symbol: _Ann[str, Query()] = "0233.KL",
    period: _Ann[str, Query()] = "2y",
    capital: _Ann[float, Query()] = 5000.0,
    disabled_conditions: _Ann[_Opt[str], Query()] = None,
    tp_r_multiple: _Ann[_Opt[float], Query(ge=0.5, le=5.0)] = None,
    sl_lookback: _Ann[_Opt[int], Query(ge=1, le=20)] = None,
    trailing_atr_mult: _Ann[_Opt[float], Query(ge=0.5, le=5.0)] = None,
) -> US1HBacktestResponse:
    """Run SMP (Smart Money Pivot) backtest — Pivot Points + Order Blocks + FVG."""

    from strategies.klse.smp.strategy import VALID_CONDITIONS

    _disabled: set[str] = set()
    if disabled_conditions:
        _disabled = {c.strip() for c in disabled_conditions.split(",") if c.strip() in VALID_CONDITIONS}

    def _run():
        from strategies.futures.data_loader import load_yfinance
        from strategies.klse.smp.strategy import DEFAULT_PARAMS, build_indicators
        from strategies.klse.smp.backtest import run_backtest as smp_backtest

        param_overrides: dict = {}
        if tp_r_multiple is not None:
            param_overrides["tp_r_multiple"] = tp_r_multiple
        if sl_lookback is not None:
            param_overrides["sl_lookback"] = sl_lookback
        if trailing_atr_mult is not None:
            param_overrides["trailing_atr_mult"] = trailing_atr_mult

        full_params = {**DEFAULT_PARAMS, **param_overrides}

        df = load_yfinance(symbol=symbol, interval="1d", period=period)
        if df.empty or len(df) < 60:
            raise ValueError(f"Not enough daily data for {symbol} (need 60+ bars).")

        result = smp_backtest(df, params=full_params, capital=capital,
                              disabled_conditions=_disabled or None)

        # Build candles with indicators
        df_ind = build_indicators(df.copy(), full_params)

        candles = []
        for ts_val, row in df_ind.iterrows():
            candles.append(US1HCandle(
                time=ts_val.isoformat() if hasattr(ts_val, "isoformat") else str(ts_val),
                open=round(float(row["open"]), 4),
                high=round(float(row["high"]), 4),
                low=round(float(row["low"]), 4),
                close=round(float(row["close"]), 4),
                volume=float(row.get("volume", 0)),
                ema_fast=round(float(row.get("ema_fast", 0)), 4) if not _isnan(row.get("ema_fast")) else None,
                ema_slow=round(float(row.get("ema_slow", 0)), 4) if not _isnan(row.get("ema_slow")) else None,
                rsi=round(float(row.get("rsi", 0)), 1) if not _isnan(row.get("rsi")) else None,
                st_dir=int(row.get("bos", 0)),
                st_line=round(float(row.get("swing_low", 0)), 4) if not _isnan(row.get("swing_low")) else None,
                ht_line=round(float(row.get("ob_top", 0)), 4) if not _isnan(row.get("ob_top")) else None,
                ht_dir=1 if not _isnan(row.get("ob_top")) else 0,
                signal=0,
            ))

        n_trades = len(result.trades)
        wins = [t for t in result.trades if t.win]
        losses = [t for t in result.trades if not t.win]

        metrics = US1HMetrics(
            initial_capital=result.initial_capital,
            final_equity=result.final_equity,
            total_return_pct=result.total_return_pct,
            max_drawdown_pct=result.max_drawdown_pct,
            sharpe_ratio=result.sharpe_ratio,
            total_trades=n_trades,
            winners=result.winners,
            losers=result.losers,
            win_rate=result.win_rate,
            avg_win=result.avg_win_pct,
            avg_loss=result.avg_loss_pct,
            profit_factor=result.profit_factor,
            risk_reward_ratio=result.risk_reward,
        )

        trades_out = [
            US1HTrade(
                entry_time=t.entry_date,
                exit_time=t.exit_date,
                entry_price=t.entry_price,
                exit_price=t.exit_price,
                qty=0,
                pnl=t.pnl,
                pnl_pct=t.return_pct,
                reason=t.exit_reason,
                signal_type="SMP",
                direction="CALL",
                sl_price=t.sl_price,
            )
            for t in result.trades
        ]

        out_params = {
            "tp_r_multiple": full_params["tp_r_multiple"],
            "sl_lookback": full_params["sl_lookback"],
            "trailing_atr_mult": full_params["trailing_atr_mult"],
            "min_score": full_params["min_score"],
        }

        return candles, trades_out, result.equity_curve, metrics, out_params

    try:
        candles, trades, eq_curve, metrics, params_out = await run_in_threadpool(_run)
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as exc:
        logger.exception("SMP backtest failed for %s", symbol)
        raise HTTPException(status_code=500, detail=str(exc))

    return US1HBacktestResponse(
        symbol=symbol,
        interval="1d",
        period=period,
        candles=candles,
        trades=trades,
        equity_curve=eq_curve,
        metrics=metrics,
        params=params_out,
        timestamp=datetime.now(SGT).strftime("%d/%m/%Y %H:%M SGT"),
    )


# ═══════════════════════════════════════════════════════════════════════
# PrecSniper (Precision Sniper) Backtest
# ═══════════════════════════════════════════════════════════════════════

@router.get("/backtest_psniper")
async def klse_backtest_psniper(
    symbol: _Ann[str, Query()] = "0208.KL",
    period: _Ann[str, Query()] = "2y",
    capital: _Ann[float, Query()] = 5000.0,
    disabled_conditions: _Ann[_Opt[str], Query()] = None,
    min_score: _Ann[_Opt[int], Query(ge=1, le=10)] = None,
    sl_atr_mult: _Ann[_Opt[float], Query(ge=0.5, le=5.0)] = None,
    tp1_rr: _Ann[_Opt[float], Query(ge=0.5, le=5.0)] = None,
) -> US1HBacktestResponse:
    """Run PrecSniper backtest — EMA cross + 10-pt confluence scoring."""

    from strategies.klse.psniper.strategy import VALID_CONDITIONS

    _disabled: set[str] = set()
    if disabled_conditions:
        _disabled = {c.strip() for c in disabled_conditions.split(",") if c.strip() in VALID_CONDITIONS}

    def _run():
        from strategies.futures.data_loader import load_yfinance
        from strategies.klse.psniper.strategy import DEFAULT_PARAMS, build_indicators
        from strategies.klse.psniper.backtest import run_backtest as ps_backtest

        param_overrides: dict = {}
        if min_score is not None:
            param_overrides["min_score"] = min_score
        if sl_atr_mult is not None:
            param_overrides["sl_atr_mult"] = sl_atr_mult
        if tp1_rr is not None:
            param_overrides["tp1_rr"] = tp1_rr

        full_params = {**DEFAULT_PARAMS, **param_overrides}

        df = load_yfinance(symbol=symbol, interval="1d", period=period)
        if df.empty or len(df) < 60:
            raise ValueError(f"Not enough daily data for {symbol} (need 60+ bars).")

        result = ps_backtest(df, params=full_params, capital=capital,
                             disabled_conditions=_disabled or None)

        df_ind = build_indicators(df.copy(), full_params)

        candles = []
        for ts_val, row in df_ind.iterrows():
            candles.append(US1HCandle(
                time=ts_val.isoformat() if hasattr(ts_val, "isoformat") else str(ts_val),
                open=round(float(row["open"]), 4),
                high=round(float(row["high"]), 4),
                low=round(float(row["low"]), 4),
                close=round(float(row["close"]), 4),
                volume=float(row.get("volume", 0)),
                ema_fast=round(float(row.get("ema_fast", 0)), 4) if not _isnan(row.get("ema_fast")) else None,
                ema_slow=round(float(row.get("ema_slow", 0)), 4) if not _isnan(row.get("ema_slow")) else None,
                rsi=round(float(row.get("rsi", 0)), 1) if not _isnan(row.get("rsi")) else None,
                st_dir=int(row.get("htf_bias", 0)),
                st_line=round(float(row.get("swing_low", 0)), 4) if not _isnan(row.get("swing_low")) else None,
                ht_line=round(float(row.get("vwap", 0)), 4) if not _isnan(row.get("vwap")) else None,
                ht_dir=1 if not _isnan(row.get("vwap")) else 0,
                signal=0,
            ))

        n_trades = len(result.trades)
        metrics = US1HMetrics(
            initial_capital=result.initial_capital,
            final_equity=result.final_equity,
            total_return_pct=result.total_return_pct,
            max_drawdown_pct=result.max_drawdown_pct,
            sharpe_ratio=result.sharpe_ratio,
            total_trades=n_trades,
            winners=result.winners,
            losers=result.losers,
            win_rate=result.win_rate,
            avg_win=result.avg_win_pct,
            avg_loss=result.avg_loss_pct,
            profit_factor=result.profit_factor,
            risk_reward_ratio=result.risk_reward,
        )

        trades_out = [
            US1HTrade(
                entry_time=t.entry_date,
                exit_time=t.exit_date,
                entry_price=t.entry_price,
                exit_price=t.exit_price,
                qty=0,
                pnl=t.pnl,
                pnl_pct=t.return_pct,
                reason=t.exit_reason,
                signal_type="PSNIPER",
                direction="CALL",
                sl_price=t.sl_price,
            )
            for t in result.trades
        ]

        out_params = {
            "min_score": full_params["min_score"],
            "sl_atr_mult": full_params["sl_atr_mult"],
            "tp1_rr": full_params["tp1_rr"],
            "ema_fast": full_params["ema_fast"],
            "ema_slow": full_params["ema_slow"],
        }

        return candles, trades_out, result.equity_curve, metrics, out_params

    try:
        candles, trades, eq_curve, metrics, params_out = await run_in_threadpool(_run)
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as exc:
        logger.exception("PrecSniper backtest failed for %s", symbol)
        raise HTTPException(status_code=500, detail=str(exc))

    return US1HBacktestResponse(
        symbol=symbol,
        interval="1d",
        period=period,
        candles=candles,
        trades=trades,
        equity_curve=eq_curve,
        metrics=metrics,
        params=params_out,
        timestamp=datetime.now(SGT).strftime("%d/%m/%Y %H:%M SGT"),
    )


# ═══════════════════════════════════════════════════════════════════════
# SMA 5/20 Cross (Pine Script parity) Backtest
# ═══════════════════════════════════════════════════════════════════════

@router.get("/backtest_sma5_20_cross")
async def klse_backtest_sma5_20_cross(
    symbol: _Ann[str, Query()] = "0208.KL",
    period: _Ann[str, Query()] = "2y",
    capital: _Ann[float, Query()] = 5000.0,
    disabled_conditions: _Ann[_Opt[str], Query()] = None,
    sma_fast: _Ann[_Opt[int], Query(ge=2, le=50)] = None,
    sma_slow: _Ann[_Opt[int], Query(ge=5, le=200)] = None,
) -> US1HBacktestResponse:
    """Run simple SMA(5/20) crossover backtest on KLSE daily bars."""

    from strategies.klse.sma5_20_cross import VALID_CONDITIONS

    _disabled: set[str] = set()
    if disabled_conditions:
        _disabled = {c.strip() for c in disabled_conditions.split(",") if c.strip() in VALID_CONDITIONS}

    def _run():
        from strategies.futures.data_loader import load_yfinance
        from strategies.klse.sma5_20_cross import DEFAULT_PARAMS, build_indicators
        from strategies.klse.sma5_20_cross import run_backtest as sma_backtest

        param_overrides: dict = {}
        if sma_fast is not None:
            param_overrides["sma_fast"] = sma_fast
        if sma_slow is not None:
            param_overrides["sma_slow"] = sma_slow

        full_params = {**DEFAULT_PARAMS, **param_overrides}

        df = load_yfinance(symbol=symbol, interval="1d", period=period)
        min_rows = int(full_params["sma_slow"]) + 5
        if df.empty or len(df) < min_rows:
            raise ValueError(f"Not enough daily data for {symbol} (need {min_rows}+ bars).")

        result = sma_backtest(df, params=full_params, capital=capital, disabled_conditions=_disabled or None)

        df_ind = build_indicators(df.copy(), full_params, _disabled or None)

        candles: list[US1HCandle] = []
        for ts_val, row in df_ind.iterrows():
            candles.append(
                US1HCandle(
                    time=ts_val.isoformat() if hasattr(ts_val, "isoformat") else str(ts_val),
                    open=round(float(row["open"]), 4),
                    high=round(float(row["high"]), 4),
                    low=round(float(row["low"]), 4),
                    close=round(float(row["close"]), 4),
                    volume=float(row.get("volume", 0)),
                    ema_fast=round(float(row.get("sma_fast", 0)), 4) if not _isnan(row.get("sma_fast")) else None,
                    ema_slow=round(float(row.get("sma_slow", 0)), 4) if not _isnan(row.get("sma_slow")) else None,
                    signal=int(row.get("signal", 0)),
                )
            )

        metrics = US1HMetrics(
            initial_capital=result.initial_capital,
            final_equity=result.final_equity,
            total_return_pct=result.total_return_pct,
            max_drawdown_pct=result.max_drawdown_pct,
            sharpe_ratio=result.sharpe_ratio,
            total_trades=result.total_trades,
            winners=result.winners,
            losers=result.losers,
            win_rate=result.win_rate,
            avg_win=result.avg_win_pct,
            avg_loss=result.avg_loss_pct,
            profit_factor=result.profit_factor,
            risk_reward_ratio=result.risk_reward,
        )

        trades_out = [
            US1HTrade(
                entry_time=t.entry_date,
                exit_time=t.exit_date,
                entry_price=t.entry_price,
                exit_price=t.exit_price,
                qty=0,
                pnl=t.pnl,
                pnl_pct=t.return_pct,
                reason=t.exit_reason,
                signal_type="SMA5_20_CROSS",
                direction="CALL",
                sl_price=t.sl_price,
            )
            for t in result.trades
        ]

        out_params = {
            "sma_fast": full_params["sma_fast"],
            "sma_slow": full_params["sma_slow"],
        }

        return candles, trades_out, result.equity_curve, metrics, out_params

    try:
        candles, trades, eq_curve, metrics, params_out = await run_in_threadpool(_run)
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as exc:
        logger.exception("SMA5/20 Cross backtest failed for %s", symbol)
        raise HTTPException(status_code=500, detail=str(exc))

    return US1HBacktestResponse(
        symbol=symbol,
        interval="1d",
        period=period,
        candles=candles,
        trades=trades,
        equity_curve=eq_curve,
        metrics=metrics,
        params=params_out,
        timestamp=datetime.now(SGT).strftime("%d/%m/%Y %H:%M SGT"),
    )


# ═══════════════════════════════════════════════════════════════════════
# CM MACD — MACD(12,26,9) Crossover Strategy (KLSE Daily)
# Entry: MACD line crosses ABOVE signal → long
# Exit:  MACD line crosses BELOW signal  OR ATR SL/TP
# ═══════════════════════════════════════════════════════════════════════

@router.get("/backtest_cm_macd")
async def klse_backtest_cm_macd(
    symbol: _Ann[str, Query()] = "0208.KL",
    period: _Ann[str, Query()] = "2y",
    capital: _Ann[float, Query()] = 5000.0,
    sl_atr_mult: _Ann[float, Query(ge=0.5, le=10.0)] = 2.0,
    tp_r_mult: _Ann[float, Query(ge=0.5, le=10.0)] = 3.0,
    macd_fast: _Ann[int, Query(ge=2, le=50)] = 12,
    macd_slow: _Ann[int, Query(ge=5, le=100)] = 26,
    macd_signal: _Ann[int, Query(ge=2, le=30)] = 9,
    risk_pct: _Ann[float, Query(ge=1.0, le=20.0)] = 2.0,
) -> US1HBacktestResponse:
    """Run CM MACD crossover backtest on a KLSE stock (daily timeframe).

    Entry:  MACD line crosses above signal line (bullish crossover)
    Exit:   MACD line crosses below signal line  OR  ATR-based SL/TP hit
    """

    def _run():
        import math as _m
        from strategies.futures.data_loader import load_yfinance

        df = load_yfinance(symbol=symbol, interval="1d", period=period)
        if df.empty or len(df) < macd_slow + macd_signal + 20:
            raise ValueError(f"Not enough daily data for {symbol}.")

        df = df[["open", "high", "low", "close", "volume"]].copy()
        c = df["close"].tolist()
        h = df["high"].tolist()
        lo = df["low"].tolist()
        n = len(c)

        # ── EMA helper ──────────────────────────────────────────────
        def _ema_arr(src: list[float], period: int) -> list[float]:
            k = 2.0 / (period + 1)
            out = [_m.nan] * n
            start = next((i for i, v in enumerate(src) if not _m.isnan(v)), None)
            if start is None:
                return out
            out[start] = src[start]
            for i in range(start + 1, n):
                out[i] = src[i] * k + out[i - 1] * (1 - k)
            return out

        # ── MACD ────────────────────────────────────────────────────
        ema_fast = _ema_arr(c, macd_fast)
        ema_slow = _ema_arr(c, macd_slow)
        macd_line = [
            ema_fast[i] - ema_slow[i]
            if not (_m.isnan(ema_fast[i]) or _m.isnan(ema_slow[i]))
            else _m.nan
            for i in range(n)
        ]
        sig_line = _ema_arr(macd_line, macd_signal)
        macd_hist_v = [
            macd_line[i] - sig_line[i]
            if not (_m.isnan(macd_line[i]) or _m.isnan(sig_line[i]))
            else _m.nan
            for i in range(n)
        ]

        # ── ATR (Wilder RMA) ─────────────────────────────────────────
        tr = [0.0] * n
        tr[0] = h[0] - lo[0]
        for i in range(1, n):
            tr[i] = max(h[i] - lo[i], abs(h[i] - c[i - 1]), abs(lo[i] - c[i - 1]))
        atr_arr = [_m.nan] * n
        atr_arr[0] = tr[0]
        alpha = 1.0 / 14
        for i in range(1, n):
            atr_arr[i] = alpha * tr[i] + (1 - alpha) * atr_arr[i - 1]

        # ── Bar-by-bar backtest ──────────────────────────────────────
        COMMISSION = 0.001   # 0.1% per side

        equity = float(capital)
        equity_curve: list[float] = []
        trades_raw: list[dict] = []

        in_position = False
        entry_price = 0.0
        entry_date = ""
        sl = 0.0
        tp = 0.0

        dates = df.index.tolist()

        for i in range(1, n):
            equity_curve.append(equity)
            if _m.isnan(macd_line[i]) or _m.isnan(sig_line[i]):
                continue
            if _m.isnan(macd_line[i - 1]) or _m.isnan(sig_line[i - 1]):
                continue

            crossover = macd_line[i] > sig_line[i] and macd_line[i - 1] <= sig_line[i - 1]
            crossunder = macd_line[i] < sig_line[i] and macd_line[i - 1] >= sig_line[i - 1]
            bar_open = float(df["open"].iloc[i])
            bar_high = float(df["high"].iloc[i])
            bar_low = float(df["low"].iloc[i])
            bar_close = float(c[i])
            atr_val = atr_arr[i] if not _m.isnan(atr_arr[i]) else 0.0

            if in_position:
                # Check SL hit
                exit_price: float | None = None
                exit_reason = ""
                if bar_low <= sl:
                    exit_price = sl
                    exit_reason = "SL"
                elif bar_high >= tp:
                    exit_price = tp
                    exit_reason = "TP"
                elif crossunder:
                    exit_price = bar_close
                    exit_reason = "MACD Cross"

                if exit_price is not None:
                    risk_amount = equity * (risk_pct / 100.0)
                    risk_per_share = entry_price - sl
                    if risk_per_share <= 0:
                        risk_per_share = entry_price * 0.02
                    qty_shares = risk_amount / risk_per_share
                    gross = (exit_price - entry_price) * qty_shares
                    cost = (entry_price + exit_price) * qty_shares * COMMISSION
                    pnl = gross - cost
                    equity += pnl
                    pnl_pct = (exit_price - entry_price) / entry_price * 100.0
                    exit_date_str = dates[i].isoformat() if hasattr(dates[i], "isoformat") else str(dates[i])
                    trades_raw.append({
                        "entry_time": entry_date,
                        "exit_time": exit_date_str,
                        "entry_price": round(entry_price, 4),
                        "exit_price": round(exit_price, 4),
                        "pnl": round(pnl, 2),
                        "pnl_pct": round(pnl_pct, 2),
                        "reason": exit_reason,
                        "sl_price": round(sl, 4),
                        "win": pnl > 0,
                    })
                    in_position = False

            else:
                # Entry on next-bar open after crossover signal (no lookahead)
                if crossover and atr_val > 0:
                    entry_price = bar_open
                    entry_date = dates[i].isoformat() if hasattr(dates[i], "isoformat") else str(dates[i])
                    sl = entry_price - sl_atr_mult * atr_val
                    tp = entry_price + (entry_price - sl) * tp_r_mult
                    in_position = True

        equity_curve.append(equity)

        # Close any open position at last bar close
        if in_position:
            last_close = float(c[-1])
            risk_amount = equity * (risk_pct / 100.0)
            risk_per_share = entry_price - sl
            if risk_per_share <= 0:
                risk_per_share = entry_price * 0.02
            qty_shares = risk_amount / risk_per_share
            gross = (last_close - entry_price) * qty_shares
            cost = (entry_price + last_close) * qty_shares * COMMISSION
            pnl = gross - cost
            equity += pnl
            pnl_pct = (last_close - entry_price) / entry_price * 100.0
            trades_raw.append({
                "entry_time": entry_date,
                "exit_time": dates[-1].isoformat() if hasattr(dates[-1], "isoformat") else str(dates[-1]),
                "entry_price": round(entry_price, 4),
                "exit_price": round(last_close, 4),
                "pnl": round(pnl, 2),
                "pnl_pct": round(pnl_pct, 2),
                "reason": "EOD",
                "sl_price": round(sl, 4),
                "win": pnl > 0,
            })

        # ── Metrics ─────────────────────────────────────────────────
        n_trades = len(trades_raw)
        wins = [t for t in trades_raw if t["win"]]
        losses = [t for t in trades_raw if not t["win"]]
        total_pnl = sum(t["pnl"] for t in trades_raw)
        gross_win = sum(t["pnl"] for t in wins)
        gross_loss = abs(sum(t["pnl"] for t in losses))

        # Max drawdown
        peak = capital
        max_dd = 0.0
        running = capital
        for t in trades_raw:
            running += t["pnl"]
            if running > peak:
                peak = running
            dd = (peak - running) / peak * 100 if peak > 0 else 0
            if dd > max_dd:
                max_dd = dd

        # Sharpe (simplified daily returns)
        returns = [t["pnl_pct"] for t in trades_raw]
        if len(returns) > 1:
            avg_r = sum(returns) / len(returns)
            std_r = (sum((r - avg_r) ** 2 for r in returns) / len(returns)) ** 0.5
            sharpe = (avg_r / std_r * (252 ** 0.5)) if std_r > 0 else 0.0
        else:
            sharpe = 0.0

        metrics = US1HMetrics(
            initial_capital=capital,
            final_equity=round(capital + total_pnl, 2),
            total_return_pct=round(total_pnl / capital * 100, 2) if capital else 0,
            max_drawdown_pct=round(max_dd, 2),
            sharpe_ratio=round(sharpe, 2),
            total_trades=n_trades,
            winners=len(wins),
            losers=len(losses),
            win_rate=round(len(wins) / n_trades * 100, 1) if n_trades else 0,
            avg_win=round(gross_win / len(wins), 2) if wins else 0,
            avg_loss=round(-gross_loss / len(losses), 2) if losses else 0,
            profit_factor=round(gross_win / gross_loss, 2) if gross_loss > 0 else 999.0,
            risk_reward_ratio=round(
                (gross_win / len(wins)) / (gross_loss / len(losses)), 2
            ) if wins and losses else 999.0,
        )

        trades_out = [
            US1HTrade(
                entry_time=t["entry_time"],
                exit_time=t["exit_time"],
                entry_price=t["entry_price"],
                exit_price=t["exit_price"],
                qty=0,
                pnl=t["pnl"],
                pnl_pct=t["pnl_pct"],
                reason=t["reason"],
                signal_type="CM_MACD",
                direction="CALL",
                sl_price=t["sl_price"],
            )
            for t in trades_raw
        ]

        # ── Candles with MACD line / signal / hist ───────────────────
        candles = []
        for i, (ts_val, row) in enumerate(df.iterrows()):
            candles.append(US1HCandle(
                time=ts_val.isoformat() if hasattr(ts_val, "isoformat") else str(ts_val),
                open=round(float(row["open"]), 4),
                high=round(float(row["high"]), 4),
                low=round(float(row["low"]), 4),
                close=round(float(row["close"]), 4),
                volume=float(row.get("volume", 0)),
                ema_fast=round(macd_line[i], 6) if not _m.isnan(macd_line[i]) else None,
                ema_slow=round(sig_line[i], 6) if not _m.isnan(sig_line[i]) else None,
                macd_hist=round(macd_hist_v[i], 6) if not _m.isnan(macd_hist_v[i]) else None,
                signal=0,
            ))

        out_params = {
            "macd_fast": macd_fast, "macd_slow": macd_slow,
            "macd_signal": macd_signal,
            "sl_atr_mult": sl_atr_mult, "tp_r_mult": tp_r_mult,
            "risk_pct": risk_pct,
        }

        return candles, trades_out, equity_curve, metrics, out_params

    try:
        candles, trades, eq_curve, metrics, params_out = await run_in_threadpool(_run)
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as exc:
        logger.exception("CM MACD backtest failed for %s", symbol)
        raise HTTPException(status_code=500, detail=str(exc))

    return US1HBacktestResponse(
        symbol=symbol,
        interval="1d",
        period=period,
        candles=candles,
        trades=trades,
        equity_curve=eq_curve,
        metrics=metrics,
        params=params_out,
        timestamp=datetime.now(SGT).strftime("%d/%m/%Y %H:%M SGT"),
    )


# ═══════════════════════════════════════════════════════════════════════
# Scan Best Strategy — run all 3 KLSE strategies and grade them
# ═══════════════════════════════════════════════════════════════════════

def _grade_metrics(m: dict) -> tuple[str, float]:
    """
    Assign a letter grade (A+ to F) and numeric score based on backtest metrics.
    Score formula weights: return (30%), win_rate (25%), profit_factor (20%),
    sharpe (15%), drawdown penalty (10%).
    """
    ret = m.get("total_return_pct", 0)
    wr = m.get("win_rate", 0)
    pf = min(m.get("profit_factor", 0), 10)  # cap at 10
    sharpe = m.get("sharpe_ratio", 0)
    dd = abs(m.get("max_drawdown_pct", 0))
    trades = m.get("total_trades", 0)

    # If no trades, automatic F
    if trades == 0:
        return "F", 0.0

    score = (
        min(ret, 100) * 0.30       # return % capped at 100 for scoring
        + min(wr, 100) * 0.25      # win rate
        + min(pf, 5) * 4 * 0.20    # profit factor (1→4, 5→20 pts, capped)
        + min(max(sharpe, 0), 3) * 6.67 * 0.15  # sharpe (3→20 pts)
        - dd * 0.10                 # drawdown penalty
    )

    if score >= 40:
        grade = "A+"
    elif score >= 30:
        grade = "A"
    elif score >= 22:
        grade = "B+"
    elif score >= 15:
        grade = "B"
    elif score >= 10:
        grade = "C+"
    elif score >= 5:
        grade = "C"
    elif score >= 0:
        grade = "D"
    else:
        grade = "F"

    return grade, round(score, 1)


@router.get("/scan_best_strategy")
async def scan_best_strategy(
    symbol: _Ann[str, Query()] = "0208.KL",
    period: _Ann[str, Query()] = "2y",
    capital: _Ann[float, Query()] = 5000.0,
) -> dict:
    """Run KLSE strategies with default params and return graded comparison."""

    def _run_all() -> list[dict]:
        from strategies.futures.data_loader import load_yfinance

        results = []

        # --- TPC ---
        try:
            from strategies.us_stock.tpc.backtest import TPCBacktester
            from strategies.us_stock.tpc.config import DEFAULT_TPC_PARAMS, RISK_PER_TRADE as TPC_RISK

            _period_days_map = {"1mo": 30, "3mo": 90, "6mo": 180, "1y": 365, "2y": 730}
            _req_days = _period_days_map.get(period, 730)
            _use_daily = _req_days > 730

            df_weekly = load_yfinance(symbol=symbol, interval="1wk", period="10y" if _use_daily else "5y")
            df_daily = load_yfinance(symbol=symbol, interval="1d", period=period if _use_daily else "5y")
            df_1h = df_daily.copy() if _use_daily else load_yfinance(symbol=symbol, interval="1h", period=period)

            bt = TPCBacktester(capital=capital, risk_per_trade=TPC_RISK)
            result = bt.run(
                symbol=symbol, period=period, params={},
                disabled_conditions=None,
                df_weekly=df_weekly, df_daily=df_daily, df_1h=df_1h,
            )

            wins = [t for t in result.trades if t.pnl > 0]
            losses = [t for t in result.trades if t.pnl <= 0]
            n = len(result.trades)
            total_pnl = sum(t.pnl for t in result.trades)
            wr = round(len(wins) / n * 100, 1) if n else 0
            pf = round(abs(sum(t.pnl for t in wins) / sum(t.pnl for t in losses)), 2) if losses and sum(t.pnl for t in losses) != 0 else 999.0

            m = {
                "total_return_pct": round(total_pnl / capital * 100, 2) if capital else 0,
                "win_rate": wr,
                "profit_factor": pf,
                "sharpe_ratio": result.sharpe_ratio,
                "max_drawdown_pct": result.max_drawdown_pct,
                "total_trades": n,
                "winners": len(wins),
                "losers": len(losses),
            }
            grade, score = _grade_metrics(m)
            results.append({"strategy": "tpc", "label": "TPC", "grade": grade, "score": score, "metrics": m})
        except Exception as exc:
            logger.debug("TPC scan failed for %s: %s", symbol, exc)
            results.append({"strategy": "tpc", "label": "TPC", "grade": "F", "score": 0, "metrics": None, "error": str(exc)})

        # --- HPB ---
        try:
            from strategies.klse.hpb.config import HPBParams
            from strategies.klse.hpb.backtest import run_backtest as hpb_backtest

            params = HPBParams()
            df = load_yfinance(symbol=symbol, interval="1d", period=period)
            if df.empty or len(df) < 200:
                raise ValueError("Not enough data")

            result = hpb_backtest(df, params, capital=capital, disabled_conditions=None)
            wins = [t for t in result.trades if t.win]
            losses = [t for t in result.trades if not t.win]
            n = len(result.trades)
            total_pnl = sum(t.pnl for t in result.trades)
            wr = round(len(wins) / n * 100, 1) if n else 0
            pf = round(abs(sum(t.pnl for t in wins) / sum(t.pnl for t in losses)), 2) if losses and sum(t.pnl for t in losses) != 0 else 999.0

            m = {
                "total_return_pct": round(total_pnl / capital * 100, 2) if capital else 0,
                "win_rate": wr,
                "profit_factor": pf,
                "sharpe_ratio": result.sharpe_ratio,
                "max_drawdown_pct": result.max_drawdown_pct,
                "total_trades": n,
                "winners": len(wins),
                "losers": len(losses),
            }
            grade, score = _grade_metrics(m)
            results.append({"strategy": "hpb", "label": "HPB", "grade": grade, "score": score, "metrics": m})
        except Exception as exc:
            logger.debug("HPB scan failed for %s: %s", symbol, exc)
            results.append({"strategy": "hpb", "label": "HPB", "grade": "F", "score": 0, "metrics": None, "error": str(exc)})

        # --- VPB3 ---
        try:
            from strategies.klse.vpb3.strategy import DEFAULT_PARAMS
            from strategies.klse.vpb3.backtest import run_backtest as vpb3_backtest

            df = load_yfinance(symbol=symbol, interval="1d", period=period)
            if df.empty or len(df) < 60:
                raise ValueError("Not enough data")

            result = vpb3_backtest(df, params=DEFAULT_PARAMS, capital=capital, disabled_conditions=None)
            n = len(result.trades)

            m = {
                "total_return_pct": result.total_return_pct,
                "win_rate": result.win_rate,
                "profit_factor": result.profit_factor,
                "sharpe_ratio": result.sharpe_ratio,
                "max_drawdown_pct": result.max_drawdown_pct,
                "total_trades": n,
                "winners": result.winners,
                "losers": result.losers,
            }
            grade, score = _grade_metrics(m)
            results.append({"strategy": "vpb3", "label": "VPB3", "grade": grade, "score": score, "metrics": m})
        except Exception as exc:
            logger.debug("VPB3 scan failed for %s: %s", symbol, exc)
            results.append({"strategy": "vpb3", "label": "VPB3", "grade": "F", "score": 0, "metrics": None, "error": str(exc)})

        # --- SMP ---
        try:
            from strategies.klse.smp.strategy import DEFAULT_PARAMS as SMP_PARAMS
            from strategies.klse.smp.backtest import run_backtest as smp_backtest

            df = load_yfinance(symbol=symbol, interval="1d", period=period)
            if df.empty or len(df) < 60:
                raise ValueError("Not enough data")

            result = smp_backtest(df, params=SMP_PARAMS, capital=capital, disabled_conditions=None)
            n = len(result.trades)

            m = {
                "total_return_pct": result.total_return_pct,
                "win_rate": result.win_rate,
                "profit_factor": result.profit_factor,
                "sharpe_ratio": result.sharpe_ratio,
                "max_drawdown_pct": result.max_drawdown_pct,
                "total_trades": n,
                "winners": result.winners,
                "losers": result.losers,
            }
            grade, score = _grade_metrics(m)
            results.append({"strategy": "smp", "label": "SMP", "grade": grade, "score": score, "metrics": m})
        except Exception as exc:
            logger.debug("SMP scan failed for %s: %s", symbol, exc)
            results.append({"strategy": "smp", "label": "SMP", "grade": "F", "score": 0, "metrics": None, "error": str(exc)})

        # --- PrecSniper ---
        try:
            from strategies.klse.psniper.strategy import DEFAULT_PARAMS as PS_PARAMS
            from strategies.klse.psniper.backtest import run_backtest as ps_backtest

            df = load_yfinance(symbol=symbol, interval="1d", period=period)
            if df.empty or len(df) < 60:
                raise ValueError("Not enough data")

            result = ps_backtest(df, params=PS_PARAMS, capital=capital, disabled_conditions=None)
            n = len(result.trades)

            m = {
                "total_return_pct": result.total_return_pct,
                "win_rate": result.win_rate,
                "profit_factor": result.profit_factor,
                "sharpe_ratio": result.sharpe_ratio,
                "max_drawdown_pct": result.max_drawdown_pct,
                "total_trades": n,
                "winners": result.winners,
                "losers": result.losers,
            }
            grade, score = _grade_metrics(m)
            results.append({"strategy": "psniper", "label": "PrecSniper", "grade": grade, "score": score, "metrics": m})
        except Exception as exc:
            logger.debug("PrecSniper scan failed for %s: %s", symbol, exc)
            results.append({"strategy": "psniper", "label": "PrecSniper", "grade": "F", "score": 0, "metrics": None, "error": str(exc)})

        # --- CM MACD ---
        try:
            import math as _m

            df = load_yfinance(symbol=symbol, interval="1d", period=period)
            if df.empty or len(df) < 50:
                raise ValueError("Not enough data")

            c_arr = df["close"].tolist() if "close" in df.columns else df["Close"].tolist()
            h_arr = df["high"].tolist() if "high" in df.columns else df["High"].tolist()
            lo_arr = df["low"].tolist() if "low" in df.columns else df["Low"].tolist()
            n_pts = len(c_arr)

            def _ema_s(src, p):
                k = 2.0 / (p + 1)
                out = [_m.nan] * n_pts
                st = next((i for i, v in enumerate(src) if not _m.isnan(v)), None)
                if st is None: return out
                out[st] = src[st]
                for i in range(st + 1, n_pts):
                    out[i] = src[i] * k + out[i - 1] * (1 - k)
                return out

            ef = _ema_s(c_arr, 12); es = _ema_s(c_arr, 26)
            ml = [ef[i] - es[i] if not (_m.isnan(ef[i]) or _m.isnan(es[i])) else _m.nan for i in range(n_pts)]
            sl_line = _ema_s(ml, 9)
            tr = [0.0] * n_pts
            tr[0] = h_arr[0] - lo_arr[0]
            for i in range(1, n_pts):
                tr[i] = max(h_arr[i] - lo_arr[i], abs(h_arr[i] - c_arr[i-1]), abs(lo_arr[i] - c_arr[i-1]))
            atr_v = [_m.nan] * n_pts; atr_v[0] = tr[0]
            for i in range(1, n_pts): atr_v[i] = (1/14)*tr[i] + (13/14)*atr_v[i-1]

            SL_MULT, TP_MULT, COMM = 2.0, 3.0, 0.001
            equity = float(capital)
            trades_cm = []; in_pos = False
            entry_px = sl_px = tp_px = 0.0
            dates = df.index.tolist()

            for i in range(1, n_pts):
                if _m.isnan(ml[i]) or _m.isnan(sl_line[i]) or _m.isnan(ml[i-1]) or _m.isnan(sl_line[i-1]):
                    continue
                crossover = ml[i] > sl_line[i] and ml[i-1] <= sl_line[i-1]
                crossunder = ml[i] < sl_line[i] and ml[i-1] >= sl_line[i-1]
                bar_high = float(h_arr[i]); bar_low = float(lo_arr[i]); bar_close = float(c_arr[i])
                atr_val = atr_v[i] if not _m.isnan(atr_v[i]) else 0.0

                if in_pos:
                    ex_px = None; ex_reason = ""
                    if bar_low <= sl_px: ex_px = sl_px; ex_reason = "SL"
                    elif bar_high >= tp_px: ex_px = tp_px; ex_reason = "TP"
                    elif crossunder: ex_px = bar_close; ex_reason = "MACD Cross"
                    if ex_px is not None:
                        risk_ps = entry_px - sl_px
                        if risk_ps <= 0: risk_ps = entry_px * 0.02
                        qty = (equity * 0.02) / risk_ps
                        pnl = (ex_px - entry_px) * qty - (entry_px + ex_px) * qty * COMM
                        equity += pnl
                        trades_cm.append({"pnl": pnl, "win": pnl > 0})
                        in_pos = False
                else:
                    if crossover and atr_val > 0:
                        entry_px = float(df["open"].iloc[i]) if "open" in df.columns else float(df["Open"].iloc[i])
                        sl_px = entry_px - SL_MULT * atr_val
                        tp_px = entry_px + (entry_px - sl_px) * TP_MULT
                        in_pos = True

            if in_pos:
                lc = float(c_arr[-1])
                risk_ps = entry_px - sl_px
                if risk_ps <= 0: risk_ps = entry_px * 0.02
                qty = (equity * 0.02) / risk_ps
                pnl = (lc - entry_px) * qty - (entry_px + lc) * qty * COMM
                equity += pnl
                trades_cm.append({"pnl": pnl, "win": pnl > 0})

            nt = len(trades_cm)
            wins_cm = [t for t in trades_cm if t["win"]]
            losses_cm = [t for t in trades_cm if not t["win"]]
            total_pnl_cm = sum(t["pnl"] for t in trades_cm)
            wr_cm = round(len(wins_cm) / nt * 100, 1) if nt else 0
            pf_cm = round(abs(sum(t["pnl"] for t in wins_cm) / sum(t["pnl"] for t in losses_cm)), 2) if losses_cm and sum(t["pnl"] for t in losses_cm) != 0 else 999.0

            # Sharpe
            pnls = [t["pnl"] for t in trades_cm]
            import statistics as _stats
            if len(pnls) >= 2:
                avg_r = sum(pnls) / len(pnls)
                std_r = _stats.stdev(pnls)
                sharpe_cm = round(avg_r / std_r * (252 ** 0.5) if std_r > 0 else 0, 2)
            else:
                sharpe_cm = 0.0

            # Max drawdown
            eq_curve = [float(capital)]
            for t in trades_cm:
                eq_curve.append(eq_curve[-1] + t["pnl"])
            peak = eq_curve[0]; max_dd = 0.0
            for v in eq_curve:
                if v > peak: peak = v
                dd = (peak - v) / peak * 100 if peak > 0 else 0
                if dd > max_dd: max_dd = dd

            m_cm = {
                "total_return_pct": round(total_pnl_cm / capital * 100, 2),
                "win_rate": wr_cm,
                "profit_factor": pf_cm,
                "sharpe_ratio": sharpe_cm,
                "max_drawdown_pct": -round(max_dd, 2),
                "total_trades": nt,
                "winners": len(wins_cm),
                "losers": len(losses_cm),
            }
            grade_cm, score_cm = _grade_metrics(m_cm)
            results.append({"strategy": "cm_macd", "label": "CM MACD", "grade": grade_cm, "score": score_cm, "metrics": m_cm})
        except Exception as exc:
            logger.debug("CM MACD scan failed for %s: %s", symbol, exc)
            results.append({"strategy": "cm_macd", "label": "CM MACD", "grade": "F", "score": 0, "metrics": None, "error": str(exc)})

        # --- Momentum Guard ---
        try:
            from strategies.klse.momentum_guard import DEFAULT_PARAMS as MG_PARAMS
            from strategies.klse.momentum_guard import run_backtest as mg_backtest

            df = load_yfinance(symbol=symbol, interval="1d", period=period)
            if df.empty or len(df) < 80:
                raise ValueError("Not enough data")

            result = mg_backtest(df, params=MG_PARAMS, capital=capital, disabled_conditions=None)
            n = len(result.trades)
            m = {
                "total_return_pct": result.total_return_pct,
                "win_rate": result.win_rate,
                "profit_factor": result.profit_factor,
                "sharpe_ratio": result.sharpe_ratio,
                "max_drawdown_pct": result.max_drawdown_pct,
                "total_trades": n,
                "winners": result.winners,
                "losers": result.losers,
            }
            grade, score = _grade_metrics(m)
            results.append({"strategy": "momentum_guard", "label": "Momentum Guard", "grade": grade, "score": score, "metrics": m})
        except Exception as exc:
            logger.debug("Momentum Guard scan failed for %s: %s", symbol, exc)
            results.append({"strategy": "momentum_guard", "label": "Momentum Guard", "grade": "F", "score": 0, "metrics": None, "error": str(exc)})

        # Sort by score descending
        results.sort(key=lambda x: -x["score"])
        return results

    try:
        strategies = await run_in_threadpool(_run_all)
    except Exception as exc:
        logger.exception("Scan best strategy failed for %s", symbol)
        raise HTTPException(status_code=500, detail=str(exc))

    best = strategies[0] if strategies else None
    return {
        "symbol": symbol,
        "period": period,
        "best": best["strategy"] if best else None,
        "best_grade": best["grade"] if best else "F",
        "strategies": strategies,
    }


# ═══════════════════════════════════════════════════════════════════════
# Scan Strategy Opportunities — find stocks with active buy signals
# ═══════════════════════════════════════════════════════════════════════

@router.get("/scan_opportunities")
async def scan_opportunities(
    strategy: _Ann[str, Query()] = "smp",
    period: _Ann[str, Query()] = "6mo",
    capital: _Ann[float, Query()] = 5000.0,
) -> dict:
    """Scan all KLSE stocks for a given strategy. Return those with an active signal
    or currently open position (i.e. buy opportunity near entry)."""

    def _scan() -> list[dict]:
        from strategies.futures.data_loader import load_yfinance

        all_symbols = [s.symbol for s in _get_my_stocks()]

        hits: list[dict] = []

        for sym in all_symbols:
            try:
                df = load_yfinance(symbol=sym, interval="1d", period=period)
                if df.empty or len(df) < 60:
                    continue
                df.attrs["symbol"] = sym

                result = _run_strategy_backtest(strategy, df, capital)
                if result is None:
                    continue

                # Check: is there a currently open position? (last trade has no proper exit / EOD)
                has_open = False
                entry_price = 0.0
                sl_price = 0.0
                tp_price = 0.0
                entry_date = ""
                last_close = float(df["close"].iloc[-1]) if "close" in df.columns else float(df["Close"].iloc[-1])

                if result.trades:
                    last_trade = result.trades[-1]
                    # EOD exit means position was still open at end of data
                    if last_trade.exit_reason == "EOD":
                        has_open = True
                        entry_price = last_trade.entry_price
                        sl_price = last_trade.sl_price
                        tp_price = last_trade.tp_price
                        entry_date = last_trade.entry_date

                # Also check: is there a signal on the last bar (meaning entry tomorrow)?
                has_signal = False
                if hasattr(result, "last_signal") and result.last_signal:
                    has_signal = True

                if not has_open and not has_signal:
                    # Also check if there's a very recent signal (last 3 bars)
                    if result.trades:
                        last_t = result.trades[-1]
                        # Recent entry (within last 5 trading days)
                        if isinstance(df.index, pd.DatetimeIndex):
                            last_date = df.index[-1]
                            try:
                                entry_dt = pd.Timestamp(last_t.entry_date)
                                if hasattr(last_date, 'tz') and last_date.tz and entry_dt.tz is None:
                                    entry_dt = entry_dt.tz_localize(last_date.tz)
                                days_since = (last_date - entry_dt).days
                                if days_since <= 5 and last_t.win:
                                    has_open = True
                                    entry_price = last_t.entry_price
                                    sl_price = last_t.sl_price
                                    tp_price = last_t.tp_price
                                    entry_date = last_t.entry_date
                            except Exception:
                                pass

                if has_open or has_signal:
                    # Compute distance to entry price as %
                    dist_pct = round((last_close - entry_price) / entry_price * 100, 2) if entry_price > 0 else 0
                    risk_pct = round((entry_price - sl_price) / entry_price * 100, 2) if entry_price > 0 and sl_price > 0 else 0
                    reward_pct = round((tp_price - entry_price) / entry_price * 100, 2) if entry_price > 0 and tp_price > 0 else 0

                    hits.append({
                        "symbol": sym,
                        "name": _get_stock_name(sym),
                        "price": round(last_close, 4),
                        "entry_price": round(entry_price, 4),
                        "sl_price": round(sl_price, 4),
                        "tp_price": round(tp_price, 4),
                        "entry_date": entry_date,
                        "dist_pct": dist_pct,
                        "risk_pct": risk_pct,
                        "reward_pct": reward_pct,
                        "status": "OPEN" if has_open else "SIGNAL",
                        "win_rate": result.win_rate,
                        "total_return": result.total_return_pct,
                        "total_trades": result.total_trades,
                    })
            except Exception as exc:
                logger.debug("Scan opp skip %s: %s", sym, exc)
                continue

        # Sort: OPEN first, then by distance to entry (closest first)
        hits.sort(key=lambda x: (0 if x["status"] == "OPEN" else 1, abs(x["dist_pct"])))
        return hits

    try:
        results = await run_in_threadpool(_scan)
    except Exception as exc:
        logger.exception("Scan opportunities failed")
        raise HTTPException(status_code=500, detail=str(exc))

    return {
        "strategy": strategy,
        "period": period,
        "total_scanned": len(_get_my_stocks()),
        "hits": len(results),
        "results": results,
    }


def _get_my_stocks() -> list:
    """Return list of stock objects with .symbol attribute from MY_STOCKS constant."""
    # Parse from the TypeScript file is not practical; use a Python-side list
    from dataclasses import dataclass

    @dataclass
    class _Stock:
        symbol: str
        name: str

    # Major KLSE stocks — same as frontend/constants/myStocks.ts
    _symbols = [
        ("1155.KL", "Maybank"), ("1295.KL", "Public Bank"), ("1023.KL", "CIMB"),
        ("5819.KL", "Hong Leong Bank"), ("1066.KL", "RHB Bank"), ("1015.KL", "Ambank"),
        ("1082.KL", "Hong Leong Financial"), ("2488.KL", "Alliance Bank"),
        ("1818.KL", "Bursa Malaysia"), ("5185.KL", "AFFIN Bank"),
        ("5031.KL", "TIME dotCom"), ("0097.KL", "ViTrox"), ("0128.KL", "Frontken"),
        ("0166.KL", "Inari Amertron"), ("5005.KL", "Unisem"), ("5340.KL", "UMS Integration"),
        ("0270.KL", "Nationgate"), ("7100.KL", "Uchi Technologies"),
        ("7160.KL", "Pentamaster"), ("3867.KL", "MPI"),
        ("8869.KL", "Press Metal"), ("0208.KL", "Greatech"), ("5292.KL", "UWC"),
        ("5168.KL", "Hartalega"), ("7153.KL", "Kossan Rubber"),
        ("5286.KL", "Mi Technovation"), ("0225.KL", "Southern Cable"),
        ("6963.KL", "VS Industry"), ("0233.KL", "Pekat Group"), ("0167.KL", "MClean Technologies"),
        ("6947.KL", "CelcomDigi"), ("4863.KL", "Telekom Malaysia"),
        ("6012.KL", "Maxis"), ("6888.KL", "Axiata"),
        ("5326.KL", "99 Speed Mart"), ("4707.KL", "Nestle Malaysia"),
        ("7084.KL", "QL Resources"), ("5296.KL", "MR DIY"),
        ("4715.KL", "Genting Malaysia"), ("3182.KL", "Genting Bhd"),
        ("7052.KL", "Padini"), ("5248.KL", "Bermaz Auto"),
        ("5225.KL", "IHH Healthcare"), ("5878.KL", "KPJ Healthcare"),
        ("7113.KL", "Top Glove"),
        ("5211.KL", "Sunway Bhd"), ("5398.KL", "Gamuda"),
        ("3336.KL", "IJM Corp"), ("0151.KL", "Kelington Group"),
        ("5249.KL", "IOI Properties"), ("5288.KL", "Sime Darby Property"),
        ("8583.KL", "Mah Sing"), ("5236.KL", "Matrix Concepts"),
        ("5183.KL", "Petronas Chemicals"), ("5285.KL", "SD Guthrie"),
        ("1961.KL", "IOI Corp"), ("4731.KL", "Scientex"),
        ("7277.KL", "Dialog Group"), ("5199.KL", "Hibiscus Petroleum"),
        ("7293.KL", "Yinson Holdings"),
        ("5347.KL", "Tenaga Nasional"), ("6033.KL", "Petronas Gas"),
        ("6742.KL", "YTL Power"), ("4677.KL", "YTL Corp"),
        ("3816.KL", "MISC"), ("5246.KL", "Westports"),
        ("5099.KL", "Capital A"),
    ]
    return [_Stock(s, n) for s, n in _symbols]


def _get_stock_name(symbol: str) -> str:
    for s in _get_my_stocks():
        if s.symbol == symbol:
            return s.name
    return symbol.replace(".KL", "")


def _run_strategy_backtest(strategy: str, df: pd.DataFrame, capital: float):
    """Run a specific strategy backtest and return a normalised result object."""
    from dataclasses import dataclass, field

    @dataclass
    class _NormTrade:
        entry_date: str
        exit_date: str
        entry_price: float
        exit_price: float
        sl_price: float
        tp_price: float
        pnl: float
        exit_reason: str
        win: bool

    @dataclass
    class _NormResult:
        trades: list[_NormTrade] = field(default_factory=list)
        win_rate: float = 0.0
        total_return_pct: float = 0.0
        total_trades: int = 0

    if strategy == "tpc":
        from strategies.us_stock.tpc.backtest import TPCBacktester
        from strategies.us_stock.tpc.config import DEFAULT_TPC_PARAMS, RISK_PER_TRADE
        from strategies.futures.data_loader import load_yfinance as _lf
        # TPC needs weekly data; for scan speed use daily as trade TF
        try:
            df_weekly = _lf(symbol=df.attrs.get("symbol", "0208.KL"), interval="1wk", period="5y")
        except Exception:
            return None
        bt = TPCBacktester(capital=capital, risk_per_trade=RISK_PER_TRADE)
        sym = df.attrs.get("symbol", "0208.KL")
        raw = bt.run(symbol=sym, period="6mo", params={},
                     disabled_conditions=None,
                     df_weekly=df_weekly, df_daily=df, df_1h=df)
        trades = []
        for t in raw.trades:
            e_date = t.entry_time.strftime("%Y-%m-%d") if hasattr(t.entry_time, "strftime") else str(t.entry_time)[:10]
            x_date = t.exit_time.strftime("%Y-%m-%d") if hasattr(t.exit_time, "strftime") else str(t.exit_time)[:10]
            trades.append(_NormTrade(
                entry_date=e_date, exit_date=x_date,
                entry_price=round(t.entry_price, 4), exit_price=round(t.exit_price, 4),
                sl_price=round(t.sl_price, 4), tp_price=round(t.tp1_price, 4),
                pnl=t.pnl, exit_reason=t.reason, win=t.pnl > 0,
            ))
        n = len(trades)
        wins = sum(1 for t in trades if t.win)
        total_pnl = sum(t.pnl for t in trades)
        return _NormResult(trades=trades,
                           win_rate=round(wins / n * 100, 1) if n else 0,
                           total_return_pct=round(total_pnl / capital * 100, 2),
                           total_trades=n)
    elif strategy == "hpb":
        from strategies.klse.hpb.config import HPBParams
        from strategies.klse.hpb.backtest import run_backtest as hpb_backtest
        raw = hpb_backtest(df, HPBParams(), capital=capital)
        trades = [_NormTrade(
            entry_date=t.entry_date, exit_date=t.exit_date,
            entry_price=t.entry_price, exit_price=t.exit_price,
            sl_price=t.sl_price, tp_price=t.tp_price,
            pnl=t.pnl, exit_reason=t.exit_reason, win=t.win,
        ) for t in raw.trades]
        return _NormResult(trades=trades, win_rate=raw.win_rate,
                           total_return_pct=raw.total_return_pct, total_trades=raw.total_trades)
    elif strategy == "vpb3":
        from strategies.klse.vpb3.strategy import DEFAULT_PARAMS
        from strategies.klse.vpb3.backtest import run_backtest as vpb3_backtest
        raw = vpb3_backtest(df, params=DEFAULT_PARAMS, capital=capital)
        trades = [_NormTrade(
            entry_date=t.entry_date, exit_date=t.exit_date,
            entry_price=t.entry_price, exit_price=t.exit_price,
            sl_price=t.sl_price, tp_price=t.tp_price,
            pnl=t.pnl, exit_reason=t.exit_reason, win=t.win,
        ) for t in raw.trades]
        return _NormResult(trades=trades, win_rate=raw.win_rate,
                           total_return_pct=raw.total_return_pct, total_trades=raw.total_trades)
    elif strategy == "smp":
        from strategies.klse.smp.strategy import DEFAULT_PARAMS
        from strategies.klse.smp.backtest import run_backtest as smp_backtest
        raw = smp_backtest(df, params=DEFAULT_PARAMS, capital=capital)
        trades = [_NormTrade(
            entry_date=t.entry_date, exit_date=t.exit_date,
            entry_price=t.entry_price, exit_price=t.exit_price,
            sl_price=t.sl_price, tp_price=t.tp_price,
            pnl=t.pnl, exit_reason=t.exit_reason, win=t.win,
        ) for t in raw.trades]
        return _NormResult(trades=trades, win_rate=raw.win_rate,
                           total_return_pct=raw.total_return_pct, total_trades=raw.total_trades)
    elif strategy == "psniper":
        from strategies.klse.psniper.strategy import DEFAULT_PARAMS as PS_PARAMS
        from strategies.klse.psniper.backtest import run_backtest as ps_backtest
        raw = ps_backtest(df, params=PS_PARAMS, capital=capital)
        trades = [_NormTrade(
            entry_date=t.entry_date, exit_date=t.exit_date,
            entry_price=t.entry_price, exit_price=t.exit_price,
            sl_price=t.sl_price, tp_price=t.tp_price,
            pnl=t.pnl, exit_reason=t.exit_reason, win=t.win,
        ) for t in raw.trades]
        return _NormResult(trades=trades, win_rate=raw.win_rate,
                           total_return_pct=raw.total_return_pct, total_trades=raw.total_trades)
    elif strategy == "sma5_20_cross":
        from strategies.klse.sma5_20_cross import DEFAULT_PARAMS as SMA_PARAMS
        from strategies.klse.sma5_20_cross import run_backtest as sma_backtest
        raw = sma_backtest(df, params=SMA_PARAMS, capital=capital)
        trades = [_NormTrade(
            entry_date=t.entry_date, exit_date=t.exit_date,
            entry_price=t.entry_price, exit_price=t.exit_price,
            sl_price=t.sl_price, tp_price=t.tp_price,
            pnl=t.pnl, exit_reason=t.exit_reason, win=t.win,
        ) for t in raw.trades]
        return _NormResult(trades=trades, win_rate=raw.win_rate,
                           total_return_pct=raw.total_return_pct, total_trades=raw.total_trades)
    elif strategy == "momentum_guard":
        from strategies.klse.momentum_guard import DEFAULT_PARAMS as MG_PARAMS
        from strategies.klse.momentum_guard import run_backtest as mg_backtest
        raw = mg_backtest(df, params=MG_PARAMS, capital=capital)
        trades = [_NormTrade(
            entry_date=t.entry_date, exit_date=t.exit_date,
            entry_price=t.entry_price, exit_price=t.exit_price,
            sl_price=t.sl_price, tp_price=t.tp_price,
            pnl=t.pnl, exit_reason=t.exit_reason, win=t.win,
        ) for t in raw.trades]
        return _NormResult(trades=trades, win_rate=raw.win_rate,
                           total_return_pct=raw.total_return_pct, total_trades=raw.total_trades)
    elif strategy == "cm_macd":
        import math as _m
        c_arr = df["close"].tolist() if "close" in df.columns else df["Close"].tolist()
        h_arr = df["high"].tolist() if "high" in df.columns else df["High"].tolist()
        lo_arr = df["low"].tolist() if "low" in df.columns else df["Low"].tolist()
        n = len(c_arr)
        def _ema_s(src, p):
            k = 2.0 / (p + 1)
            out = [_m.nan] * n
            st = next((i for i, v in enumerate(src) if not _m.isnan(v)), None)
            if st is None: return out
            out[st] = src[st]
            for i in range(st + 1, n):
                out[i] = src[i] * k + out[i - 1] * (1 - k)
            return out
        ef = _ema_s(c_arr, 12); es = _ema_s(c_arr, 26)
        ml = [ef[i] - es[i] if not (_m.isnan(ef[i]) or _m.isnan(es[i])) else _m.nan for i in range(n)]
        sl_line = _ema_s(ml, 9)
        tr = [0.0] * n
        tr[0] = h_arr[0] - lo_arr[0]
        for i in range(1, n):
            tr[i] = max(h_arr[i] - lo_arr[i], abs(h_arr[i] - c_arr[i-1]), abs(lo_arr[i] - c_arr[i-1]))
        atr_v = [_m.nan] * n; atr_v[0] = tr[0]
        for i in range(1, n): atr_v[i] = (1/14) * tr[i] + (13/14) * atr_v[i-1]
        SL_MULT, TP_MULT = 2.0, 3.0
        COMM = 0.001
        equity = float(capital)
        trades = []; in_pos = False
        entry_px = sl_px = tp_px = 0.0; entry_dt_str = ""
        dates = df.index.tolist()
        for i in range(1, n):
            if _m.isnan(ml[i]) or _m.isnan(sl_line[i]) or _m.isnan(ml[i-1]) or _m.isnan(sl_line[i-1]):
                continue
            crossover = ml[i] > sl_line[i] and ml[i-1] <= sl_line[i-1]
            crossunder = ml[i] < sl_line[i] and ml[i-1] >= sl_line[i-1]
            bar_open = float(df["open"].iloc[i]) if "open" in df.columns else float(df["Open"].iloc[i])
            bar_high = float(h_arr[i]); bar_low = float(lo_arr[i]); bar_close = float(c_arr[i])
            atr_val = atr_v[i] if not _m.isnan(atr_v[i]) else 0.0
            d_str = dates[i].strftime("%Y-%m-%d") if hasattr(dates[i], "strftime") else str(dates[i])[:10]
            if in_pos:
                ex_px = None; ex_reason = ""
                if bar_low <= sl_px: ex_px = sl_px; ex_reason = "SL"
                elif bar_high >= tp_px: ex_px = tp_px; ex_reason = "TP"
                elif crossunder: ex_px = bar_close; ex_reason = "MACD Cross"
                if ex_px is not None:
                    risk_amt = equity * 0.02; risk_ps = entry_px - sl_px
                    if risk_ps <= 0: risk_ps = entry_px * 0.02
                    qty = risk_amt / risk_ps
                    pnl = (ex_px - entry_px) * qty - (entry_px + ex_px) * qty * COMM
                    equity += pnl
                    trades.append(_NormTrade(
                        entry_date=entry_dt_str, exit_date=d_str,
                        entry_price=round(entry_px, 4), exit_price=round(ex_px, 4),
                        sl_price=round(sl_px, 4), tp_price=round(tp_px, 4),
                        pnl=round(pnl, 2), exit_reason=ex_reason, win=pnl > 0,
                    ))
                    in_pos = False
            else:
                if crossover and atr_val > 0:
                    entry_px = bar_open
                    sl_px = entry_px - SL_MULT * atr_val
                    tp_px = entry_px + (entry_px - sl_px) * TP_MULT
                    entry_dt_str = d_str
                    in_pos = True
        if in_pos:
            lc = float(c_arr[-1])
            risk_amt = equity * 0.02; risk_ps = entry_px - sl_px
            if risk_ps <= 0: risk_ps = entry_px * 0.02
            qty = risk_amt / risk_ps
            pnl = (lc - entry_px) * qty - (entry_px + lc) * qty * COMM
            equity += pnl
            trades.append(_NormTrade(
                entry_date=entry_dt_str,
                exit_date=dates[-1].strftime("%Y-%m-%d") if hasattr(dates[-1], "strftime") else str(dates[-1])[:10],
                entry_price=round(entry_px, 4), exit_price=round(lc, 4),
                sl_price=round(sl_px, 4), tp_price=round(tp_px, 4),
                pnl=round(pnl, 2), exit_reason="EOD", win=pnl > 0,
            ))
        nt = len(trades); wins_n = sum(1 for t in trades if t.win)
        total_pnl = sum(t.pnl for t in trades)
        return _NormResult(trades=trades,
                           win_rate=round(wins_n / nt * 100, 1) if nt else 0,
                           total_return_pct=round(total_pnl / capital * 100, 2),
                           total_trades=nt)
    return None
