from fastapi import FastAPI, Request
from fastapi import Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy.exc import SQLAlchemyError
import logging
import traceback

from app.api import backtest, demo, mgc, stock, webhook, ws
from app.api.health import router as health_router
from app.core.config import get_settings
from app.core.logger import configure_logging, render_metrics, track
from app.db.database import Base, engine
from app.models import backtest_trade as backtest_trade_model, condition_preference as condition_preference_model, stock as stock_model, starred_stock as starred_stock_model  # noqa: F401
from app.services.redis_client import redis_service

_logger = logging.getLogger(__name__)


settings = get_settings()
configure_logging()


app = FastAPI(
    title="Trading Backend",
    version=settings.app_version,
    debug=settings.debug,
)


@app.middleware("http")
async def metrics_middleware(request, call_next):
    track()
    return await call_next(request)


@app.on_event("startup")
def startup() -> None:
    try:
        Base.metadata.create_all(bind=engine)
    except SQLAlchemyError:
        pass

    # Migrate: add backtest metric columns to us_strategy_presets if missing
    try:
        from sqlalchemy import text as _text, inspect as _inspect
        insp = _inspect(engine)
        if "us_strategy_presets" in insp.get_table_names():
            existing_cols = {c["name"] for c in insp.get_columns("us_strategy_presets")}
            new_cols = {
                "strategy_type": "VARCHAR(16) DEFAULT 'breakout_1h'",
                "capital": "FLOAT DEFAULT 5000.0",
                "bt_symbol": "VARCHAR(16)",
                "bt_win_rate": "FLOAT",
                "bt_return_pct": "FLOAT",
                "bt_max_dd_pct": "FLOAT",
                "bt_profit_factor": "FLOAT",
                "bt_sharpe": "FLOAT",
                "bt_total_trades": "INTEGER",
                "bt_tested_at": "TIMESTAMP",
            }
            with engine.begin() as conn:
                for col, col_type in new_cols.items():
                    if col not in existing_cols:
                        conn.execute(_text(f'ALTER TABLE us_strategy_presets ADD COLUMN {col} {col_type}'))
    except Exception:
        pass


@app.on_event("shutdown")
async def shutdown() -> None:
    await redis_service.close()

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(stock.router, prefix="/stock")
app.include_router(health_router)
app.include_router(webhook.router, prefix="/webhook")
app.include_router(ws.router)
app.include_router(demo.router)
app.include_router(backtest.router)
app.include_router(mgc.router, prefix="/mgc")


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    _logger.error("Unhandled exception on %s %s: %s\n%s", request.method, request.url.path, exc, traceback.format_exc())
    return JSONResponse(status_code=500, content={"detail": str(exc)})


@app.get("/")
def root() -> dict[str, str]:
    return {"status": "running"}


@app.get("/metrics")
def metrics() -> Response:
    payload, content_type = render_metrics()
    return Response(content=payload, media_type=content_type)