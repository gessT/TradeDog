# TradeDog — Quantitative Trading System

Dual-mode trading platform: **Malaysia KLSE stocks** + **MGC Micro Gold Futures**.

## Architecture

```
app/                    # FastAPI backend
  api/                  # REST endpoints (backtest, stock scanner, MGC, webhook)
  core/                 # Config (pydantic-settings), logging, metrics
  db/                   # SQLAlchemy database (PostgreSQL)
  models/               # ORM models (signals, trades, preferences)
  services/             # Business logic (data collector, alerts, Redis)
  strategies/           # Trading conditions & indicators (20+ buy/sell rules)
  utils/                # Shared indicator functions (EMA, RSI, ATR, HalfTrend, etc.)

mgc_trading/            # MGC Gold Futures module (standalone)
  strategy.py           # Trend + pullback + momentum strategy
  backtest.py           # Bar-by-bar backtester
  optimizer.py          # Grid-search parameter optimizer
  tiger_execution.py    # Tiger Open API: OCA bracket orders (SL + TP)
  live_trader.py        # Real-time live trading loop
  webhook_server.py     # TradingView webhook integration
  config.py             # Contract specs, default params, API credentials

frontend/               # Next.js 14 dashboard
  components/           # TVChart, ScanTradePanel, DailyScanner, etc.
  hooks/                # useStock (data + indicators)
  services/             # API client layer
```

## Quick Start

### Backend

```bash
pip install -r requirements.txt
python -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

### Frontend

```bash
cd frontend
npm install
npm run dev    # http://localhost:3000
```

### Docker

```bash
docker compose up -d
```

### MGC Live Trading (Tiger Demo)

```bash
python -m mgc_trading.live_trader --paper
```

## Configuration

Copy `.env.example` to `.env` and fill in your values:

```bash
cp .env.example .env
```

Key settings: `DATABASE_URL`, `REDIS_URL`, `TIGER_ID`, `TIGER_ACCOUNT`.

## Features

### KLSE Mode
- 80+ Bursa Malaysia stocks across 13 sectors
- Daily opportunity scanner (score 1-16)
- Near ATH detector, volume spike tracker
- Sector momentum (TradingView scanner API)
- Multi-condition backtester (20+ buy/sell rules)
- TradingView-style candlestick chart with EMA/HalfTrend overlays

### MGC Mode
- Real-time candlestick chart (Tiger API)
- One-click scan & execute with signal strength scoring (1-10)
- OCA bracket orders (stop-loss + take-profit auto-cancel)
- Position tracking from Tiger Demo account
- Backtest engine with equity curve & trade log

## Tech Stack

- **Backend**: Python 3.11, FastAPI, SQLAlchemy, yfinance, Tiger Open API
- **Frontend**: Next.js 14, TypeScript, Tailwind CSS, lightweight-charts
- **Infra**: PostgreSQL, Redis, Docker
- Confirm app runs from .\back and UI runs from .\front.
- If ports are in use, change backend and frontend ports consistently.# TradeDog
