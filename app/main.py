from fastapi import FastAPI
from fastapi import Response
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.exc import SQLAlchemyError

from app.api import backtest, demo, mgc, stock, webhook, ws
from app.api.health import router as health_router
from app.core.config import get_settings
from app.core.logger import configure_logging, render_metrics, track
from app.db.database import Base, engine
from app.models import backtest_trade as backtest_trade_model, signal as signal_model, stock as stock_model, starred_stock as starred_stock_model  # noqa: F401
from app.services.redis_client import redis_service


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


@app.get("/")
def root() -> dict[str, str]:
    return {"status": "running"}


@app.get("/metrics")
def metrics() -> Response:
    payload, content_type = render_metrics()
    return Response(content=payload, media_type=content_type)